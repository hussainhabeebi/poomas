// POST /api/payments/checkout  — create Razorpay order or NoMod payment link
// POST /api/payments/verify    — verify Razorpay signature and confirm booking
// GET  /api/payments/checkout/:bookingId — poll payment status (used by queue-based flow)
// GET  /api/payments/:bookingId — get raw payment record

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { bookings, payments } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../types.js";

export const paymentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolvePaymentKeys(env: Env, settings: Record<string, any> | null, gateway: string) {
  if (gateway === "RAZORPAY") {
    const keyId     = settings?.razorpay?.keyId     || env.RAZORPAY_KEY_ID;
    const keySecret = settings?.razorpay?.keySecret || env.RAZORPAY_KEY_SECRET;
    return { keyId, keySecret };
  }
  if (gateway === "NOMOD") {
    const apiKey    = settings?.nomod?.apiKey    || env.NOMOD_API_KEY;
    const apiSecret = settings?.nomod?.apiSecret || env.NOMOD_API_SECRET;
    return { apiKey, apiSecret };
  }
  return {};
}

async function getTenantPaymentSettings(env: Env, tenantId: string) {
  const raw = await env.TENANT_CACHE_KV.get(`admin_settings:${tenantId}:payments`);
  return raw ? JSON.parse(raw) : null;
}

// ── POST /api/payments/checkout ───────────────────────────────────────────────

const checkoutSchema = z.object({
  bookingId: z.string(),
  gateway:   z.enum(["RAZORPAY", "NOMOD"]).default("RAZORPAY"),
  currency:  z.enum(["INR", "AED", "USD"]).optional(),
});

paymentRoutes.post("/checkout", zValidator("json", checkoutSchema), async (c) => {
  const { bookingId, gateway, currency } = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const [booking] = await db
    .select({
      id:          bookings.id,
      status:      bookings.status,
      totalAmount: bookings.totalAmount,
      currency:    bookings.currency,
      contactEmail: bookings.contactEmail,
      contactPhone: bookings.contactPhone,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });
  if (!["HELD", "PAYMENT_PENDING"].includes(booking.status)) {
    throw new HTTPException(400, { message: `Booking is ${booking.status}` });
  }

  const settings   = await getTenantPaymentSettings(c.env, tenantId);
  const amountFull = parseFloat(booking.totalAmount);
  const cur        = currency ?? booking.currency;

  if (gateway === "RAZORPAY") {
    const { keyId, keySecret } = resolvePaymentKeys(c.env, settings, "RAZORPAY") as { keyId: string; keySecret: string };
    if (!keyId || !keySecret) throw new HTTPException(503, { message: "Razorpay not configured" });

    // Create Razorpay order (paise for INR, fils for AED)
    const amountMinor = Math.round(amountFull * 100);
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      },
      body: JSON.stringify({
        amount:          amountMinor,
        currency:        cur,
        receipt:         bookingId,
        notes:           { tenantId, bookingId },
        payment_capture: 1,
      }),
    });

    if (!orderRes.ok) {
      const e = await orderRes.json() as { error?: { description?: string } };
      throw new HTTPException(502, { message: `Razorpay order failed: ${e.error?.description}` });
    }

    const order = await orderRes.json() as { id: string; amount: number; currency: string };

    // Record pending payment in DB
    await db.insert(payments).values({
      bookingId,
      gateway:        "RAZORPAY",
      gatewayOrderId: order.id,
      amount:         String(amountFull),
      currency:       cur as "INR" | "AED" | "USD",
      status:         "PENDING",
    });

    return c.json({ orderId: order.id, keyId, amount: order.amount, currency: order.currency });
  }

  if (gateway === "NOMOD") {
    const { apiKey, apiSecret } = resolvePaymentKeys(c.env, settings, "NOMOD") as { apiKey: string; apiSecret: string };
    if (!apiKey) throw new HTTPException(503, { message: "NoMod not configured" });

    const isProduction = settings?.nomod?.environment === "production";
    const nomodBase    = isProduction ? "https://api.nomod.com" : "https://sandbox.nomod.com";

    const linkRes = await fetch(`${nomodBase}/v1/payment-links`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        amount:      amountFull,
        currency:    cur,
        reference:   bookingId,
        description: `POOMAS booking ${bookingId}`,
        customer: {
          email: booking.contactEmail,
          phone: booking.contactPhone,
        },
        redirect_url: `https://flypoomas.com/checkout/complete?bookingId=${bookingId}`,
      }),
    });

    if (!linkRes.ok) {
      const e = await linkRes.json() as { message?: string };
      throw new HTTPException(502, { message: `NoMod link failed: ${e.message}` });
    }

    const link = await linkRes.json() as { id: string; payment_url: string };

    await db.insert(payments).values({
      bookingId,
      gateway:        "NOMOD",
      gatewayOrderId: link.id,
      amount:         String(amountFull),
      currency:       cur as "INR" | "AED" | "USD",
      status:         "PENDING",
    });

    return c.json({ paymentUrl: link.payment_url, orderId: link.id, amount: amountFull, currency: cur });
  }

  throw new HTTPException(400, { message: "Unsupported gateway" });
});

