import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Env, Variables } from "./types.js";
import { resolveTenant } from "./middleware/tenant.js";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/ratelimit.js";
import { searchRoutes }  from "./routes/search.js";
import { bookingRoutes } from "./routes/booking.js";
import { agentRoutes }   from "./routes/agents.js";
import { walletRoutes }  from "./routes/wallet.js";
import { authRoutes }    from "./routes/auth.js";
import { adminRoutes }   from "./routes/admin/index.js";
import { webhookRoutes } from "./routes/webhooks/index.js";
import { TenantRateLimiter } from "./lib/rate-limiter.js";
import { handleBookingQueue, handleNotifyQueue } from "./queue-consumer.js";
import { paymentRoutes } from "./routes/payments.js";
import { eticketRoutes } from "./routes/eticket.js";
import { sessionRoutes } from "./routes/session.js";

// Export Durable Object class (required for wrangler migration)
export { TenantRateLimiter };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Global middleware ──────────────────────────────────────────
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors({
  origin:      (origin) => origin,  // Tenants have different origins
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Tenant-ID", "X-API-Key", "x-tenant-slug", "X-Session-ID", "X-Channel"],
}));

// ── Tenant resolution ─────────────────────────────────────────
// Derives tenant from subdomain/custom-domain — never trusts client-supplied tenant_id
app.use("*", resolveTenant);

// ── Rate limiting (per-tenant, via Durable Objects) ───────────
app.use("/api/*", rateLimitMiddleware);

// ── Health check ───────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", env: c.env.ENVIRONMENT }));

// ── Public routes (no auth) ────────────────────────────────────
app.route("/api/auth",     authRoutes);

// Webhooks use their own signature-based verification, not JWT auth
app.route("/webhooks",     webhookRoutes);

// ── Authenticated routes ───────────────────────────────────────
app.use("/api/*", authMiddleware);

app.route("/api/search",   searchRoutes);
app.route("/api/session",  sessionRoutes);
app.route("/api/bookings", bookingRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/api/eticket",  eticketRoutes);
app.route("/api/agents",   agentRoutes);
app.route("/api/wallet",   walletRoutes);

// Super-admin routes — additionally require SUPER_ADMIN role (enforced inside)
app.route("/api/admin",    adminRoutes);

// ── 404 handler ────────────────────────────────────────────────
app.notFound((c) => c.json({ error: "Not found" }, 404));

// ── Error handler ──────────────────────────────────────────────
app.onError((err, c) => {
  console.error(err);
  const status = "status" in err ? (err as { status: number }).status : 500;
  return c.json({ error: err.message ?? "Internal server error" }, status as 400 | 500);
});

export default {
  fetch: app.fetch.bind(app),

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    if (batch.queue === "poomas-bookings") {
      await handleBookingQueue(batch as MessageBatch<never>, env);
    } else if (batch.queue === "poomas-notifications") {
      await handleNotifyQueue(batch as MessageBatch<never>, env);
    }
  },
};
