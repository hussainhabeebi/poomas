// POST /api/book — public B2C direct booking (no auth required)
// TripJack and Riya support direct booking without an explicit hold step.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { getBookableAdapter, TripjackClient } from "@poomas/suppliers";
import { normalizeBookingResponse } from "../lib/booking-response.js";
import { resolveFlightSuppliers } from "./search.js";
import { bookings, bookingPassengers } from "@poomas/db/schema";
import type { Env, Variables } from "../types.js";

const passengerSchema = z.object({
  type:            z.enum(["ADULT", "CHILD", "INFANT"]),
  firstName:       z.string().min(1),
  lastName:        z.string().min(1),
  dob:             z.string().optional(),
  gender:          z.enum(["M", "F"]).optional(),
  nationality:     z.string().max(2).optional(),
  passportNumber:  z.string().optional(),
  passportExpiry:  z.string().optional(),
});

const directBookSchema = z.object({
  fareId:        z.string().min(1),
  supplier:      z.enum(["TRIPJACK", "RIYA"]),
  passengers:    z.array(passengerSchema).min(1).max(9),
  contactEmail:  z.string().email(),
  contactPhone:  z.string().min(7),
  // Fare data for the DB record (sourced from the search result displayed to the user)
  origin:        z.string().length(3),
  destination:   z.string().length(3),
  departureDate: z.string().date(),
  totalFare:     z.number().positive(),
  currency:      z.enum(["INR", "AED", "USD"]).default("INR"),
});

export const bookDirectRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

