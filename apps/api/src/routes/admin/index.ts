import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env, Variables } from "../../types.js";
import { requireRole } from "../../middleware/auth.js";
import { tenantsAdminRoutes }  from "./tenants.js";
import { bookingsAdminRoutes } from "./bookings.js";
import { suppliersAdminRoutes } from "./suppliers.js";
import { agentsAdminRoutes }  from "./agents.js";
import { financeAdminRoutes } from "./finance.js";
import { settingsAdminRoutes }      from "./settings.js";
import { integrationsAdminRoutes } from "./integrations.js";
import { apiKeysAdminRoutes }      from "./api-keys.js";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All /api/admin/* routes require at minimum TENANT_ADMIN
// Super-admin-only sub-routes enforce SUPER_ADMIN role inside
adminRoutes.use("*", async (c, next) => {
  const role = c.get("userRole");
  if (!["SUPER_ADMIN", "TENANT_ADMIN"].includes(role ?? "")) {
    throw new HTTPException(403, { message: "Admin access required" });
  }
  return next();
});

adminRoutes.route("/tenants",   tenantsAdminRoutes);
adminRoutes.route("/bookings",  bookingsAdminRoutes);
adminRoutes.route("/suppliers", suppliersAdminRoutes);
adminRoutes.route("/agents",    agentsAdminRoutes);
adminRoutes.route("/finance",   financeAdminRoutes);
adminRoutes.route("/settings",      settingsAdminRoutes);
adminRoutes.route("/integrations",  integrationsAdminRoutes);
adminRoutes.route("/api-keys",      apiKeysAdminRoutes);

// Platform-level dashboard stats (SUPER_ADMIN only)
adminRoutes.get("/dashboard", async (c) => {
  requireRole("SUPER_ADMIN")(c.get("userRole"));

  const db = c.get("db");
  const { bookings, tenants, agents } = await import("@poomas/db/schema");
  const { count, sql } = await import("drizzle-orm");

  const [bookingCount] = await db.select({ count: count() }).from(bookings);
  const [tenantCount]  = await db.select({ count: count() }).from(tenants);
  const [agentCount]   = await db.select({ count: count() }).from(agents);

  return c.json({
    bookings: bookingCount.count,
    tenants:  tenantCount.count,
    agents:   agentCount.count,
  });
});
