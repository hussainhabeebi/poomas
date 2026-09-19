import { Hono } from "hono";
import { supplierApiLogs } from "@poomas/db/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";

export const supplierLogsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

supplierLogsAdminRoutes.get("/", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const role     = c.get("userRole");

  const level    = c.req.query("level");
  const supplier = c.req.query("supplier");
  const endpoint = c.req.query("endpoint");
  const from     = c.req.query("from");
  const to       = c.req.query("to");
  const filterTenantId = c.req.query("tenantId");  // SUPER_ADMIN can filter by any tenant
  const limit    = Math.min(parseInt(c.req.query("limit") ?? "100"), 500);
  const offset   = parseInt(c.req.query("offset") ?? "0");

  // SUPER_ADMIN sees all tenants unless a specific tenantId filter is passed.
  // TENANT_ADMIN is always restricted to their own tenant.
  const conditions: ReturnType<typeof eq>[] = [];
  if (role !== "SUPER_ADMIN") {
    conditions.push(eq(supplierApiLogs.tenantId, tenantId));
  } else if (filterTenantId) {
    conditions.push(eq(supplierApiLogs.tenantId, filterTenantId));
  }

  if (level)    conditions.push(eq(supplierApiLogs.level, level));
  if (supplier) conditions.push(eq(supplierApiLogs.supplier, supplier as "TRIPJACK"));
  if (endpoint) conditions.push(eq(supplierApiLogs.endpoint, endpoint));
  if (from)     conditions.push(gte(supplierApiLogs.createdAt, new Date(from)));
  if (to)       conditions.push(lte(supplierApiLogs.createdAt, new Date(to)));

  try {
    const rows = await db
      .select()
      .from(supplierApiLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(supplierApiLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ logs: rows, limit, offset });
  } catch (err) {
    console.error("[admin-supplier-logs] query failed:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Failed to query supplier logs", details: err instanceof Error ? err.message : String(err) }, 500);
  }
});
