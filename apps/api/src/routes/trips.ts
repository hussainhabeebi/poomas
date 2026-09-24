// Customer trips (mounted at /api/profile/trips, customer JWT required)
//   GET  /                     list my bookings
//   GET  /:id                  trip detail (+ live TripJack itinerary, cancellation status)
//   GET  /:id/eticket          e-ticket HTML
//   GET  /:id/itinerary        itinerary HTML download (live TripJack booking details)
//   POST /:id/eticket/send     resend e-ticket by email/WhatsApp
//   POST /:id/cancel/quote     TripJack cancellation charges → refund estimate
//   POST /:id/cancel           submit cancellation (needs a fresh quote)
//
// Guest trips (mounted at /api/trips, no account)
//   POST /lookup               { reference (PNR / booking ref), email } → short-lived trip token
//   GET  /view                 X-Trip-Token → trip detail (read-only)
//   GET  /eticket              X-Trip-Token → e-ticket HTML
//   GET  /itinerary            X-Trip-Token → itinerary HTML download

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { bookings, bookingAmendments } from "@poomas/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Env, Variables } from "../types.js";
import { itineraryFileName, renderItineraryHtml } from "../lib/itinerary.js";
import { signToken, verifyToken } from "./checkout.js";
import {
  QUOTE_TTL, buildQuote, cancellationBlocker, liveItinerary, loadTrip, logCancellationCall, originalRefundMethod,
  parseCancellationCharges, publicTrip, syncCancellation, tripjackClientFor, type CancellationQuote,
} from "../lib/trips.js";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

// ── Signed-in customer ───────────────────────────────────────────────────────

export const customerTripRoutes: App = new Hono();

customerTripRoutes.use("*", async (c, next) => {
  if (c.get("userRole") !== "CUSTOMER" || !c.get("userId")) {
    throw new HTTPException(403, { message: "Sign in with a customer account to see your trips" });
  }
  return next();
});

async function ownTrip(c: any, id: string) {
  const trip = await loadTrip(c.get("db"), c.get("tenantId"), id);
  if (!trip || trip.booking.userId !== c.get("userId")) throw new HTTPException(404, { message: "Booking not found" });
  return trip;
}

customerTripRoutes.get("/", async (c) => {
  const rows = await c.get("db").select({
    id: bookings.id, status: bookings.status, pnr: bookings.pnr, origin: bookings.origin,
    destination: bookings.destination, departureDate: bookings.departureDate, totalAmount: bookings.totalAmount,
    currency: bookings.currency, adultCount: bookings.adultCount, childCount: bookings.childCount,
    infantCount: bookings.infantCount, createdAt: bookings.createdAt,
  })
    .from(bookings)
    .where(and(eq(bookings.tenantId, c.get("tenantId")), eq(bookings.userId, c.get("userId")!)))
    .orderBy(desc(bookings.createdAt))
    .limit(100);
  return c.json({ trips: rows.map((r) => ({ ...r, totalAmount: Number(r.totalAmount) })) });
});

customerTripRoutes.get("/:id", async (c) => {
  let trip = await ownTrip(c, c.req.param("id"));
  // Advance any in-flight cancellation (refunds to wallet on success).
  const active = trip.amendments.find((a) => ["SUBMITTED", "PROCESSING"].includes(a.status) || (a.status === "SUCCESS" && !a.refundedAt));
  if (active) {
    await syncCancellation(c, active);
    trip = await ownTrip(c, c.req.param("id"));
  }
  const itinerary = await liveItinerary(c, trip.booking);
  return c.json({ trip: publicTrip(trip, itinerary), cancelBlocker: cancellationBlocker(trip.booking, trip.amendments) });
});

customerTripRoutes.get("/:id/eticket", async (c) => {
  const trip = await ownTrip(c, c.req.param("id"));
  return eticketResponse(c, trip.booking);
});

customerTripRoutes.get("/:id/itinerary", async (c) => {
  const trip = await ownTrip(c, c.req.param("id"));
  return itineraryResponse(c, trip);
});

