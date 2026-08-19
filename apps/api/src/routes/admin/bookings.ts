import { Hono } from "hono";
import { bookings } from "@poomas/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";

export const bookingsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// TENANT_ADMIN sees only their tenant's bookings
// SUPER_ADMIN can pass ?tenantId= to see any tenant's bookings
bookingsAdminRoutes.get("/", async (c) => {
  const db       = c.get("db");
  const role     = c.get("userRole");
  const tenantId = role === "SUPER_ADMIN"
    ? (c.req.query("tenantId") ?? c.get("tenantId"))
    : c.get("tenantId");

  const status  = c.req.query("status");
  const limit   = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset  = parseInt(c.req.query("offset") ?? "0");

  const rows = await db
    .select()
    .from(bookings)
    .where(
      status
        ? and(eq(bookings.tenantId, tenantId), eq(bookings.status, status as "CONFIRMED"))
        : eq(bookings.tenantId, tenantId),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
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
