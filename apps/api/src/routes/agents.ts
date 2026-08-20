import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { agents, agentDocuments, walletAccounts } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../types.js";
import { requireRole } from "../middleware/auth.js";

export const agentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const registerSchema = z.object({
  businessName:   z.string().min(2),
  ownerName:      z.string().min(2),
  email:          z.string().email(),
  phone:          z.string().min(8),
  whatsapp:       z.string().optional(),
  region:         z.enum(["INDIA", "GCC"]),
  currency:       z.enum(["INR", "AED", "USD"]),
  iataCode:       z.string().optional(),
  parentAgentId:  z.string().optional(),
});

// Agent self-registration (creates a PENDING agent record)
agentRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.email, body.email)))
    .limit(1);

  if (existing) {
    throw new HTTPException(409, { message: "An agent with this email already exists" });
  }

  const [agent] = await db.insert(agents).values({
    tenantId,
    ...body,
    status: "PENDING",
  }).returning();

  // Create wallet account for agent
  await db.insert(walletAccounts).values({
    tenantId,
    agentId:  agent.id,
    currency: body.currency,
  });

  return c.json({ agentId: agent.id, status: "PENDING" }, 201);
});

// List all agents under this tenant (TENANT_ADMIN only)
agentRoutes.get("/", async (c) => {
  requireRole("TENANT_ADMIN", "SUPER_ADMIN")(c.get("userRole"));

  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const status   = c.req.query("status");

  const rows = await db
    .select()
    .from(agents)
    .where(
      status
        ? and(eq(agents.tenantId, tenantId), eq(agents.status, status as "PENDING"))
        : eq(agents.tenantId, tenantId),
    );

  return c.json(rows);
});

// Approve/reject agent (TENANT_ADMIN)
agentRoutes.patch("/:id/status", async (c) => {
  requireRole("TENANT_ADMIN", "SUPER_ADMIN")(c.get("userRole"));

  const body   = await c.req.json() as { status: "APPROVED" | "REJECTED" | "SUSPENDED" };
  const db     = c.get("db");
  const userId = c.get("userId")!;

  await db.update(agents).set({
    status:      body.status,
    approvedAt:  body.status === "APPROVED" ? new Date() : null,
    approvedById: userId,
    updatedAt:   new Date(),
  }).where(
    and(eq(agents.id, c.req.param("id")), eq(agents.tenantId, c.get("tenantId"))),
  );

  return c.json({ ok: true });
});

// Invite a sub-agent (simpler form for portal — uses parent agent's region/currency)
const inviteSchema = z.object({
  businessName: z.string().min(2),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8),
});

agentRoutes.post("/sub-agents/invite", zValidator("json", inviteSchema), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const agentId  = c.get("agentId");

  if (!agentId) throw new HTTPException(403, { message: "Agent auth required" });

  // Get parent agent's region/currency
  const [parent] = await db
    .select({ region: agents.region, currency: agents.currency })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.email, body.contactEmail)))
    .limit(1);

  if (existing) throw new HTTPException(409, { message: "Agent with this email already exists" });

  const [agent] = await db.insert(agents).values({
    tenantId,
    parentAgentId:  agentId,
    businessName:   body.businessName,
    ownerName:      body.businessName,
    email:          body.contactEmail,
    phone:          body.contactPhone,
    status:         "PENDING",
    region:         parent?.region ?? "INDIA",
    currency:       parent?.currency ?? "INR",
  }).returning();

  await db.insert(walletAccounts).values({
    tenantId,
    agentId:  agent.id,
    currency: parent?.currency ?? "INR",
  });

  return c.json({
    id:           agent.id,
    businessName: agent.businessName,
    contactEmail: agent.email,
    contactPhone: agent.phone,
    status:       agent.status,
    createdAt:    agent.createdAt,
  }, 201);
});

// Sub-agents of the currently authenticated agent
agentRoutes.get("/sub-agents", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const agentId  = c.get("agentId");

  if (!agentId) throw new HTTPException(403, { message: "Agent auth required" });

  const rows = await db
    .select({
      id:           agents.id,
      businessName: agents.businessName,
      contactEmail: agents.email,
      contactPhone: agents.phone,
      status:       agents.status,
      createdAt:    agents.createdAt,
    })
    .from(agents)
    .where(
      and(eq(agents.tenantId, tenantId), eq(agents.parentAgentId, agentId)),
    );

  return c.json({ agents: rows });
});

// Sub-agent list for a specific parent agent (ADMIN)
agentRoutes.get("/:id/sub-agents", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.tenantId,      tenantId),
        eq(agents.parentAgentId, c.req.param("id")),
      ),
    );

  return c.json(rows);
});
