import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchFares, type SupplierConfig, type PlatformCredentials } from "@poomas/suppliers";
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

const SERP_TRIAL_TTL = 60 * 60 * 24;

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

searchRoutes.post("/", zValidator("json", searchSchema), async (c) => {
  const params   = c.req.valid("json");
  const tenant   = c.get("tenant");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const sessionId = c.get("userId") ?? c.req.header("X-Session-ID") ?? null;
  let currency = params.currency as "INR" | "AED" | "USD" | undefined;
  if (!currency && sessionId) {
    const prefs = await c.env.SESSIONS_KV.get(`session_prefs:${tenantId}:${sessionId}`, "json") as { currency?: string } | null;
    currency = prefs?.currency as "INR" | "AED" | "USD" | undefined;
  }
  currency = currency ?? (tenant.defaultCurrency as "INR" | "AED" | "USD");

  const platformCredentials: PlatformCredentials = {
    ...(c.env.RIYA_API_KEY     ? { RIYA:        { apiKey: c.env.RIYA_API_KEY, secretKey: c.env.RIYA_API_SECRET, baseUrl: c.env.RIYA_API_BASE_URL } } : {}),
    ...(c.env.TRIPJACK_API_KEY ? { TRIPJACK:    { apiKey: c.env.TRIPJACK_API_KEY, baseUrl: c.env.TRIPJACK_API_BASE_URL } } : {}),
    ...(c.env.SERP_API_KEY     ? { GOOGLE_SERP: { apiKey: c.env.SERP_API_KEY, baseUrl: "https://serpapi.com" } } : {}),
    ...(c.env.DUFFEL_API_KEY   ? { DUFFEL:      { apiKey: c.env.DUFFEL_API_KEY } } : {}),
  };

  const supplierConfigs: SupplierConfig[] = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP" | "DUFFEL",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  const configuredNames = new Set(supplierConfigs.map((s) => s.name));
  const PLATFORM_DEFAULTS: Array<{ name: SupplierConfig["name"]; priority: number; timeoutMs: number }> = [
    { name: "RIYA",        priority: 10, timeoutMs: 15000 },
    { name: "TRIPJACK",    priority: 20, timeoutMs: 15000 },
    { name: "DUFFEL",      priority: 30, timeoutMs: 15000 },
    { name: "GOOGLE_SERP", priority: 99, timeoutMs: 12000 },
  ];
  for (const def of PLATFORM_DEFAULTS) {
    if (!configuredNames.has(def.name) && platformCredentials[def.name]) {
      supplierConfigs.push({
        name:        def.name,
        isEnabled:   true,
        priority:    def.priority,
        credentials: null,
        timeoutMs:   def.timeoutMs,
        maxRetries:  0,
      });
    }
  }

  const availableSuppliers = supplierConfigs.filter((s) => s.isEnabled).map((s) => s.name);
  const credentialAvailability = {
    RIYA:        Boolean(platformCredentials.RIYA || supplierConfigs.find((s) => s.name === "RIYA")?.credentials),
    TRIPJACK:    Boolean(platformCredentials.TRIPJACK || supplierConfigs.find((s) => s.name === "TRIPJACK")?.credentials),
    DUFFEL:      Boolean(platformCredentials.DUFFEL || supplierConfigs.find((s) => s.name === "DUFFEL")?.credentials),
    GOOGLE_SERP: Boolean(platformCredentials.GOOGLE_SERP || supplierConfigs.find((s) => s.name === "GOOGLE_SERP")?.credentials),
  };

  const trialKey = sessionId ? `serp_trials:${tenantId}:${sessionId}` : null;
  if (trialKey && supplierConfigs.some((s) => s.name === "GOOGLE_SERP" && s.isEnabled)) {
    const raw          = await c.env.SESSIONS_KV.get(trialKey);
    const serpSearches = raw ? parseInt(raw, 10) : 0;
    c.executionCtx.waitUntil(
      c.env.SESSIONS_KV.put(trialKey, String(serpSearches + 1), { expirationTtl: SERP_TRIAL_TTL }),
    );
  }

  const cacheKey = `fares:${tenantId}:${JSON.stringify({ ...params, currency })}`;
  const cached = await c.env.FARE_CACHE_KV.get(cacheKey, "json") as {
    fares?: unknown[];
    supplierErrors?: Record<string, string>;
  } | null;

  // Never reuse a cached empty/error result. A temporary supplier failure must not poison
  // the same route for the next five minutes after credentials or code are fixed.
  if (cached && Array.isArray(cached.fares) && cached.fares.length > 0 && !cached.supplierErrors) {
    return c.json({ ...cached, fromCache: true });
  }

  const result = await searchFares(
    { ...params, currency },
    supplierConfigs,
    { platformCredentials },
  );

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

  const hasErrors = Object.keys(result.errors).length > 0;
  const response = {
    fares:         pricedFares,
    usedSuppliers: result.usedSuppliers,
    availableSuppliers,
    credentialAvailability,
    isIndicative:  result.isIndicative,
    ...(hasErrors ? { supplierErrors: result.errors } : {}),
    disclaimer: result.isIndicative
      ? "Some results are indicative Google Flights fares and cannot be booked directly. Contact an agent to confirm availability and price."
      : undefined,
  };

  // Cache only healthy, non-empty search results.
  if (pricedFares.length > 0 && !hasErrors) {
    await c.env.FARE_CACHE_KV.put(cacheKey, JSON.stringify(response), { expirationTtl: 300 });
  } else {
    await c.env.FARE_CACHE_KV.delete(cacheKey);
  }

  return c.json(response);
});

