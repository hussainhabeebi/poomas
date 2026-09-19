import type { Handler } from "hono";
import { payments, bookings } from "@poomas/db/schema";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";

export const nomodWebhook: Handler<{ Bindings: Env; Variables: Variables }> = async (c) => {
  const rawBody   = await c.req.text();
  const signature = c.req.header("X-Nomod-Signature") ?? "";

  // Verify signature with HMAC-SHA256 (same pattern as Razorpay)
  const secret  = new TextEncoder().encode(c.env.NOMOD_WEBHOOK_SECRET);
  const data    = new TextEncoder().encode(rawBody);
  const key     = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sigBytes = Uint8Array.from(Buffer.from(signature, "hex"));
  const valid    = await crypto.subtle.verify("HMAC", key, sigBytes, data);

  if (!valid) {
    return c.json({ error: "Invalid signature" }, 400);
  }

  const event = JSON.parse(rawBody) as {
    event_type: string;
    payment_id: string;
    order_ref:  string;
    amount:     number;
    currency:   string;
  };

  const db = c.get("db");

  if (event.event_type === "PAYMENT_SUCCESS") {
    // Look up booking before updating payment so we have the id
    const [pm] = await db
      .select({ bookingId: payments.bookingId })
      .from(payments)
      .where(eq(payments.gatewayOrderId, event.order_ref))
      .limit(1);

    await db.update(payments)
      .set({ status: "SUCCESS", gatewayPaymentId: event.payment_id, updatedAt: new Date() })
      .where(eq(payments.gatewayOrderId, event.order_ref));

    if (pm?.bookingId) {
      await db.update(bookings)
        .set({ status: "PAYMENT_PENDING", updatedAt: new Date() })
        .where(eq(bookings.id, pm.bookingId));
    }

    await c.env.BOOKING_QUEUE.send({
      type:             "PAYMENT_CAPTURED",
      gatewayPaymentId: event.payment_id,
      orderId:          event.order_ref,
      amount:           event.amount,
    });
  }

  return c.json({ ok: true });
};
