// Admin → TripJack hotels (v3): city index sync, hold confirmation, cancellation,
// booking lookups. Kept off the public /api/hotels routes on purpose.

import { and, eq, desc } from 'drizzle-orm';
import { hotelAttempts, hotelQuotes } from '@poomas/db/schema';
import { recoverStoredHotelBooking, storedHotelAction } from '../hotel-checkout.js';
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { parseHotelBookingDetails } from "@poomas/suppliers";
import type { Env, Variables } from "../../types.js";
import { cityIndexStatus, hotelClient, hotelExchanges, hotelRecorder, syncCityIndex } from "../../lib/hotels.js";
import { hotelError, logged, pollDetails } from "../hotel.js";

export const hotelsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
// Booking actions keep raw request / response logs (the city sync pages are too large to keep).
hotelsAdminRoutes.use("/bookings/*", hotelExchanges);

hotelsAdminRoutes.get("/city-index", async (c) => c.json(await cityIndexStatus(c.env)));

// Pages through TripJack city region IDs a few pages per call; the Admin page
// calls it repeatedly until { done: true }.
hotelsAdminRoutes.post("/city-index/sync", zValidator("json", z.object({ restart: z.boolean().default(false) })), async (c) => {
  const { restart } = c.req.valid("json");
  const client = await hotelClient(c.env, c.get("tenantId"));
  try {
    return c.json(await logged(c, "/hms/v3/content/fetch-city-regionIds", { restart }, () => syncCityIndex(c.env, client, restart),
      (r) => ({ ...r })));
  } catch (err) {
    return hotelError(c, err, "City sync failed");
  }
});

hotelsAdminRoutes.post("/bookings/list", zValidator("json", z.object({ startDate: z.string(), endDate: z.string() })), async (c) => {
  const { startDate, endDate } = c.req.valid("json");
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const res = await logged(c, "/oms/v1/hotel/bookings", { startDate, endDate }, () => client.bookingList(startDate, endDate),
      (r) => ({ count: r.bookings?.length ?? 0 }));
    return c.json({ bookings: res.bookings ?? [] });
  } catch (err) {
    return hotelError(c, err, "Could not load hotel bookings");
  }
});

hotelsAdminRoutes.get("/bookings/:bookingId", async (c) => {
  const { bookingId } = c.req.param();
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const raw = await logged(c, "/oms/v3/hotel/booking-details", { bookingId, source: "admin" }, () => client.bookingDetails(bookingId));
    return c.json({ details: parseHotelBookingDetails(raw), raw });
  } catch (err) {
    return hotelError(c, err, "Could not load the hotel booking");
  }
});

hotelsAdminRoutes.post('/bookings/:bookingId/confirm', c => storedHotelAction(c, 'confirm', c.req.param('bookingId')));
hotelsAdminRoutes.post('/bookings/:bookingId/cancel', c => storedHotelAction(c, 'cancel', c.req.param('bookingId')));

// Existing admin permission middleware is retained. These operations only read
// provider status; they cannot create, confirm, cancel or retry a booking.
hotelsAdminRoutes.get('/attempts', async c => {
  const attempts = await c.get('db').select().from(hotelAttempts)
    .where(eq(hotelAttempts.tenantId, c.get('tenantId'))).orderBy(desc(hotelAttempts.createdAt)).limit(100);
  return c.json({ attempts });
});
hotelsAdminRoutes.post('/attempts/:id/reconcile', async c => {
  const db = c.get('db');
  const [a] = await db.select().from(hotelAttempts).where(and(eq(hotelAttempts.tenantId, c.get('tenantId')), eq(hotelAttempts.id, c.req.param('id')))).limit(1);
  if (!a) return c.json({ error: 'Booking not found.' }, 404);
  const [q] = await db.select().from(hotelQuotes).where(and(eq(hotelQuotes.tenantId, c.get('tenantId')), eq(hotelQuotes.id, a.quoteId))).limit(1);
  return recoverStoredHotelBooking(c, a, q, true);
});
