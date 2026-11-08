import type { MiddlewareHandler } from "hono";
import type { Env, Variables, TenantContext } from "../types.js";
import { createDb } from "@poomas/db";
import { createLogsDb } from "@poomas/db/logs";
import { tenants, tenantSupplierConfigs } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";

// Every cache miss is a Neon query (and keeps the Neon compute awake), so the tenant
// record is cached for an hour; admin edits clear it via forgetTenantCache().
const TENANT_CACHE_TTL = 3600;

// Derives tenant_id from the request hostname (subdomain or custom domain).
// Never trusts X-Tenant-ID header from clients — all tenant derivation is server-side.
export const resolveTenant: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (!c.env.DB) {
    console.error("[tenant] D1 binding DB is not configured");
    return c.json({ error: "Database connection is not configured" }, 503);
  }

  const db = createDb(c.env.DB);
  c.set("db", db);
  c.set("logs", createLogsDb(c.env.LOGS_DB));

  const host = new URL(c.req.url).hostname;

  // Check KV cache first (tenant config is read-hot). KV failure must not prevent a DB lookup.
  const cacheKey = `tenant:host:${host}`;
  let cached: TenantContext | null = null;
  try {
    cached = await c.env.TENANT_CACHE_KV.get(cacheKey, "json") as TenantContext | null;
  } catch (err) {
    console.error("[tenant] cache read failed", err);
  }

  if (cached) {
    c.set("tenantId", cached.id);
    c.set("tenant",   cached);
    return next();
  }

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

  try {
    await c.env.TENANT_CACHE_KV.put(cacheKey, JSON.stringify(tenantCtx), {
      expirationTtl: TENANT_CACHE_TTL,
    });
  } catch (err) {
    console.error("[tenant] cache write failed", err);
  }

  c.set("tenantId", tenant.id);
  c.set("tenant",   tenantCtx);

  return next();
};

function extractSlug(host: string, platformSlug: string): string {
  // workers.dev is a platform/debug hostname, so resolve it to the platform tenant.
  if (host.endsWith(".workers.dev")) {
    return platformSlug;
  }

  if (!host.endsWith(".flypoomas.com") && host !== "flypoomas.com" && host !== "api.flypoomas.com") {
    return "__custom__";
  }

  if (host === "api.flypoomas.com" || host === "flypoomas.com") {
    return platformSlug;
  }

  return host.split(".")[0];
}

// Clears every cached host → tenant entry for a tenant (after admin edits): its subdomain,
// its custom domain and, for the platform tenant, the hosts extractSlug() maps to it.
export async function forgetTenantCache(
  env: Pick<Env, "TENANT_CACHE_KV" | "PLATFORM_TENANT_SLUG">,
  tenant: { slug: string; customDomain?: string | null },
) {
  const hosts = [`${tenant.slug}.flypoomas.com`];
  if (tenant.customDomain) hosts.push(tenant.customDomain);
  if (tenant.slug === env.PLATFORM_TENANT_SLUG) hosts.push("api.flypoomas.com", "flypoomas.com");
  await Promise.all(hosts.map((h) => env.TENANT_CACHE_KV.delete(`tenant:host:${h}`).catch(() => {})));
}
