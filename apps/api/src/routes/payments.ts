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
    const { apiKey } = resolvePaymentKeys(c.env, settings, "NOMOD") as { apiKey: string };
    if (!settings?.nomod?.enabled || !apiKey) {
      throw new HTTPException(503, { message: "Nomod is not enabled or its API key is missing" });
    }

    const checkoutToken = c.req.header("X-Checkout-Token") ?? "";
    const resultUrl = `https://flypoomas.com/checkout/payment-result?bookingId=${encodeURIComponent(bookingId)}&token=${encodeURIComponent(checkoutToken)}`;
    const amount = amountFull.toFixed(2);

    // Nomod Links API: https://nomod.com/docs/api-reference/generate-link
    const linkRes = await fetch("https://api.nomod.com/v1/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        currency: cur,
        items: [{ name: `POOMAS flight booking ${bookingId.slice(0, 8)}`, amount, quantity: 1 }],
        title: "POOMAS flight booking",
        note: `Payment for booking ${bookingId}`,
        shipping_address_required: false,
        allow_tip: false,
        allow_tabby: settings.nomod.allowTabby ?? true,
        allow_tamara: settings.nomod.allowTamara ?? true,
        allow_service_fee: false,
        payment_expiry_limit: 1,
        success_url: `${resultUrl}&result=success`,
        failure_url: `${resultUrl}&result=failed`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const raw = await linkRes.text();
    let link: { id?: string; url?: string; amount?: string; currency?: string; error?: { message?: string } } = {};
    try { link = raw ? JSON.parse(raw) : {}; } catch {}
    if (!linkRes.ok || !link.id || !link.url) {
      const message = link.error?.message || raw.slice(0, 240) || `HTTP ${linkRes.status}`;
      throw new HTTPException(502, { message: `Nomod link failed: ${message}` });
    }

    await db.insert(payments).values({
      bookingId,
      gateway:        "NOMOD",
      gatewayOrderId: link.id,
      amount:         String(amountFull),
      currency:       cur as "INR" | "AED" | "USD",
      status:         "PENDING",
      gatewayResponse: { linkId: link.id, linkUrl: link.url },
    });

    return c.json({
      paymentUrl: link.url,
      orderId: link.id,
      amount: Number(link.amount ?? amount),
      currency: link.currency ?? cur,
    });
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
