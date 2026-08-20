import { Hono } from "hono";
import { tenantSupplierConfigs } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";
import { requireRole } from "../../middleware/auth.js";

export const suppliersAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// View supplier configs for a tenant
suppliersAdminRoutes.get("/", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const rows = await db
    .select({
      id:          tenantSupplierConfigs.id,
      supplier:    tenantSupplierConfigs.supplier,
      isEnabled:   tenantSupplierConfigs.isEnabled,
      priority:    tenantSupplierConfigs.priority,
      timeoutMs:   tenantSupplierConfigs.timeoutMs,
      maxRetries:  tenantSupplierConfigs.maxRetries,
      callsThisMonth: tenantSupplierConfigs.callsThisMonth,
      callsLimit:  tenantSupplierConfigs.callsLimit,
      // Never expose raw credentials — masked here
    })
    .from(tenantSupplierConfigs)
    .where(eq(tenantSupplierConfigs.tenantId, tenantId));

  return c.json(rows);
});

// Enable/disable a supplier or update priority
suppliersAdminRoutes.patch("/:supplier", async (c) => {
  requireRole("TENANT_ADMIN", "SUPER_ADMIN")(c.get("userRole"));

  const body = await c.req.json() as {
    isEnabled?: boolean;
    priority?:  number;
    timeoutMs?: number;
    callsLimit?: number;
  };
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  await db.update(tenantSupplierConfigs)
    .set({ ...body, updatedAt: new Date() })
    .where(
      and(
        eq(tenantSupplierConfigs.tenantId, tenantId),
        eq(tenantSupplierConfigs.supplier, c.req.param("supplier") as "RIYA"),
      ),
    );

  // Invalidate tenant cache so next request picks up new supplier config
  const tenant = c.get("tenant");
  await c.env.TENANT_CACHE_KV.delete(`tenant:host:${tenant.slug}.flypoomas.com`);

  return c.json({ ok: true });
});
