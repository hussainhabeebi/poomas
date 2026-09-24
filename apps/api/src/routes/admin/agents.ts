import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { agents, tenants, agentDocuments, bookings } from "@poomas/db/schema";
import { eq, sql } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";
import { requireRole } from "../../middleware/auth.js";

export const agentsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/agents — all agents across all tenants (SUPER_ADMIN)
agentsAdminRoutes.get("/", async (c) => {
  requireRole("SUPER_ADMIN")(c.get("userRole"));

  const db     = c.get("db");
  const status = c.req.query("status");

  const rows = await db
    .select({
      id:           agents.id,
      businessName: agents.businessName,
      contactEmail: agents.email,
      contactPhone: agents.phone,
      status:       agents.status,
      tenantId:     agents.tenantId,
      tenantSlug:   tenants.slug,
      plan:         tenants.plan,
      createdAt:    agents.createdAt,
    })
    .from(agents)
    .leftJoin(tenants, eq(agents.tenantId, tenants.id))
    .where(status ? eq(agents.status, status as "PENDING") : undefined)
    .limit(100);

  return c.json({ agents: rows });
});

// GET /api/admin/agents/:id — one agent with its documents and booking totals (SUPER_ADMIN)
agentsAdminRoutes.get("/:id", async (c) => {
  requireRole("SUPER_ADMIN")(c.get("userRole"));
  const db = c.get("db");
  const id = c.req.param("id");
  const [row] = await db
    .select({ agent: agents, tenantSlug: tenants.slug, tenantName: tenants.name, plan: tenants.plan })
    .from(agents).leftJoin(tenants, eq(agents.tenantId, tenants.id))
    .where(eq(agents.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: "Agent not found" });
  const [documents, [stats]] = await Promise.all([
    db.select().from(agentDocuments).where(eq(agentDocuments.agentId, id)),
    db.select({ total: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)::text` })
      .from(bookings).where(eq(bookings.agentId, id)),
  ]);
  return c.json({ ...row.agent, tenantSlug: row.tenantSlug, tenantName: row.tenantName, plan: row.plan, documents, stats: { bookings: stats?.total ?? 0, bookingValue: stats?.value ?? "0" } });
});

// PATCH /api/admin/agents/:id/status — update agent status
agentsAdminRoutes.patch("/:id/status", async (c) => {
  requireRole("SUPER_ADMIN", "TENANT_ADMIN")(c.get("userRole"));

  const body    = await c.req.json() as { status: "APPROVED" | "REJECTED" | "SUSPENDED" };
  const db      = c.get("db");
  const userId  = c.get("userId")!;

  await db.update(agents).set({
    status:      body.status,
    approvedAt:  body.status === "APPROVED" ? new Date() : null,
    approvedById: userId,
    updatedAt:   new Date(),
  }).where(eq(agents.id, c.req.param("id")));

  return c.json({ ok: true });
});
