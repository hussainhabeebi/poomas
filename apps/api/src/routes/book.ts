// POST /api/book — public B2C direct booking (no auth required)
// TripJack and Riya support direct booking without an explicit hold step.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { getBookableAdapter, type SupplierConfig, type PlatformCredentials } from "@poomas/suppliers";
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

function platformCredsFromEnv(env: Env): PlatformCredentials {
  return {
    ...(env.RIYA_API_KEY     ? { RIYA:     { apiKey: env.RIYA_API_KEY, secretKey: env.RIYA_API_SECRET, baseUrl: env.RIYA_API_BASE_URL } } : {}),
    ...(env.TRIPJACK_API_KEY ? { TRIPJACK: { apiKey: env.TRIPJACK_API_KEY, baseUrl: env.TRIPJACK_API_BASE_URL } } : {}),
  };
}

bookDirectRoutes.post("/", zValidator("json", directBookSchema), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const tenant   = c.get("tenant");

  const platformCreds = platformCredsFromEnv(c.env);

  const supplierConfigs: SupplierConfig[] = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP" | "DUFFEL",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  // Fall back to platform-level credentials if tenant hasn't configured the supplier
  const configuredNames = new Set(supplierConfigs.map((s) => s.name));
  if (!configuredNames.has(body.supplier) && platformCreds[body.supplier]) {
    supplierConfigs.push({
      name:        body.supplier,
      isEnabled:   true,
      priority:    10,
      credentials: null,
      timeoutMs:   20000,
      maxRetries:  0,
    });
  }

  const adapter = getBookableAdapter(body.supplier, supplierConfigs, platformCreds);
  if (!adapter.book) {
    throw new HTTPException(400, { message: `${body.supplier} does not support direct booking` });
  }

  // TripJack uses the fareId as the booking session reference — no separate hold needed
  const result = await adapter.book({
    fareId:       body.fareId,
    holdId:       body.fareId,
    passengers:   body.passengers,
    contactEmail: body.contactEmail,
    contactPhone: body.contactPhone,
    paymentRef:   "DIRECT_B2C",
  });

  if (!result.success) {
    throw new HTTPException(422, { message: "Supplier rejected the booking — fare may have expired" });
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
