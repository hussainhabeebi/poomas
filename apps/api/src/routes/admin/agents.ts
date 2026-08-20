import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { agents, tenants } from "@poomas/db/schema";
import { eq } from "drizzle-orm";
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
