import { Hono } from "hono";
import { supplierApiLogs } from "@poomas/db/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";

export const supplierLogsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

supplierLogsAdminRoutes.get("/", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const level    = c.req.query("level");        // INFO | WARN | ERROR
  const supplier = c.req.query("supplier");     // TRIPJACK | RIYA
  const endpoint = c.req.query("endpoint");
  const from     = c.req.query("from");         // ISO date
  const to       = c.req.query("to");           // ISO date
  const limit    = Math.min(parseInt(c.req.query("limit") ?? "100"), 500);
  const offset   = parseInt(c.req.query("offset") ?? "0");

  const conditions = [eq(supplierApiLogs.tenantId, tenantId)];
  if (level)    conditions.push(eq(supplierApiLogs.level, level));
  if (supplier) conditions.push(eq(supplierApiLogs.supplier, supplier as "TRIPJACK"));
  if (endpoint) conditions.push(eq(supplierApiLogs.endpoint, endpoint));
  if (from)     conditions.push(gte(supplierApiLogs.createdAt, new Date(from)));
  if (to)       conditions.push(lte(supplierApiLogs.createdAt, new Date(to)));

  const rows = await db
    .select()
    .from(supplierApiLogs)
    .where(and(...conditions))
    .orderBy(desc(supplierApiLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ logs: rows, limit, offset });
});
