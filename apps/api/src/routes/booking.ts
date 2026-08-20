import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { getBookableAdapter, type SupplierConfig } from "@poomas/suppliers";
import { bookings, bookingPassengers, payments, walletAccounts, walletTransactions } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../types.js";

const passengerSchema = z.object({
  type:            z.enum(["ADULT", "CHILD", "INFANT"]),
  firstName:       z.string().min(1),
  lastName:        z.string().min(1),
  dob:             z.string().optional(),
  gender:          z.enum(["M", "F"]).optional(),
  nationality:     z.string().length(2).optional(),
  passportNumber:  z.string().optional(),
  passportExpiry:  z.string().optional(),
  passportCountry: z.string().length(2).optional(),
});

const bookingCreateSchema = z.object({
  fareId:       z.string(),
  supplier:     z.enum(["RIYA", "TRIPJACK"]),
  sessionId:    z.string().optional(),
  passengers:   z.array(passengerSchema).min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8),
  gstNumber:    z.string().optional(),
  promoCode:    z.string().optional(),
  paymentMethod: z.enum(["GATEWAY", "WALLET"]).default("GATEWAY"),
});

export const bookingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Create / initiate booking
bookingRoutes.post("/", zValidator("json", bookingCreateSchema), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const tenant   = c.get("tenant");
  const userId   = c.get("userId");
  const agentId  = c.get("agentId");

  const supplierConfigs: SupplierConfig[] = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  // Hold seat with supplier before taking payment
  const adapter = getBookableAdapter(body.supplier, supplierConfigs);

  if (!adapter.hold) {
    throw new HTTPException(400, { message: `${body.supplier} does not support hold — use book directly` });
  }

  const holdResult = await adapter.hold({
    fareId:     body.fareId,
    sessionId:  body.sessionId,
    passengers: body.passengers,
  });

  if (!holdResult.success) {
    throw new HTTPException(422, { message: "Could not hold seat — fare may have expired" });
  }

  // Create booking record in HELD state
  const [booking] = await db.insert(bookings).values({
    tenantId,
    userId:           userId ?? null,
    agentId:          agentId ?? null,
    channel:          agentId ? "B2B_PORTAL" : "B2C_WEB",
    status:           "HELD",
    tripType:         "ONEWAY",    // TODO: derive from fare data
    cabinClass:       "ECONOMY",
    origin:           holdResult.fareSnapshot.origin,
    destination:      holdResult.fareSnapshot.destination,
    departureDate:    new Date(holdResult.fareSnapshot.departureTime),
    flightData:       holdResult.fareSnapshot as unknown as Record<string, unknown>,
    adultCount:       body.passengers.filter((p) => p.type === "ADULT").length,
    childCount:       body.passengers.filter((p) => p.type === "CHILD").length,
    infantCount:      body.passengers.filter((p) => p.type === "INFANT").length,
    baseFare:         String(holdResult.fareSnapshot.baseFare),
    taxes:            String(holdResult.fareSnapshot.taxes),
    totalAmount:      String(holdResult.fareSnapshot.totalFare),
    currency:         (tenant.defaultCurrency as "INR" | "AED" | "USD"),
    supplier:         body.supplier,
    supplierBookingRef: holdResult.holdId,
    gstNumber:        body.gstNumber ?? null,
    heldUntil:        new Date(holdResult.expiresAt),
    contactEmail:     body.contactEmail,
    contactPhone:     body.contactPhone,
  }).returning();

  // Insert passengers
  await db.insert(bookingPassengers).values(
    body.passengers.map((p) => ({
      bookingId:     booking.id,
      passengerType: p.type,
      firstName:     p.firstName,
      lastName:      p.lastName,
      dob:           p.dob ? new Date(p.dob) : null,
      gender:        p.gender ?? null,
      nationality:   p.nationality ?? null,
      passportNumber:  p.passportNumber  ?? null,
      passportExpiry:  p.passportExpiry  ? new Date(p.passportExpiry) : null,
      passportCountry: p.passportCountry ?? null,
    })),
  );

  // Queue payment initiation job
  await c.env.BOOKING_QUEUE.send({
    type:       "INITIATE_PAYMENT",
    bookingId:  booking.id,
    tenantId,
    method:     body.paymentMethod,
    agentId,
  });

  return c.json({ bookingId: booking.id, holdId: holdResult.holdId, expiresAt: holdResult.expiresAt }, 201);
});

// List bookings for the authenticated user/agent
bookingRoutes.get("/", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const userId   = c.get("userId");
  const agentId  = c.get("agentId");

  const conditions = [eq(bookings.tenantId, tenantId)];
  if (agentId) conditions.push(eq(bookings.agentId, agentId));
  else if (userId) conditions.push(eq(bookings.userId, userId));

  const rows = await db
    .select({
      id:           bookings.id,
      status:       bookings.status,
      origin:       bookings.origin,
      destination:  bookings.destination,
      departureDate: bookings.departureDate,
      adultCount:   bookings.adultCount,
      childCount:   bookings.childCount,
      totalAmount:  bookings.totalAmount,
      currency:     bookings.currency,
      pnr:          bookings.pnr,
      supplier:     bookings.supplier,
      createdAt:    bookings.createdAt,
    })
    .from(bookings)
    .where(and(...conditions))
    .limit(50);

  return c.json({ bookings: rows });
});

// Get booking details
bookingRoutes.get("/:id", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const [booking] = await db
    .select()
    .from(bookings)
    .where(
      and(eq(bookings.id, c.req.param("id")), eq(bookings.tenantId, tenantId)),
    )
    .limit(1);

  if (!booking) {
    throw new HTTPException(404, { message: "Booking not found" });
  }

  return c.json(booking);
});

// PNR status check (no auth required — public tool)
bookingRoutes.get("/pnr/:pnr", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const pnr      = c.req.param("pnr");

  const [booking] = await db
    .select({ id: bookings.id, status: bookings.status, supplier: bookings.supplier })
    .from(bookings)
    .where(and(eq(bookings.pnr, pnr), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) {
    throw new HTTPException(404, { message: "PNR not found" });
  }

  const tenant  = c.get("tenant");
  const configs = tenant.supplierConfigs.map((sc) => ({
    name:        sc.supplier as "RIYA" | "TRIPJACK" | "GOOGLE_SERP",
    isEnabled:   sc.isEnabled,
    priority:    sc.priority,
    credentials: sc.credentials,
    timeoutMs:   sc.timeoutMs,
    maxRetries:  sc.maxRetries,
  }));

  const adapter = getBookableAdapter(booking.supplier as "RIYA" | "TRIPJACK", configs);
  const status  = await adapter.getPNRStatus?.(pnr);

  return c.json({ pnr, localStatus: booking.status, supplierStatus: status });
});
