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

function platformCredentials(
  env: Env,
  supplier: SupplierName,
  adminCfg?: Record<string, unknown> | null,
): Record<string, string> | null {
  switch (supplier) {
    case "RIYA": {
      const key    = (adminCfg?.apiKey    as string) || env.RIYA_API_KEY;
      const secret = (adminCfg?.apiSecret as string) || env.RIYA_API_SECRET;
      const base   = (adminCfg?.baseUrl   as string) || env.RIYA_API_BASE_URL;
      if (!key || !secret) return null;
      return { apiKey: key, apiSecret: secret, ...(base ? { baseUrl: base } : {}) };
    }
    case "TRIPJACK": {
      const key  = (adminCfg?.apiKey  as string) || env.TRIPJACK_API_KEY;
      const base = (adminCfg?.baseUrl as string) || env.TRIPJACK_API_BASE_URL;
      if (!key) return null;
      return { apiKey: key, ...(base ? { baseUrl: base } : {}) };
    }
    case "DUFFEL": {
      const key = (adminCfg?.apiKey as string) || env.DUFFEL_API_KEY;
      if (!key) return null;
      return { apiKey: key, baseUrl: "https://api.duffel.com" };
    }
    case "GOOGLE_SERP": {
      const key = (adminCfg?.apiKey as string) || env.SERP_API_KEY;
      if (!key) return null;
      return { apiKey: key, baseUrl: "https://serpapi.com" };
    }
  }
}

async function loadAdminIntegrationConfig(env: Env, tenantId: string, supplier: string) {
  const raw = await env.TENANT_CACHE_KV.get(`admin_settings:${tenantId}:integration:${supplier}`);
  if (!raw) return null;
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  return cfg.enabled !== false ? cfg : null;  // Respect enabled flag
}

/**
 * Resolve every supplier that is actually available.
 * Priority: tenant DB config > admin KV settings > platform env secrets.
 * Suppliers disabled in admin KV are respected.
 */
async function resolveSupplierConfigs(tenant: Variables["tenant"], env: Env, tenantId: string): Promise<SupplierConfig[]> {
  const configured = new Map<SupplierName, SupplierConfig>();

  const supplierNames: SupplierName[] = ["RIYA", "TRIPJACK", "DUFFEL", "GOOGLE_SERP"];
  const kvSupplierMap: Record<SupplierName, string> = {
    RIYA: "riya", TRIPJACK: "tripjack", DUFFEL: "duffel", GOOGLE_SERP: "serp",
  };

  // Load admin KV configs for all suppliers in parallel
  const adminCfgs = Object.fromEntries(
    await Promise.all(
      supplierNames.map(async (name) => [
        name,
        await loadAdminIntegrationConfig(env, tenantId, kvSupplierMap[name]),
      ]),
    ),
  ) as Record<SupplierName, Record<string, unknown> | null>;

  for (const sc of tenant.supplierConfigs) {
    const name = sc.supplier as SupplierName;
    if (!(name in DEFAULT_SUPPLIER_SETTINGS)) continue;

    const adminCfg = adminCfgs[name];
    const fallback  = platformCredentials(env, name, adminCfg) ?? {};
    configured.set(name, {
      name,
      isEnabled: sc.isEnabled,
      priority:  sc.priority   ?? DEFAULT_SUPPLIER_SETTINGS[name].priority,
      credentials: { ...fallback, ...(sc.credentials ?? {}) },
      timeoutMs:  sc.timeoutMs  ?? DEFAULT_SUPPLIER_SETTINGS[name].timeoutMs,
      maxRetries: sc.maxRetries ?? DEFAULT_SUPPLIER_SETTINGS[name].maxRetries,
    });
  }

  for (const name of supplierNames) {
    if (configured.has(name)) continue;
    const adminCfg    = adminCfgs[name];
    const credentials = platformCredentials(env, name, adminCfg);
    if (!credentials) continue;

    configured.set(name, {
      name,
      isEnabled:  true,
      priority:   DEFAULT_SUPPLIER_SETTINGS[name].priority,
      credentials,
      timeoutMs:  DEFAULT_SUPPLIER_SETTINGS[name].timeoutMs,
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
  const supplierConfigs  = await resolveSupplierConfigs(tenant, c.env, tenantId);
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
  const tenant   = c.get("tenant");
  const tenantId = c.get("tenantId");

  const supplierConfigs = await resolveSupplierConfigs(tenant, c.env, tenantId);

  if (!supplier) {
    return c.json({ error: "supplier query param required" }, 400);
  }

  const { getBookableAdapter } = await import("@poomas/suppliers");
  const adapter = getBookableAdapter(supplier, supplierConfigs);
  const rules = await adapter.getFareRules?.(fareId) ?? [];

  return c.json({ fareRules: rules });
});
