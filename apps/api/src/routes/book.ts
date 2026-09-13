// POST /api/book — public B2C direct booking (no auth required)
// TripJack and Riya support direct booking without an explicit hold step.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { getBookableAdapter, TripjackClient } from "@poomas/suppliers";
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
  departureDate: z.string(),
  totalFare:     z.number().positive(),
  currency:      z.enum(["INR", "AED", "USD"]).default("INR"),
});

export const bookDirectRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

bookDirectRoutes.post("/", zValidator("json", directBookSchema), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const tenant   = c.get("tenant");

  const { platformCredentials: platformCreds, supplierConfigs } = await resolveFlightSuppliers(c.env, tenant, tenantId);

  const adapter = getBookableAdapter(body.supplier, supplierConfigs, platformCreds);
  if (!adapter.book) {
    throw new HTTPException(400, { message: `${body.supplier} does not support direct booking` });
  }

  // TripJack fare IDs are search references. Review immediately before booking so
  // the supplier gives us a fresh booking session instead of rejecting a stale ID.
  let bookingSessionId = body.fareId;
  if (body.supplier === "TRIPJACK") {
    const tripjackConfig = supplierConfigs.find((s) => s.name === "TRIPJACK");
    const client = new TripjackClient({
      ...(platformCreds.TRIPJACK ?? {}),
      ...(tripjackConfig?.credentials ?? {}),
    });
    try {
      const review = await client.validateFare(body.fareId);
      bookingSessionId = review.bookingId;
    } catch (err: any) {
      console.error("[book-review]", JSON.stringify({ code: err?.code, requestId: err?.requestId }));
      return c.json({ error: err?.code === "FARE_EXPIRED" ? "This fare is no longer available." : "We couldn't confirm availability. Your details are still here.",
        errorCode: err?.code === "FARE_EXPIRED" ? "FARE_EXPIRED" : "FARE_REVIEW_FAILED", requestId: err?.requestId }, err?.code === "FARE_EXPIRED" ? 409 : 503);
    }
  }

  const result = await adapter.book({
    fareId:       body.fareId,
    holdId:       bookingSessionId,
    passengers:   body.passengers,
    contactEmail: body.contactEmail,
    contactPhone: body.contactPhone,
    paymentRef:   "DIRECT_B2C",
  });

  if (!result.success) {
    throw new HTTPException(422, { message: "Supplier could not confirm this fare. Please retry or search again." });
  }

  // Persist booking record
  const [booking] = await db.insert(bookings).values({
    tenantId,
    channel:            "B2C_WEB",
    status:             result.status === "CONFIRMED" ? "CONFIRMED" : "HELD",
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

  await db.insert(bookingPassengers).values(
    body.passengers.map((p) => ({
      bookingId:       booking.id,
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

  return c.json({
    success:          true,
    bookingId:        booking.id,
    pnr:              result.pnr,
    bookingReference: result.bookingRef,
    status:           result.status,
  }, 201);
});
