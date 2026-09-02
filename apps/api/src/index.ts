import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Env, Variables } from "./types.js";
import { resolveTenant } from "./middleware/tenant.js";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/ratelimit.js";
import { searchRoutes }        from "./routes/search.js";
import { bookingRoutes }       from "./routes/booking.js";
import { duffelSandboxRoutes } from "./routes/duffel-sandbox.js";
import { integrationRoutes }   from "./routes/integrations.js";
import { agentRoutes }         from "./routes/agents.js";
import { walletRoutes }        from "./routes/wallet.js";
import { authRoutes }          from "./routes/auth.js";
import { adminRoutes }         from "./routes/admin/index.js";
import { webhookRoutes }       from "./routes/webhooks/index.js";
import { TenantRateLimiter }   from "./lib/rate-limiter.js";
import { handleBookingQueue, handleNotifyQueue } from "./queue-consumer.js";
import { paymentRoutes }       from "./routes/payments.js";
import { eticketRoutes }       from "./routes/eticket.js";
import { sessionRoutes }       from "./routes/session.js";
import { checkoutRoutes }      from "./routes/checkout.js";
import { whatsappRoutes }      from "./routes/whatsapp.js";
import { partnerRoutes }       from "./routes/partner.js";

export { TenantRateLimiter };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors({origin:(origin)=>origin,credentials:true,allowMethods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"],allowHeaders:["Content-Type","Authorization","X-Tenant-ID","X-API-Key","x-tenant-slug","X-Session-ID","X-Channel","X-POOMAS-INTEGRATION-KEY","X-Checkout-Token"]}));
app.get("/health",(c)=>c.json({status:"ok",env:c.env.ENVIRONMENT,worker:"poomas-api",timestamp:new Date().toISOString()}));
app.use("*", resolveTenant);
app.use("/api/*", rateLimitMiddleware);

// ── Public routes (no auth) ────────────────────────────────────
app.route("/api/auth",           authRoutes);
app.route("/webhooks",           webhookRoutes);
app.route("/api/search",         searchRoutes);
app.route("/api/duffel-sandbox", duffelSandboxRoutes);
app.route("/api/integrations",   integrationRoutes);
app.route("/api/partner/v1",    partnerRoutes);

// Checkout token verification — validated by the signed JWT token itself
app.route("/api/checkout",       checkoutRoutes);

// ── Authenticated routes ───────────────────────────────────────
app.use("/api/bookings/*", authMiddleware);
app.use("/api/payments/*", authMiddleware);
app.use("/api/eticket/*",  authMiddleware);
app.use("/api/agents/*",   authMiddleware);
app.use("/api/wallet/*",   authMiddleware);
app.use("/api/session/*",  authMiddleware);
app.use("/api/admin/*",    authMiddleware);
app.use("/api/whatsapp/*", authMiddleware);

app.route("/api/session",  sessionRoutes);
app.route("/api/bookings", bookingRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/api/eticket",  eticketRoutes);
app.route("/api/agents",   agentRoutes);
app.route("/api/wallet",   walletRoutes);
app.route("/api/whatsapp", whatsappRoutes);
app.route("/api/admin",    adminRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
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
