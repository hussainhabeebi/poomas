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

const SERP_TRIAL_LIMIT = 2;
const SERP_TRIAL_TTL   = 60 * 60 * 24; // 24 hours

type SupplierName = "RIYA" | "TRIPJACK" | "GOOGLE_SERP" | "DUFFEL";

const DEFAULT_SUPPLIER_SETTINGS: Record<SupplierName, Pick<SupplierConfig, "priority" | "timeoutMs" | "maxRetries">> = {
  RIYA:        { priority: 10, timeoutMs: 12000, maxRetries: 1 },
  TRIPJACK:    { priority: 20, timeoutMs: 12000, maxRetries: 1 },
  DUFFEL:      { priority: 30, timeoutMs: 12000, maxRetries: 1 },
  GOOGLE_SERP: { priority: 99, timeoutMs: 8000,  maxRetries: 0 },
};

function platformCredentials(env: Env, supplier: SupplierName): Record<string, string> | null {
  switch (supplier) {
    case "RIYA":
      if (!env.RIYA_API_KEY || !env.RIYA_API_SECRET) return null;
      return {
        apiKey: env.RIYA_API_KEY,
        apiSecret: env.RIYA_API_SECRET,
        ...(env.RIYA_API_BASE_URL ? { baseUrl: env.RIYA_API_BASE_URL } : {}),
      };
    case "TRIPJACK":
      if (!env.TRIPJACK_API_KEY) return null;
      return {
        apiKey: env.TRIPJACK_API_KEY,
        ...(env.TRIPJACK_API_BASE_URL ? { baseUrl: env.TRIPJACK_API_BASE_URL } : {}),
      };
    case "DUFFEL":
      if (!env.DUFFEL_API_KEY) return null;
      return {
        apiKey: env.DUFFEL_API_KEY,
        baseUrl: "https://api.duffel.com",
      };
    case "GOOGLE_SERP":
      if (!env.SERP_API_KEY) return null;
      return {
        apiKey: env.SERP_API_KEY,
        baseUrl: "https://serpapi.com",
      };
  }
}

/**
 * Resolve every supplier that is actually available.
 * Tenant configuration wins, while missing credential fields fall back to platform secrets.
 * If a supplier is not configured for the tenant but platform credentials exist, it is added
 * automatically so a healthy supplier can still return fares.
 * Explicitly disabled tenant suppliers remain disabled.
 */
function resolveSupplierConfigs(tenant: Variables["tenant"], env: Env): SupplierConfig[] {
  const configured = new Map<SupplierName, SupplierConfig>();

  for (const sc of tenant.supplierConfigs) {
    const name = sc.supplier as SupplierName;
    if (!(name in DEFAULT_SUPPLIER_SETTINGS)) continue;

    const fallback = platformCredentials(env, name) ?? {};
    configured.set(name, {
      name,
      isEnabled: sc.isEnabled,
      priority: sc.priority ?? DEFAULT_SUPPLIER_SETTINGS[name].priority,
      credentials: {
        ...fallback,
        ...(sc.credentials ?? {}),
      },
      timeoutMs: sc.timeoutMs ?? DEFAULT_SUPPLIER_SETTINGS[name].timeoutMs,
      maxRetries: sc.maxRetries ?? DEFAULT_SUPPLIER_SETTINGS[name].maxRetries,
    });
  }

  const supplierNames: SupplierName[] = ["RIYA", "TRIPJACK", "DUFFEL", "GOOGLE_SERP"];
  for (const name of supplierNames) {
    if (configured.has(name)) continue;
    const credentials = platformCredentials(env, name);
    if (!credentials) continue;

    configured.set(name, {
      name,
      isEnabled: true,
      priority: DEFAULT_SUPPLIER_SETTINGS[name].priority,
      credentials,
      timeoutMs: DEFAULT_SUPPLIER_SETTINGS[name].timeoutMs,
      maxRetries: DEFAULT_SUPPLIER_SETTINGS[name].maxRetries,
    });
  }

  return Array.from(configured.values());
}

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

