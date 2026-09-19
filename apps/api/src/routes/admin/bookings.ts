import { Hono } from "hono";
import { bookings } from "@poomas/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";

export const bookingsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// TENANT_ADMIN sees only their tenant's bookings
// SUPER_ADMIN sees all bookings; optionally filtered by ?tenantId=
bookingsAdminRoutes.get("/", async (c) => {
  const db             = c.get("db");
  const role           = c.get("userRole");
  const filterTenantId = role === "SUPER_ADMIN"
    ? c.req.query("tenantId")   // optional for SUPER_ADMIN
    : c.get("tenantId");        // mandatory for TENANT_ADMIN

  const status  = c.req.query("status");
  const pnr     = c.req.query("pnr");
  const limit   = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset  = parseInt(c.req.query("offset") ?? "0");

  const conditions = [];
  if (filterTenantId) conditions.push(eq(bookings.tenantId, filterTenantId));
  if (status)         conditions.push(eq(bookings.status, status as "CONFIRMED"));
  if (pnr)            conditions.push(eq(bookings.pnr, pnr));

  const rows = await db
    .select()
    .from(bookings)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(bookings.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ bookings: rows, total: rows.length });
});

// Force status override (admin only, audit-logged)
bookingsAdminRoutes.patch("/:id/status", async (c) => {
  const { status, note } = await c.req.json() as { status: string; note: string };
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  await db.update(bookings)
    .set({ status: status as "CONFIRMED", updatedAt: new Date() })
    .where(and(eq(bookings.id, c.req.param("id")), eq(bookings.tenantId, tenantId)));

  // TODO: write to audit_logs
  return c.json({ ok: true });
});
