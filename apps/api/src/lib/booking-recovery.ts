// Keeps paid bookings moving to the airline and makes failures visible.
//
// - The booking queue records its last error per booking (shown in Admin).
// - A short lock stops two queue runs booking the same seat at once.
// - While the customer waits on the confirmation page, a paid booking still in
//   PAYMENT_PENDING after a few minutes is booked directly (bypassing the queue).

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

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const detail = (err as { supplierDetail?: string; responseSnippet?: string }).supplierDetail
    ?? (err as { responseSnippet?: string }).responseSnippet;
  return detail ? `${err.message} — ${detail}` : err.message;
}

export async function recordBookingError(env: Env, bookingId: string, err: unknown, attempt: number) {
  const value: BookingQueueError = {
    message: describeError(err),
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

// Queue receipts keyed by payment order, so Admin can tell "never received"
// apart from "failed before the booking was loaded".
const seenKey = (orderId: string) => `booking_queue_seen:${orderId}`;

export async function recordQueueReceipt(env: Env, orderId: string, attempt: number, error?: unknown) {
  try {
    await env.TENANT_CACHE_KV.put(seenKey(orderId), JSON.stringify({
      at: new Date().toISOString(), attempt, ...(error ? { error: describeError(error) } : {}),
    }), { expirationTtl: ERROR_TTL });
  } catch {}
}

export async function readQueueReceipt(env: Env, orderId: string) {
  try {
    return await env.TENANT_CACHE_KV.get(seenKey(orderId), "json") as { at: string; attempt: number; error?: string } | null;
  } catch {
    return null;
  }
}

export async function paidBookingMessage(db: Db, bookingId: string) {
  const [payment] = await db
    .select({ gatewayOrderId: payments.gatewayOrderId, gatewayPaymentId: payments.gatewayPaymentId, amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "SUCCESS")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!payment?.gatewayOrderId) return null;
  return {
    type:             "PAYMENT_CAPTURED" as const,
    gatewayPaymentId: payment.gatewayPaymentId ?? payment.gatewayOrderId,
    orderId:          payment.gatewayOrderId,
    amount:           Number(payment.amount),
  };
}

// Called while the customer waits: re-send a paid booking the queue has not finished.
export async function resendStalledBooking(
  db: Db, env: Env,
  booking: { id: string; status: string; updatedAt: Date | string },
  run: (message: NonNullable<Awaited<ReturnType<typeof paidBookingMessage>>>) => Promise<void>,
): Promise<void> {
  if (booking.status !== "PAYMENT_PENDING") return;
  if (Date.now() - new Date(booking.updatedAt).getTime() < RESEND_AFTER_MS) return;
  try {
    if (await env.TENANT_CACHE_KV.get(resendKey(booking.id))) return;
    if (await env.TENANT_CACHE_KV.get(lockKey(booking.id))) return;
    await env.TENANT_CACHE_KV.put(resendKey(booking.id), "1", { expirationTtl: RESEND_EVERY });
    const message = await paidBookingMessage(db, booking.id);
    if (!message) return;
    // Book directly rather than via the queue, in case the queue is what stalled.
    console.warn(`[booking-recovery] booking stalled paid booking ${booking.id} directly`);
    await run(message);
  } catch (err) {
    console.error(`[booking-recovery] re-send failed for ${booking.id}`, err);
  }
}