searchRoutes.post("/", zValidator("json", searchSchema), async (c) => {
  const params   = c.req.valid("json");
  const tenant   = c.get("tenant");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const currency = params.currency ?? tenant.defaultCurrency as "INR" | "AED" | "USD";

  // ── SERP trial tracking ─────────────────────────────────────────────────────
  const sessionId = c.get("userId") ?? c.req.header("X-Session-ID") ?? null;
  const trialKey  = sessionId ? `serp_trials:${tenantId}:${sessionId}` : null;

  let serpTrialsUsed      = SERP_TRIAL_LIMIT;
  let serpTrialsRemaining = 0;
  let useSerpTrial        = false;

  if (trialKey) {
    const raw = await c.env.SESSIONS_KV.get(trialKey);
    serpTrialsUsed = raw ? parseInt(raw, 10) : 0;

    if (serpTrialsUsed < SERP_TRIAL_LIMIT) {
      useSerpTrial        = true;
      serpTrialsRemaining = SERP_TRIAL_LIMIT - serpTrialsUsed - 1;

      c.executionCtx.waitUntil(
        c.env.SESSIONS_KV.put(trialKey, String(serpTrialsUsed + 1), {
          expirationTtl: SERP_TRIAL_TTL,
        }),
      );
    }
  }

  // ── Supplier config ──────────────────────────────────────────────────────────
  // Search every available supplier. Tenant credentials override platform secrets.
  const supplierConfigs = resolveSupplierConfigs(tenant, c.env);
  const enabledSuppliers = supplierConfigs.filter((s) => s.isEnabled);
  const hasSerpAvailable = enabledSuppliers.some((s) => s.name === "GOOGLE_SERP");

  // SERP joins normal web search when it is configured/available. This guarantees that
  // web searches can still return indicative fares if all bookable suppliers fail/return none.
  const includeSerpParallel = hasSerpAvailable && useSerpTrial;

  // ── Fare cache ───────────────────────────────────────────────────────────────
  const cacheKey = `fares:${tenantId}:${JSON.stringify({
    ...params,
    currency,
    suppliers: enabledSuppliers.map((s) => s.name).sort(),
  })}`;
  const cached = await c.env.FARE_CACHE_KV.get(cacheKey, "json");
  if (cached) {
    return c.json({
      ...(cached as object),
      fromCache: true,
      serpTrialsRemaining,
    });
  }

  // ── Search ───────────────────────────────────────────────────────────────────
  // All enabled bookable suppliers run in parallel. If they return nothing or fail,
  // SERP is allowed as fallback on BOTH website and WhatsApp.
  const result = await searchFares(
    { ...params, currency },
    supplierConfigs,
    {
      allowSerpFallback: hasSerpAvailable,
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
    markup: undefined,
  }));

  // ── Response ─────────────────────────────────────────────────────────────────
  const response = {
    fares: pricedFares,
    usedSuppliers: result.usedSuppliers,
    availableSuppliers: enabledSuppliers.map((s) => s.name),
    isIndicative: result.isIndicative,
    serpTrialsRemaining,
    ...(c.env.ENVIRONMENT !== "production" ? { supplierErrors: result.errors } : {}),
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
  const supplier = c.req.query("supplier") as "RIYA" | "TRIPJACK" | "DUFFEL" | undefined;
  const tenant = c.get("tenant");

  const supplierConfigs = resolveSupplierConfigs(tenant, c.env);

  if (!supplier) {
    return c.json({ error: "supplier query param required" }, 400);
  }

  const { getBookableAdapter } = await import("@poomas/suppliers");
  const adapter = getBookableAdapter(supplier, supplierConfigs);
  const rules = await adapter.getFareRules?.(fareId) ?? [];

  return c.json({ fareRules: rules });
});
