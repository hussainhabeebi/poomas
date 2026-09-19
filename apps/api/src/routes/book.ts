// POST /api/book — public B2C direct booking (no auth required)
// TripJack and Riya support direct booking without an explicit hold step.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { getBookableAdapter, TripjackClient } from "@poomas/suppliers";
import { normalizeBookingResponse } from "../lib/booking-response.js";
import { resolveFlightSuppliers } from "./search.js";
import { logSupplierCall } from "../lib/supplier-logger.js";
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
  passportCountry: z.string().max(2).optional(),
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
  let reviewPaymentAmount: number | undefined;
  if (body.supplier === "TRIPJACK") {
    const tripjackConfig = supplierConfigs.find((s) => s.name === "TRIPJACK");
    const client = new TripjackClient({
      ...(platformCreds.TRIPJACK ?? {}),
      ...(tripjackConfig?.credentials ?? {}),
    });
    tripjackClient = client;
    const reviewStart = Date.now();
    try {
      const review = await client.validateFare(body.fareId);
      bookingSessionId = review.bookingId;
      // TripJack requires paymentInfos.amount = TF from the review response exactly.
      // review.result is already raw.data (unwrapped by validateFare).
      // TF is at results[0].totalPriceInfo or results[0].fareGroups[0].totalPriceInfo.
      const rr = review.result as any;
      // TripJack review: response uses either "results" or "tripInfos" at the top level
      // depending on the API version / proxy. Try both.
      const rFirstResult = rr?.results?.[0] ?? rr?.tripInfos?.[0];
      const priceInfo = rFirstResult?.totalPriceInfo;
      const fd  = priceInfo?.fd;
      const tfd = priceInfo?.totalFareDetail;
      const fg0Price = rFirstResult?.fareGroups?.[0]?.totalPriceInfo;
      const fg0fd  = fg0Price?.fd;
      const fg0tfd = fg0Price?.totalFareDetail;
      // Also try the top-level totalPriceInfo directly on rr (some gateway versions)
      const rrPrice = rr?.totalPriceInfo;
      const rrfd  = rrPrice?.fd;
      const rrtfd = rrPrice?.totalFareDetail;
      reviewPaymentAmount = (
        fd?.fC?.TF ??
        fd?.ADULT?.fC?.TF ??
        tfd?.fC?.TF ??
        tfd?.ADULT?.fC?.TF ??
        fg0fd?.fC?.TF ??
        fg0fd?.ADULT?.fC?.TF ??
        fg0tfd?.fC?.TF ??
        fg0tfd?.ADULT?.fC?.TF ??
        rrfd?.fC?.TF ??
        rrfd?.ADULT?.fC?.TF ??
        rrtfd?.fC?.TF ??
        rrtfd?.ADULT?.fC?.TF
      ) as number | undefined;
      if (!reviewPaymentAmount) {
        // Log the raw structure so the next request tells us the correct path.
        console.warn("[book-review] TF not found; falling back to displayed fare. rr keys:",
          JSON.stringify(Object.keys(rr ?? {})), "snippet:", JSON.stringify(rr).slice(0, 500));
      }
      void logSupplierCall(db, { tenantId, supplier: "TRIPJACK", endpoint: "/fms/v1/review",
        httpStatus: 200, level: reviewPaymentAmount ? "INFO" : "WARN", requestId,
        requestSummary: { fareId: body.fareId, bookingId: review.bookingId, tf: reviewPaymentAmount,
          tfMissing: !reviewPaymentAmount || undefined },
        responseSnippet: !reviewPaymentAmount ? JSON.stringify(priceInfo ?? fg0Price ?? rrPrice ?? rr).slice(0, 800) : undefined,
        durationMs: Date.now() - reviewStart });
    } catch (err: any) {
      console.error("[book-review]", JSON.stringify({ code: err?.code, requestId: err?.requestId }));
      void logSupplierCall(db, { tenantId, supplier: "TRIPJACK", endpoint: "/fms/v1/review",
        level: "ERROR", requestId: err?.requestId ?? requestId,
        requestSummary: { fareId: body.fareId },
        errorCode: err?.code, errorMessage: err?.message,
        durationMs: Date.now() - reviewStart });
      return c.json({ error: err?.code === "FARE_EXPIRED" ? "This fare is no longer available." : "We couldn't confirm availability. Your details are still here.",
        errorCode: err?.code === "FARE_EXPIRED" ? "FARE_EXPIRED" : "FARE_REVIEW_FAILED",
        diagnosticCode: err?.code, requestId: err?.requestId ?? requestId }, err?.code === "FARE_EXPIRED" ? 409 : 503);
    }

    // Safe payment flow: save booking as PAYMENT_PENDING and let the frontend
    // call /api/payments/checkout to get a payment URL. The actual TripJack
    // book() call happens in the queue consumer after payment is captured.
    let pendingBooking: typeof bookings.$inferSelect | undefined;
    try {
      [pendingBooking] = await db.insert(bookings).values({
        tenantId,
        channel:            "B2C_WEB",
        status:             "PAYMENT_PENDING",
        tripType:           "ONEWAY",
        cabinClass:         "ECONOMY",
        origin:             body.origin.toUpperCase(),
        destination:        body.destination.toUpperCase(),
        departureDate:      new Date(body.departureDate),
        flightData:         { id: body.fareId },
        adultCount:         body.passengers.filter((p) => p.type === "ADULT").length,
        childCount:         body.passengers.filter((p) => p.type === "CHILD").length,
        infantCount:        body.passengers.filter((p) => p.type === "INFANT").length,
        baseFare:           String(reviewPaymentAmount ?? body.totalFare),
        taxes:              "0",
        totalAmount:        String(reviewPaymentAmount ?? body.totalFare),
        currency:           body.currency,
        supplier:           body.supplier,
        supplierBookingRef: bookingSessionId,
        contactEmail:       body.contactEmail,
        contactPhone:       body.contactPhone,
      }).returning();

      await db.insert(bookingPassengers).values(
        body.passengers.map((p) => ({
          bookingId:       pendingBooking!.id,
          passengerType:   p.type,
          firstName:       p.firstName,
          lastName:        p.lastName,
          dob:             p.dob ? new Date(p.dob) : null,
          gender:          p.gender ?? null,
          nationality:     p.nationality ?? null,
          passportNumber:  p.passportNumber  ?? null,
          passportExpiry:  p.passportExpiry  ? new Date(p.passportExpiry) : null,
          passportCountry: p.passportCountry ?? p.nationality ?? null,
        })),
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[book-save]", JSON.stringify({ requestId, error: errMsg }));
      return c.json({ errorCode: "BOOKING_SAVE_FAILED", requestId }, 500);
    }

    return c.json({
      success:         true,
      bookingId:       pendingBooking!.id,
      amount:          reviewPaymentAmount ?? body.totalFare,
      currency:        body.currency,
      requiresPayment: true,
      requestId,
    }, 201);
  }

  // Log that a book attempt is being made — written before the call so CF timeout can't swallow it.
  void logSupplierCall(db, { tenantId, supplier: body.supplier as "TRIPJACK", endpoint: "/oms/v1/air/book",
    level: "INFO", requestId,
    requestSummary: { bookingId: bookingSessionId, fareId: body.fareId,
      origin: body.origin, destination: body.destination, paxCount: body.passengers.length,
      paymentAmount: reviewPaymentAmount ?? body.totalFare, status: "INITIATED" } });

  let result;
  const bookStart = Date.now();
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
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError" || /timeout/i.test(String(err?.message));
    if (status === 409) {
      c.executionCtx.waitUntil(logSupplierCall(db, { tenantId, supplier: body.supplier as "TRIPJACK", endpoint: "/oms/v1/air/book",
        httpStatus: 409, level: "ERROR", requestId,
        requestSummary: { bookingId: bookingSessionId, origin: body.origin, destination: body.destination },
        errorCode: "FARE_EXPIRED", errorMessage: "Booking session expired", durationMs: Date.now() - bookStart }));
      return c.json({ errorCode: "FARE_EXPIRED", requestId }, 409);
    }
    const rejected = [400, 401, 403, 404, 422, 429].includes(status);
    const httpSupplierMsg = typeof (err as any)?.supplierDetail === "string" && (err as any).supplierDetail.trim()
      ? (err as any).supplierDetail.trim() : undefined;
    const errorCode = isTimeout ? "BOOK_TIMEOUT" : rejected ? "BOOKING_REJECTED" : "BOOKING_STATUS_UNKNOWN";
    console.error("[book-submit]", JSON.stringify({ requestId, httpStatus: status || null, code: errorCode }));
    c.executionCtx.waitUntil(logSupplierCall(db, { tenantId, supplier: body.supplier as "TRIPJACK", endpoint: "/oms/v1/air/book",
      httpStatus: status || undefined, level: "ERROR", requestId,
      requestSummary: { bookingId: bookingSessionId, origin: body.origin, destination: body.destination, paxCount: body.passengers.length },
      errorCode,
      errorMessage: httpSupplierMsg ?? err?.message, durationMs: Date.now() - bookStart }));
    return c.json({ errorCode: isTimeout ? "BOOKING_STATUS_UNKNOWN" : rejected ? "BOOKING_REJECTED" : "BOOKING_STATUS_UNKNOWN",
      requestId, bookingReference: bookingSessionId,
      ...(httpSupplierMsg ? { supplierMessage: httpSupplierMsg } : {}) }, isTimeout ? 502 : rejected ? 422 : 502);
  }

  if (!result.success) {
    const raw = result.raw as any;
    const orderMsg = String(raw?.data?.order?.statusMessage ?? raw?.data?.statusMessage ?? "");
    const topMsg   = String(raw?.status?.statusMessage ?? "");
    console.error("[book-rejected]", JSON.stringify({ requestId, orderMsg, topMsg, paymentAmount: reviewPaymentAmount ?? body.totalFare, raw: JSON.stringify(raw).slice(0, 600) }));
    c.executionCtx.waitUntil(logSupplierCall(db, { tenantId, supplier: body.supplier as "TRIPJACK", endpoint: "/oms/v1/air/book",
      httpStatus: 200, level: "ERROR", requestId,
      requestSummary: { bookingId: bookingSessionId, origin: body.origin, destination: body.destination, paxCount: body.passengers.length },
      responseSnippet: JSON.stringify(raw).slice(0, 800),
      errorCode: "BOOKING_REJECTED", errorMessage: orderMsg || topMsg || "Supplier rejected booking",
      durationMs: Date.now() - bookStart }));
    // If the raw TripJack response indicates session/fare expiry, surface it as FARE_EXPIRED
    // so the frontend shows "search again" rather than "contact support".
    const rawMsg = (orderMsg + " " + topMsg).toLowerCase();
    if (/expir|no longer available|booking session|no tripjack comment|no comment found|session not found/i.test(rawMsg)) {
      return c.json({ errorCode: "FARE_EXPIRED", requestId }, 409);
    }
    const supplierMessage = (orderMsg || topMsg) || undefined;
    return c.json({ errorCode: "BOOKING_REJECTED", requestId, ...(supplierMessage ? { supplierMessage } : {}) }, 422);
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
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[book-save]", JSON.stringify({ requestId, bookingReference: result.bookingRef, error: errMsg }));
    c.executionCtx.waitUntil(logSupplierCall(db, { tenantId, supplier: body.supplier as "TRIPJACK", endpoint: "db:bookings:insert",
      level: "ERROR", requestId,
      requestSummary: { bookingRef: result.bookingRef, pnr: result.pnr },
      errorCode: "DB_WRITE_FAILED", errorMessage: errMsg }));
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