// ── POST /api/payments/verify — verify Razorpay signature + confirm booking ──

const verifySchema = z.object({
  bookingId:  z.string(),
  paymentId:  z.string(),
  orderId:    z.string(),
  signature:  z.string(),
  gateway:    z.enum(["RAZORPAY"]).default("RAZORPAY"),
});

paymentRoutes.post("/verify", zValidator("json", verifySchema), async (c) => {
  const { bookingId, paymentId, orderId, signature } = c.req.valid("json");
  const tenantId = c.get("tenantId");
  const db       = c.get("db");

  const settings = await getTenantPaymentSettings(c.env, tenantId);
  const { keySecret } = resolvePaymentKeys(c.env, settings, "RAZORPAY") as { keyId: string; keySecret: string };
  if (!keySecret) throw new HTTPException(503, { message: "Razorpay not configured" });

  // Verify HMAC-SHA256: sign(orderId + "|" + paymentId, keySecret)
  const message  = `${orderId}|${paymentId}`;
  const key      = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(keySecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig    = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

  if (expected !== signature) {
    throw new HTTPException(400, { message: "Invalid payment signature" });
  }

  // Mark payment as SUCCESS and queue booking confirmation
  await db.update(payments)
    .set({ status: "SUCCESS", gatewayPaymentId: paymentId, updatedAt: new Date() })
    .where(eq(payments.gatewayOrderId, orderId));

  await db.update(bookings)
    .set({ status: "PAYMENT_PENDING" as any, updatedAt: new Date() } as any)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)));

  await c.env.BOOKING_QUEUE.send({
    type:             "PAYMENT_CAPTURED",
    gatewayPaymentId: paymentId,
    orderId,
    bookingId,
    tenantId,
  });

  // Get updated PNR if already set
  const [booking] = await db
    .select({ pnr: bookings.pnr, status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  return c.json({ ok: true, pnr: booking?.pnr ?? null, status: booking?.status });
});

// ── GET /api/payments/checkout/:bookingId — poll status ──────────────────────

paymentRoutes.get("/checkout/:bookingId", async (c) => {
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");
  const bookingId = c.req.param("bookingId");

  const [booking] = await db
    .select({ id: bookings.id, status: bookings.status, totalAmount: bookings.totalAmount, currency: bookings.currency })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });

  const payUrlRaw = await c.env.SESSIONS_KV.get(`pay_url:${bookingId}`);
  if (!payUrlRaw) {
    return c.json({ bookingId, status: booking.status, totalAmount: booking.totalAmount, currency: booking.currency, ready: false });
  }

  return c.json({ bookingId, status: booking.status, totalAmount: booking.totalAmount, currency: booking.currency, ready: true, ...JSON.parse(payUrlRaw) });
});

// ── GET /api/payments/:bookingId — raw payment record ────────────────────────

paymentRoutes.get("/:bookingId", async (c) => {
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");
  const bookingId = c.req.param("bookingId");

  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });

  const [payment] = await db
    .select({
      id:               payments.id,
      gateway:          payments.gateway,
      gatewayOrderId:   payments.gatewayOrderId,
      gatewayPaymentId: payments.gatewayPaymentId,
      amount:           payments.amount,
      currency:         payments.currency,
      status:           payments.status,
      createdAt:        payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .limit(1);

  return c.json({ bookingId, payment: payment ?? null });
});
