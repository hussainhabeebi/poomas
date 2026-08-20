// POST /api/payments/checkout — returns payment URL or Razorpay order for frontend checkout
// GET  /api/payments/:bookingId — returns payment status and gateway info

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bookings, payments } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../types.js";

export const paymentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get payment checkout info for a booking (polled by frontend after booking creation)
paymentRoutes.get("/checkout/:bookingId", async (c) => {
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");
  const bookingId = c.req.param("bookingId");

  // Verify booking belongs to this tenant
  const [booking] = await db
    .select({ id: bookings.id, status: bookings.status, totalAmount: bookings.totalAmount, currency: bookings.currency })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) {
    throw new HTTPException(404, { message: "Booking not found" });
  }

  // Try to get payment URL from KV (set by queue consumer after INITIATE_PAYMENT)
  const payUrlRaw = await c.env.SESSIONS_KV.get(`pay_url:${bookingId}`);

  if (!payUrlRaw) {
    // Payment not yet initiated or URL expired
    return c.json({
      bookingId,
      status:      booking.status,
      totalAmount: booking.totalAmount,
      currency:    booking.currency,
      ready:       false,
    });
  }

  const gatewayInfo = JSON.parse(payUrlRaw);
  return c.json({
    bookingId,
    status:      booking.status,
    totalAmount: booking.totalAmount,
    currency:    booking.currency,
    ready:       true,
    ...gatewayInfo,
  });
});

// Get payment record for a booking
paymentRoutes.get("/:bookingId", async (c) => {
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");
  const bookingId = c.req.param("bookingId");

  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) {
    throw new HTTPException(404, { message: "Booking not found" });
  }

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
