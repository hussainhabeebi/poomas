// Keeps paid bookings moving to the airline and makes failures visible.
//
// - The booking queue records its last error per booking (shown in Admin).
// - A short lock stops two queue runs booking the same seat at once.
// - While the customer waits on the confirmation page, a paid booking still in
//   PAYMENT_PENDING after a few minutes is sent to the queue again.

import { payments } from "@poomas/db/schema";
import type { Db } from "@poomas/db";
import { and, desc, eq } from "drizzle-orm";
import type { Env } from "../types.js";

const ERROR_TTL = 60 * 60 * 24 * 14;
const LOCK_TTL = 180;           // longer than a TripJack book + booking-details round trip
const RESEND_AFTER_MS = 3 * 60 * 1000;
const RESEND_EVERY = 180;       // seconds between automatic re-sends

const errorKey = (bookingId: string) => `booking_queue_error:${bookingId}`;
const lockKey = (bookingId: string) => `booking_queue_lock:${bookingId}`;
const resendKey = (bookingId: string) => `booking_queue_resend:${bookingId}`;

export interface BookingQueueError { message: string; attempt: number; at: string }

export async function recordBookingError(env: Env, bookingId: string, err: unknown, attempt: number) {
  const value: BookingQueueError = {
    message: err instanceof Error ? err.message : String(err),
    attempt,
    at: new Date().toISOString(),
  };
  try {
    await env.TENANT_CACHE_KV.put(errorKey(bookingId), JSON.stringify(value), { expirationTtl: ERROR_TTL });
  } catch (e) {
    console.error(`[booking-recovery] could not record error for ${bookingId}`, e);
  }
}

export async function readBookingError(env: Env, bookingId: string): Promise<BookingQueueError | null> {
  try {
    return await env.TENANT_CACHE_KV.get(errorKey(bookingId), "json") as BookingQueueError | null;
  } catch {
    return null;
  }
}

// Best-effort: KV is eventually consistent, so this narrows (not eliminates) overlap.
export async function acquireBookingLock(env: Env, bookingId: string): Promise<boolean> {
  try {
    if (await env.TENANT_CACHE_KV.get(lockKey(bookingId))) return false;
    await env.TENANT_CACHE_KV.put(lockKey(bookingId), new Date().toISOString(), { expirationTtl: LOCK_TTL });
  } catch {}
  return true;
}

export async function releaseBookingLock(env: Env, bookingId: string) {
  try { await env.TENANT_CACHE_KV.delete(lockKey(bookingId)); } catch {}
}

export async function sendPaidBookingToQueue(db: Db, env: Env, bookingId: string): Promise<boolean> {
  const [payment] = await db
    .select({ gatewayOrderId: payments.gatewayOrderId, gatewayPaymentId: payments.gatewayPaymentId, amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "SUCCESS")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!payment?.gatewayOrderId) return false;
  await env.BOOKING_QUEUE.send({
    type:             "PAYMENT_CAPTURED",
    gatewayPaymentId: payment.gatewayPaymentId ?? payment.gatewayOrderId,
    orderId:          payment.gatewayOrderId,
    amount:           Number(payment.amount),
  });
  return true;
}

// Called while the customer waits: re-send a paid booking the queue has not finished.
export async function resendStalledBooking(
  db: Db, env: Env,
  booking: { id: string; status: string; updatedAt: Date | string },
): Promise<void> {
  if (booking.status !== "PAYMENT_PENDING") return;
  if (Date.now() - new Date(booking.updatedAt).getTime() < RESEND_AFTER_MS) return;
  try {
    if (await env.TENANT_CACHE_KV.get(resendKey(booking.id))) return;
    if (await env.TENANT_CACHE_KV.get(lockKey(booking.id))) return;
    await env.TENANT_CACHE_KV.put(resendKey(booking.id), "1", { expirationTtl: RESEND_EVERY });
    if (await sendPaidBookingToQueue(db, env, booking.id)) {
      console.warn(`[booking-recovery] re-sent stalled paid booking ${booking.id} to the queue`);
    }
  } catch (err) {
    console.error(`[booking-recovery] re-send failed for ${booking.id}`, err);
  }
}
