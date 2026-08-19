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

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

searchRoutes.post("/", zValidator("json", searchSchema), async (c) => {
  const params  = c.req.valid("json");
  const tenant  = c.get("tenant");
  const db      = c.get("db");
  const tenantId = c.get("tenantId");

  const currency = params.currency ?? tenant.defaultCurrency as "INR" | "AED" | "USD";

  // Build supplier configs from tenant's setup (platform creds injected via env if tenant has none)
  const supplierConfigs: SupplierConfig[] = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,  // null = adapter falls back to env vars
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  // SERP fallback only for WhatsApp channel (determined by caller passing X-Channel: WHATSAPP)
  const isWhatsApp = c.req.header("X-Channel") === "WHATSAPP";

  // Check fare cache (KV) to avoid hammering suppliers for identical searches
  const cacheKey = `fares:${tenantId}:${JSON.stringify({ ...params, currency })}`;
  const cached   = await c.env.FARE_CACHE_KV.get(cacheKey, "json");
  if (cached) {
    return c.json({ ...cached as object, fromCache: true });
  }

  const result = await searchFares(
    { ...params, currency },
    supplierConfigs,
    { allowSerpFallback: isWhatsApp },
  );

  // Apply tenant markup to each fare
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
    markup: undefined,      // Never expose raw markup to client
  }));

  const response = {
    fares:         pricedFares,
    usedSuppliers: result.usedSuppliers,
    isIndicative:  result.isIndicative,
    disclaimer:    result.isIndicative
      ? "These are indicative fares. Contact an agent to confirm and book."
      : undefined,
  };

  // Cache search results for 5 minutes (fares change often — keep TTL short)
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