customerTripRoutes.post("/:id/eticket/send", async (c) => {
  const trip = await ownTrip(c, c.req.param("id"));
  if (!["CONFIRMED", "TICKETED"].includes(trip.booking.status)) {
    throw new HTTPException(400, { message: "The e-ticket is available once the booking is confirmed" });
  }
  const key = `etickets/${trip.booking.id}.html`;
  if (!(await c.env.DOCUMENTS_R2.head(key))) throw new HTTPException(404, { message: "E-ticket is not ready yet" });
  // Throttle: one resend per booking per 2 minutes.
  const throttleKey = `eticket_resend:${trip.booking.id}`;
  if (await c.env.SESSIONS_KV.get(throttleKey)) throw new HTTPException(429, { message: "E-ticket was just sent. Please check your email and WhatsApp." });
  await c.env.SESSIONS_KV.put(throttleKey, "1", { expirationTtl: 120 });
  await c.env.NOTIFY_QUEUE.send({ type: "NOTIFY_BOOKING_CONFIRMATION", bookingId: trip.booking.id, tenantId: trip.booking.tenantId, eticketKey: key });
  return c.json({ ok: true, email: trip.booking.contactEmail, phone: trip.booking.contactPhone });
});

customerTripRoutes.post("/:id/cancel/quote", async (c) => {
  const trip = await ownTrip(c, c.req.param("id"));
  const blocker = cancellationBlocker(trip.booking, trip.amendments);
  if (blocker) throw new HTTPException(409, { message: blocker });

  let raw: any;
  try {
    raw = await (await tripjackClientFor(c, trip.booking.id)).amendmentCharges(trip.booking.supplierBookingRef!);
  } catch (err: any) {
    logCancellationCall(c, { endpoint: "/oms/v1/air/amendment/amendment-charges", level: "ERROR", bookingId: trip.booking.id, errorMessage: err?.message, errorCode: "CHARGES_FAILED" });
    return c.json({ error: "We couldn't fetch the cancellation charges right now. Please try again in a few minutes, or ask our team to cancel for you.", supportSuggested: true }, 502);
  }
  const parsed = parseCancellationCharges(raw, trip.booking);
  logCancellationCall(c, { endpoint: "/oms/v1/air/amendment/amendment-charges", level: parsed ? "INFO" : "WARN", bookingId: trip.booking.id, snippet: raw, errorCode: parsed ? undefined : "CHARGES_UNREADABLE" });
  if (!parsed) {
    return c.json({ error: "The airline's cancellation charges aren't available online for this ticket. Our team can cancel it for you.", supportSuggested: true }, 422);
  }
  const paid = trip.payments.find((p) => p.status === "SUCCESS");
  const quote = buildQuote(trip.booking, parsed, originalRefundMethod(paid, Boolean(trip.booking.userId)));
  await c.env.SESSIONS_KV.put(`cancel_quote:${trip.booking.id}`, JSON.stringify({ ...quote, userId: c.get("userId"), raw }), { expirationTtl: QUOTE_TTL });
  return c.json({ quote, validForSeconds: QUOTE_TTL });
});

