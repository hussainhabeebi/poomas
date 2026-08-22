import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchFares, type SupplierConfig } from "@poomas/suppliers";
import type { Env, Variables } from "../types.js";

const searchSchema = z.object({
  origin:        z.string().length(3).toUpperCase(),
  destination:   z.string().length(3).toUpperCase(),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  adults:        z.number().int().min(1).max(9).default(1),
  children:      z.number().int().min(0).max(9).default(0),
  infants:       z.number().int().min(0).max(4).default(0),
  cabinClass:    z.enum(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]).default("ECONOMY"),
  tripType:      z.enum(["ONEWAY", "ROUNDTRIP", "MULTICITY"]).default("ONEWAY"),
  currency:      z.enum(["INR", "AED", "USD"]).optional(),
});

// Max free SERP trial searches per session
const SERP_TRIAL_LIMIT = 2;
const SERP_TRIAL_TTL   = 60 * 60 * 24; // 24 hours

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

searchRoutes.post("/", zValidator("json", searchSchema), async (c) => {
  const params  = c.req.valid("json");
  const tenant  = c.get("tenant");
  const db      = c.get("db");
  const tenantId = c.get("tenantId");

  const currency = params.currency ?? tenant.defaultCurrency as "INR" | "AED" | "USD";

  // ── SERP trial tracking ─────────────────────────────────────────────────────
  // Identify session: prefer authenticated userId, fallback to X-Session-ID header.
  // Anonymous users should send a stable client-generated UUID in X-Session-ID.
  const sessionId = c.get("userId") ?? c.req.header("X-Session-ID") ?? null;
  const trialKey  = sessionId ? `serp_trials:${tenantId}:${sessionId}` : null;

  let serpTrialsUsed      = SERP_TRIAL_LIMIT; // default: no trials (treated as exhausted)
  let serpTrialsRemaining = 0;
  let useSerpTrial        = false;

  if (trialKey) {
    const raw = await c.env.SESSIONS_KV.get(trialKey);
    serpTrialsUsed = raw ? parseInt(raw, 10) : 0;

    if (serpTrialsUsed < SERP_TRIAL_LIMIT) {
      useSerpTrial        = true;
      serpTrialsRemaining = SERP_TRIAL_LIMIT - serpTrialsUsed - 1;

      // Increment async — don't block search
      c.executionCtx.waitUntil(
        c.env.SESSIONS_KV.put(trialKey, String(serpTrialsUsed + 1), {
          expirationTtl: SERP_TRIAL_TTL,
        }),
      );
    }
  }

  // ── Supplier config ──────────────────────────────────────────────────────────
  // Start with tenant's own configured suppliers
  const supplierConfigs: SupplierConfig[] = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  // Auto-inject SERP for trial searches (uses platform SERP_API_KEY from env)
  // Only injected if tenant hasn't already configured GOOGLE_SERP themselves
  const hasSerpConfigured = supplierConfigs.some((s) => s.name === "GOOGLE_SERP");
  if (useSerpTrial && !hasSerpConfigured && c.env.SERP_API_KEY) {
    supplierConfigs.push({
      name:        "GOOGLE_SERP",
      isEnabled:   true,
      priority:    99,  // lowest priority — bookable suppliers always take precedence
      credentials: {
        apiKey:  c.env.SERP_API_KEY,
        baseUrl: "https://serpapi.com",
      },
      timeoutMs:  8000,
      maxRetries: 0,
    });
  }

  // SERP fallback for WhatsApp channel (separate from trial — always on if configured)
  const isWhatsApp = c.req.header("X-Channel") === "WHATSAPP";

  // ── Fare cache ───────────────────────────────────────────────────────────────
  // Cache key includes whether SERP is included (different result sets)
  const includeSerpParallel = useSerpTrial || hasSerpConfigured;
  const cacheKey = `fares:${tenantId}:${JSON.stringify({ ...params, currency, serp: includeSerpParallel })}`;
  const cached   = await c.env.FARE_CACHE_KV.get(cacheKey, "json");
  if (cached) {
    return c.json({
      ...(cached as object),
      fromCache:          true,
      serpTrialsRemaining: includeSerpParallel ? serpTrialsRemaining + 1 : serpTrialsRemaining,
    });
  }

  // ── Search ───────────────────────────────────────────────────────────────────
  const result = await searchFares(
    { ...params, currency },
    supplierConfigs,
    {
      allowSerpFallback:  isWhatsApp,
      includeSerpParallel,
    },
  );

  // ── Markup ───────────────────────────────────────────────────────────────────
  const { applyMarkup } = await import("../lib/markup.js");
  const { markupRules } = await import("@poomas/db/schema");
  const { eq } = await import("drizzle-orm");

  const rules = await db
    .select()
    .from(markupRules)
    .where(eq(markupRules.tenantId, tenantId));

  const pricedFares = result.fares.map((fare) => ({
    ...fare,
    displayPrice: applyMarkup(fare, rules),
    markup:       undefined,
  }));

  // ── Response ─────────────────────────────────────────────────────────────────
  const response = {
    fares:               pricedFares,
    usedSuppliers:       result.usedSuppliers,
    isIndicative:        result.isIndicative,
    serpTrialsRemaining,
    disclaimer: result.isIndicative
      ? "Some results are indicative Google Flights fares and cannot be booked directly. Contact an agent to confirm availability and price."
      : undefined,
  };

  await c.env.FARE_CACHE_KV.put(cacheKey, JSON.stringify(response), { expirationTtl: 300 });

  return c.json(response);
});

// Fare rules lookup (expandable fare detail)
searchRoutes.get("/fare-rules/:fareId", async (c) => {
  const { fareId } = c.req.param();
  const supplier  = c.req.query("supplier") as "RIYA" | "TRIPJACK" | undefined;
  const tenant    = c.get("tenant");

  const supplierConfigs: SupplierConfig[] = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  if (!supplier) {
    return c.json({ error: "supplier query param required" }, 400);
  }

  const { getBookableAdapter } = await import("@poomas/suppliers");
  const adapter = getBookableAdapter(supplier, supplierConfigs);
  const rules   = await adapter.getFareRules?.(fareId) ?? [];

  return c.json({ fareRules: rules });
});