// Safe operational status: exposes only booleans/names, never secret values.
searchRoutes.get("/status", async (c) => {
  const tenant = c.get("tenant");
  const enabled = tenant.supplierConfigs.filter((s) => s.isEnabled).map((s) => s.supplier);
  return c.json({
    tenant: tenant.slug,
    enabledSuppliers: enabled,
    platformSecrets: {
      RIYA:        Boolean(c.env.RIYA_API_KEY && c.env.RIYA_API_BASE_URL),
      TRIPJACK:    Boolean(c.env.TRIPJACK_API_KEY && c.env.TRIPJACK_API_BASE_URL),
      DUFFEL:      Boolean(c.env.DUFFEL_API_KEY),
      GOOGLE_SERP: Boolean(c.env.SERP_API_KEY),
    },
  });
});

searchRoutes.get("/fare-rules/:fareId", async (c) => {
  const { fareId } = c.req.param();
  const supplier  = c.req.query("supplier") as "RIYA" | "TRIPJACK" | "DUFFEL" | undefined;
  const tenant    = c.get("tenant");

  if (!supplier) {
    return c.json({ error: "supplier query param required" }, 400);
  }

  const supplierConfigs: SupplierConfig[] = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP" | "DUFFEL",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  const platformCredentials: PlatformCredentials = {
    ...(c.env.RIYA_API_KEY     ? { RIYA:     { apiKey: c.env.RIYA_API_KEY, secretKey: c.env.RIYA_API_SECRET, baseUrl: c.env.RIYA_API_BASE_URL } } : {}),
    ...(c.env.TRIPJACK_API_KEY ? { TRIPJACK: { apiKey: c.env.TRIPJACK_API_KEY, baseUrl: c.env.TRIPJACK_API_BASE_URL } } : {}),
    ...(c.env.DUFFEL_API_KEY   ? { DUFFEL:   { apiKey: c.env.DUFFEL_API_KEY } } : {}),
  };

  const { getBookableAdapter } = await import("@poomas/suppliers");
  const adapter = getBookableAdapter(supplier, supplierConfigs, platformCredentials);
  const rules   = await adapter.getFareRules?.(fareId) ?? [];

  return c.json({ fareRules: rules });
});