customerTripRoutes.post("/:id/cancel", zValidator("json", z.object({ confirm: z.literal(true) })), async (c) => {
  const db = c.get("db");
  const userId = c.get("userId")!;
  const trip = await ownTrip(c, c.req.param("id"));
  const booking = trip.booking;
  const blocker = cancellationBlocker(booking, trip.amendments);
  if (blocker) throw new HTTPException(409, { message: blocker });

  const stored = await c.env.SESSIONS_KV.get(`cancel_quote:${booking.id}`, "json") as (CancellationQuote & { userId: string; raw: unknown }) | null;
  if (!stored || stored.userId !== userId) {
    throw new HTTPException(409, { message: "Your cancellation quote expired. Please check the charges again." });
  }

  // Claim the single active-cancellation slot before calling TripJack.
  const [amendment] = await db.insert(bookingAmendments).values({
    tenantId: booking.tenantId, bookingId: booking.id, userId, type: "CANCELLATION", status: "SUBMITTED",
    amountPaid: stored.amountPaid.toFixed(2), supplierCharges: stored.supplierCharges.toFixed(2),
    refundAmount: stored.refundAmount.toFixed(2), currency: booking.currency, refundMethod: stored.refundMethod,
    quote: { ...stored, raw: undefined },
  }).onConflictDoNothing().returning();
  if (!amendment) throw new HTTPException(409, { message: "A cancellation is already in progress for this booking." });
  await c.env.SESSIONS_KV.delete(`cancel_quote:${booking.id}`);

  let raw: any;
  try {
    raw = await (await tripjackClientFor(c, booking.id)).submitCancellation(booking.supplierBookingRef!, `Customer cancellation via website (${booking.id.slice(0, 8)})`);
  } catch (err: any) {
    const httpStatus = typeof err?.statusCode === "number" ? err.statusCode : undefined;
    logCancellationCall(c, { endpoint: "/oms/v1/air/amendment/submit-amendment", level: "ERROR", bookingId: booking.id, errorMessage: err?.message, errorCode: httpStatus ? `HTTP_${httpStatus}` : "SUBMIT_UNKNOWN" });
    if (httpStatus) {
      // TripJack answered with an error: nothing was cancelled, free the slot.
      await db.update(bookingAmendments).set({ status: "FAILED", supplierStatus: `HTTP_${httpStatus}`, updatedAt: new Date() }).where(eq(bookingAmendments.id, amendment.id));
      return c.json({ error: "The airline system didn't accept the cancellation. Your booking is unchanged. Please try again later or contact support." }, 502);
    }
    // No answer (timeout/network): TripJack may have accepted it. Keep it open for our team.
    await db.update(bookingAmendments).set({ adminNote: "Submit outcome unknown (no response). Check TripJack before retrying.", updatedAt: new Date() }).where(eq(bookingAmendments.id, amendment.id));
    return c.json({ ok: true, pending: true, message: "We're confirming your cancellation with the airline. Please don't submit again; we'll update this page." }, 202);
  }

  const root = raw?.data ?? raw?.result ?? raw ?? {};
  const amendmentId = root.amendmentId ?? root.amendmentIds?.[0];
  if (!amendmentId) {
    logCancellationCall(c, { endpoint: "/oms/v1/air/amendment/submit-amendment", level: "ERROR", bookingId: booking.id, snippet: raw, errorCode: "NO_AMENDMENT_ID" });
    await db.update(bookingAmendments).set({ status: "FAILED", lastSupplierResponse: raw, updatedAt: new Date() }).where(eq(bookingAmendments.id, amendment.id));
    return c.json({ error: "The airline system didn't confirm the cancellation request. Your booking is unchanged. Please contact support." }, 502);
  }
  logCancellationCall(c, { endpoint: "/oms/v1/air/amendment/submit-amendment", level: "INFO", bookingId: booking.id, summary: { amendmentId }, snippet: raw });
  await db.update(bookingAmendments).set({
    supplierAmendmentId: String(amendmentId), status: "PROCESSING", lastSupplierResponse: raw, updatedAt: new Date(),
  }).where(eq(bookingAmendments.id, amendment.id));
  return c.json({ ok: true, amendmentId, refundEstimate: stored.refundAmount });
});

