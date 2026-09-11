import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { TripjackHotelAdapter } from "@poomas/suppliers";
import type { SupplierCredentials } from "@poomas/suppliers";
import type { Env, Variables } from "../types.js";

function tripjackCredentials(env: Env): SupplierCredentials {
  return { apiKey: env.TRIPJACK_API_KEY, baseUrl: env.TRIPJACK_API_BASE_URL };
}

const roomSchema = z.object({
  adults:    z.number().int().min(1).max(8).default(1),
  children:  z.number().int().min(0).max(6).default(0),
  childAges: z.array(z.number().int().min(0).max(17)).optional(),
});

const hotelSearchSchema = z.object({
  cityCode:     z.string().min(2).toUpperCase(),
  checkIn:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rooms:        z.array(roomSchema).min(1).max(9).default([{ adults: 1, children: 0 }]),
  nationality:  z.string().length(2).toUpperCase().default("IN"),
  currency:     z.enum(["INR", "AED", "USD"]).default("INR"),
  ratings:      z.array(z.number().int().min(1).max(5)).optional(),
  freeBreakfast: z.boolean().optional(),
  freeCancel:   z.boolean().optional(),
});

const guestSchema = z.object({
  roomIndex: z.number().int().min(0),
  title:     z.string().min(1),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  type:      z.enum(["ADULT", "CHILD"]).default("ADULT"),
  age:       z.number().int().min(0).optional(),
});

const hotelBookSchema = z.object({
  optionId:     z.string().min(1),
  contactName:  z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8),
  guests:       z.array(guestSchema).min(1),
});

export const hotelRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Search hotels
hotelRoutes.post("/search", zValidator("json", hotelSearchSchema), async (c) => {
  const params  = c.req.valid("json");
  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));

  const cacheKey = `hotels:${c.get("tenantId")}:${JSON.stringify(params)}`;

  try {
    const cached = await c.env.FARE_CACHE_KV.get(cacheKey, "json") as { hotels: unknown[] } | null;
    if (cached?.hotels?.length) return c.json({ ...cached, fromCache: true });
  } catch {
    // cache miss is fine
  }

  const hotels = await adapter.search(params);
  const response = { hotels, supplier: "TRIPJACK" };

  c.executionCtx.waitUntil((async () => {
    try {
      if (hotels.length > 0) {
        await c.env.FARE_CACHE_KV.put(cacheKey, JSON.stringify(response), { expirationTtl: 600 });
      }
    } catch { /* non-fatal */ }
  })());

  return c.json(response);
});

// Pre-book / price check before confirming
hotelRoutes.post("/prebook", async (c) => {
  const { optionId } = await c.req.json<{ optionId: string }>();
  if (!optionId) return c.json({ error: "optionId required" }, 400);

  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));
  const result  = await adapter.preBook(optionId);
  return c.json(result);
});

// Book hotel
hotelRoutes.post("/book", zValidator("json", hotelBookSchema), async (c) => {
  const params  = c.req.valid("json");
  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));
  const result  = await adapter.book(params);
  return c.json(result, result.success ? 201 : 422);
});

// Get hotel booking detail
hotelRoutes.get("/bookings/:bookingId", async (c) => {
  const { bookingId } = c.req.param();
  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));
  const detail  = await adapter.getBookingDetail(bookingId);
  return c.json(detail);
});

// Cancel hotel booking
hotelRoutes.post("/bookings/:bookingId/cancel", async (c) => {
  const { bookingId } = c.req.param();
  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));
  const result  = await adapter.cancel(bookingId);
  return c.json(result);
});