bookDirectRoutes.post("/", zValidator("json", directBookSchema, (result, c) => {
  if (!result.success) return c.json({ errorCode: "BOOKING_DETAILS_INVALID" }, 400);
}), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const tenant   = c.get("tenant");
  const requestId = crypto.randomUUID();

  const { platformCredentials: platformCreds, supplierConfigs } = await resolveFlightSuppliers(c.env, tenant, tenantId);

  if (!supplierConfigs.some((s) => s.name === body.supplier && s.isEnabled)) {
    return c.json({ errorCode: "BOOKING_UNAVAILABLE", requestId }, 503);
  }
  const adapter = getBookableAdapter(body.supplier, supplierConfigs, platformCreds);
  if (!adapter.book) {
    throw new HTTPException(400, { message: `${body.supplier} does not support direct booking` });
  }

  // TripJack fare IDs are search references. Review immediately before booking so
  // the supplier gives us a fresh booking session instead of rejecting a stale ID.
  let bookingSessionId = body.fareId;
  let tripjackClient: TripjackClient | undefined;
  if (body.supplier === "TRIPJACK") {
    const tripjackConfig = supplierConfigs.find((s) => s.name === "TRIPJACK");
    const client = new TripjackClient({
      ...(platformCreds.TRIPJACK ?? {}),
      ...(tripjackConfig?.credentials ?? {}),
    });
    tripjackClient = client;
    let reviewPaymentAmount: number | undefined;
    try {
      const review = await client.validateFare(body.fareId);
      bookingSessionId = review.bookingId;
      // Extract TF (total fare) from review — TripJack requires paymentInfos.amount = TF exactly
      const rr = review.result as any;
      const rResp = rr?.data ?? rr?.result ?? rr;
      reviewPaymentAmount = rResp?.totalPriceInfo?.fd?.fC?.TF as number | undefined;
    } catch (err: any) {
      console.error("[book-review]", JSON.stringify({ code: err?.code, requestId: err?.requestId }));
      return c.json({ error: err?.code === "FARE_EXPIRED" ? "This fare is no longer available." : "We couldn't confirm availability. Your details are still here.",
        errorCode: err?.code === "FARE_EXPIRED" ? "FARE_EXPIRED" : "FARE_REVIEW_FAILED",
        diagnosticCode: err?.code, requestId: err?.requestId ?? requestId }, err?.code === "FARE_EXPIRED" ? 409 : 503);
    }
  }

  let result;
  try {
    const params = {
      fareId:         body.fareId,
      holdId:         bookingSessionId,
      passengers:     body.passengers,
      contactEmail:   body.contactEmail,
      contactPhone:   body.contactPhone,
      paymentRef:     "DIRECT_B2C",
      paymentAmount:  reviewPaymentAmount ?? body.totalFare,
    };
    result = tripjackClient
      ? normalizeBookingResponse(await tripjackClient.book(params), bookingSessionId)
      : await adapter.book(params);
  } catch (err: any) {
    // Once sent, a network/5xx failure cannot establish that no booking exists.
    const status = Number(err?.statusCode);
    if (status === 409) {
      return c.json({ errorCode: "FARE_EXPIRED", requestId }, 409);
    }
    const rejected = [400, 401, 403, 404, 422, 429].includes(status);
    console.error("[book-submit]", JSON.stringify({ requestId, httpStatus: status || null,
      code: rejected ? "BOOKING_REJECTED" : "BOOKING_STATUS_UNKNOWN" }));
    return c.json({ errorCode: rejected ? "BOOKING_REJECTED" : "BOOKING_STATUS_UNKNOWN",
      requestId, bookingReference: bookingSessionId }, rejected ? 422 : 502);
  }

  if (!result.success) {
    // If the raw TripJack response indicates session/fare expiry, surface it as FARE_EXPIRED
    // so the frontend shows "search again" rather than "contact support".
    const rawMsg = String((result.raw as any)?.status?.statusMessage ?? "").toLowerCase();
    if (/expir|no longer available|booking session/i.test(rawMsg)) {
      return c.json({ errorCode: "FARE_EXPIRED", requestId }, 409);
    }
    return c.json({ errorCode: "BOOKING_REJECTED", requestId }, 422);
  }

  // Persist booking record
  let booking: typeof bookings.$inferSelect | undefined;
  try {
  [booking] = await db.insert(bookings).values({
    tenantId,
    channel:            "B2C_WEB",
    status:             result.status === "CONFIRMED" || result.status === "TICKETED" ? "CONFIRMED" : "HELD",
    tripType:           "ONEWAY",
    cabinClass:         "ECONOMY",
    origin:             body.origin.toUpperCase(),
    destination:        body.destination.toUpperCase(),
    departureDate:      new Date(body.departureDate),
    flightData:         {},
    adultCount:         body.passengers.filter((p) => p.type === "ADULT").length,
    childCount:         body.passengers.filter((p) => p.type === "CHILD").length,
    infantCount:        body.passengers.filter((p) => p.type === "INFANT").length,
    baseFare:           String(body.totalFare),
    taxes:              "0",
    totalAmount:        String(body.totalFare),
    currency:           body.currency,
    supplier:           body.supplier,
    supplierBookingRef: result.bookingRef,
    pnr:                result.pnr ?? null,
    contactEmail:       body.contactEmail,
    contactPhone:       body.contactPhone,
  }).returning();

  const bookingId = booking.id;
  await db.insert(bookingPassengers).values(
    body.passengers.map((p) => ({
      bookingId,
      passengerType:   p.type,
      firstName:       p.firstName,
      lastName:        p.lastName,
      dob:             p.dob ? new Date(p.dob) : null,
      gender:          p.gender ?? null,
      nationality:     p.nationality ?? null,
      passportNumber:  p.passportNumber  ?? null,
      passportExpiry:  p.passportExpiry  ? new Date(p.passportExpiry) : null,
      passportCountry: p.nationality ?? null,
    })),
  );
  } catch {
    console.error("[book-save]", JSON.stringify({ requestId, bookingReference: result.bookingRef }));
    // The supplier accepted this request. Do not invite a duplicate booking.
    return c.json({ success: true, bookingId: booking?.id, pnr: result.pnr,
      bookingReference: result.bookingRef, status: result.status,
      warningCode: "BOOKING_SAVE_PENDING", requestId }, 202);
  }

  return c.json({
    success:          true,
    bookingId:        booking.id,
    pnr:              result.pnr,
    bookingReference: result.bookingRef,
    status:           result.status,
  }, 201);
});