async function eticketResponse(c: any, booking: typeof bookings.$inferSelect) {
  if (!["CONFIRMED", "TICKETED"].includes(booking.status)) {
    throw new HTTPException(400, { message: "The e-ticket is available once the booking is confirmed" });
  }
  const obj = await c.env.DOCUMENTS_R2.get(`etickets/${booking.id}.html`);
  if (!obj) throw new HTTPException(404, { message: "E-ticket is not ready yet. Please check again in a few minutes." });
  return c.body(await obj.text(), 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" });
}

// Itinerary as a downloadable HTML file, read live from TripJack booking details.
async function itineraryResponse(c: any, trip: NonNullable<Awaited<ReturnType<typeof loadTrip>>>) {
  const booking = trip.booking;
  if (!["CONFIRMED", "TICKETED"].includes(booking.status)) {
    throw new HTTPException(409, { message: "The itinerary is available once the airline confirms the booking" });
  }
  const itinerary = await liveItinerary(c, booking, { fresh: true });
  if (!itinerary?.segments.length) {
    throw new HTTPException(503, { message: "The airline's itinerary isn't available yet. Please try again in a minute." });
  }
  if (!itinerary.travellers.length) {
    itinerary.travellers = trip.passengers.map((p) => ({ name: `${p.firstName} ${p.lastName}`, type: p.type }));
  }
  const data = {
    bookingId: booking.id, pnr: booking.pnr ?? itinerary.pnr ?? null, status: booking.status, bookedAt: booking.createdAt,
    origin: booking.origin, destination: booking.destination, totalAmount: Number(booking.totalAmount), currency: booking.currency,
    contactEmail: booking.contactEmail, contactPhone: booking.contactPhone, itinerary,
  };
  return c.body(renderItineraryHtml(data), 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Disposition": `attachment; filename="${itineraryFileName(data)}"`,
    "Cache-Control": "private, no-store",
  });
}

// ── Guests (find booking with PNR / reference + email) ───────────────────────

const TRIP_TOKEN_TTL = 2 * 60 * 60;

// Read-only trip access for the booking's own browser (issued after payment).
export async function issueTripToken(c: any, bookingId: string) {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ sub: bookingId, tenantId: c.get("tenantId"), scope: "trip", iat: now, exp: now + TRIP_TOKEN_TTL }, c.env.JWT_SECRET);
}
export const guestTripRoutes: App = new Hono();

guestTripRoutes.post("/lookup", zValidator("json", z.object({
  reference: z.string().trim().min(5).max(64),
  email:     z.string().trim().toLowerCase().email(),
})), async (c) => {
  const { reference, email } = c.req.valid("json");
  const ref = reference.toUpperCase();
  const [booking] = await c.get("db").select({ id: bookings.id }).from(bookings).where(and(
    eq(bookings.tenantId, c.get("tenantId")),
    eq(sql`lower(${bookings.contactEmail})`, email),
    or(eq(sql`upper(${bookings.pnr})`, ref), eq(sql`upper(${bookings.supplierBookingRef})`, ref), eq(sql`upper(${bookings.id})`, ref)),
  )).orderBy(desc(bookings.createdAt)).limit(1);
  if (!booking) throw new HTTPException(404, { message: "We couldn't find a booking with that reference and email." });
  const token = await issueTripToken(c, booking.id);
  return c.json({ token, bookingId: booking.id, expiresIn: TRIP_TOKEN_TTL });
});

async function guestTrip(c: any) {
  const token = c.req.header("X-Trip-Token") ?? "";
  let payload: Record<string, unknown>;
  try { payload = await verifyToken(token, c.env.JWT_SECRET); } catch { throw new HTTPException(401, { message: "This link has expired. Please look up your booking again." }); }
  if (payload.scope !== "trip" || payload.tenantId !== c.get("tenantId") || typeof payload.sub !== "string") {
    throw new HTTPException(401, { message: "Invalid booking link" });
  }
  const trip = await loadTrip(c.get("db"), c.get("tenantId"), payload.sub);
  if (!trip) throw new HTTPException(404, { message: "Booking not found" });
  return trip;
}

guestTripRoutes.get("/view", async (c) => {
  const trip = await guestTrip(c);
  const itinerary = await liveItinerary(c, trip.booking);
  return c.json({ trip: publicTrip(trip, itinerary), cancelBlocker: "Sign in to the account used for this booking, or contact support, to cancel." });
});

guestTripRoutes.get("/eticket", async (c) => eticketResponse(c, (await guestTrip(c)).booking));

guestTripRoutes.get("/itinerary", async (c) => itineraryResponse(c, await guestTrip(c)));

export { guestTrip };
