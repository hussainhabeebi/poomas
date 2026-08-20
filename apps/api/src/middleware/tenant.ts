import type { MiddlewareHandler } from "hono";
import type { Env, Variables, TenantContext } from "../types.js";
import { createDb } from "@poomas/db";
import { tenants, tenantSupplierConfigs } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";

const TENANT_CACHE_TTL = 60;  // seconds — KV TTL for tenant config

// Derives tenant_id from the request hostname (subdomain or custom domain).
// Never trusts X-Tenant-ID header from clients — all tenant derivation is server-side.
export const resolveTenant: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  // Create DB client using Hyperdrive connection string
  const db = createDb(c.env.HYPERDRIVE.connectionString ?? c.env.DATABASE_URL);
  c.set("db", db);

  const host = new URL(c.req.url).hostname;

  // Check KV cache first (tenant config is read-hot)
  const cacheKey = `tenant:host:${host}`;
  const cached = await c.env.TENANT_CACHE_KV.get(cacheKey, "json") as TenantContext | null;

  if (cached) {
    c.set("tenantId", cached.id);
    c.set("tenant",   cached);
    return next();
  }

  // Derive tenant from host:
  //   1. Exact custom domain match    → flights.skyjetagency.com
  //   2. Subdomain match              → skyjet.flypoomas.com
  //   3. Platform domain              → flypoomas.com / api.flypoomas.com
  const slug = extractSlug(host, c.env.PLATFORM_TENANT_SLUG);

  const rows = await db
    .select({
      id:              tenants.id,
      slug:            tenants.slug,
      name:            tenants.name,
      plan:            tenants.plan,
      region:          tenants.region,
      defaultCurrency: tenants.defaultCurrency,
      searchRpmLimit:  tenants.searchRpmLimit,
      bookingRpmLimit: tenants.bookingRpmLimit,
      status:          tenants.status,
      paymentConfig:   tenants.paymentConfig,
    })
    .from(tenants)
    .where(
      slug === "__custom__"
        ? eq(tenants.customDomain, host)
        : eq(tenants.slug, slug),
    )
    .limit(1);

  const tenant = rows[0];
  if (!tenant) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  if (tenant.status === "SUSPENDED" || tenant.status === "CLOSED") {
    return c.json({ error: "Account suspended" }, 403);
  }

  // Load supplier configs for this tenant
  const supplierRows = await db
    .select()
    .from(tenantSupplierConfigs)
    .where(
      and(
        eq(tenantSupplierConfigs.tenantId, tenant.id),
        eq(tenantSupplierConfigs.isEnabled, true),
      ),
    );

  const tenantCtx: TenantContext = {
    id:              tenant.id,
    slug:            tenant.slug,
    name:            tenant.name,
    plan:            tenant.plan,
    region:          tenant.region,
    defaultCurrency: tenant.defaultCurrency,
    searchRpmLimit:  tenant.searchRpmLimit,
    bookingRpmLimit: tenant.bookingRpmLimit,
    paymentConfig:   tenant.paymentConfig as TenantContext["paymentConfig"],
    supplierConfigs: supplierRows.map((r) => ({
      supplier:    r.supplier,
      isEnabled:   r.isEnabled,
      priority:    r.priority,
      credentials: r.credentials as Record<string, string> | null,
      timeoutMs:   r.timeoutMs,
      maxRetries:  r.maxRetries,
    })),
  };

  // Cache in KV for 60 seconds
  await c.env.TENANT_CACHE_KV.put(cacheKey, JSON.stringify(tenantCtx), {
    expirationTtl: TENANT_CACHE_TTL,
  });

  c.set("tenantId", tenant.id);
  c.set("tenant",   tenantCtx);

  return next();
};

function extractSlug(host: string, platformSlug: string): string {
  // Custom domain: no *.flypoomas.com pattern — treat as custom
  if (!host.endsWith(".flypoomas.com") && host !== "flypoomas.com" && host !== `api.flypoomas.com`) {
    return "__custom__";
  }

  // api.flypoomas.com → platform tenant
  if (host === "api.flypoomas.com" || host === "flypoomas.com") {
    return platformSlug;
  }

  // skyjet.flypoomas.com → "skyjet"
  return host.split(".")[0];
}
