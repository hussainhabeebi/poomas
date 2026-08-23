import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { bookings, bookingPassengers } from "@poomas/db/schema";
import type { Env, Variables } from "../types.js";

export const integrationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

integrationRoutes.get("/pnr/:pnr", async (c) => {
  const expected = c.env.POOMAS_INTEGRATION_KEY;
  const supplied = c.req.header("X-POOMAS-INTEGRATION-KEY");
  if (!expected || !supplied || supplied !== expected) {
    return c.json({ error: "Unauthorized integration" }, 401);
  }

  const pnr = c.req.param("pnr").trim().toUpperCase();
  const tenantId = c.get("tenantId");
  const db = c.get("db");

  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.pnr, pnr)))
    .limit(1);

  if (!booking) return c.json({ error: "PNR not found" }, 404);

  const passengers = await db
    .select({
      passengerType: bookingPassengers.passengerType,
      firstName: bookingPassengers.firstName,
      lastName: bookingPassengers.lastName,
      ticketNumber: bookingPassengers.ticketNumber,
      seatNumber: bookingPassengers.seatNumber,
    })
    .from(bookingPassengers)
    .where(eq(bookingPassengers.bookingId, booking.id));

  let supplierStatus: Record<string, unknown> | null = null;
  if (booking.supplier === "DUFFEL" && booking.supplierBookingRef && c.env.DUFFEL_API_KEY) {
    try {
      const response = await fetch(`https://api.duffel.com/air/orders/${encodeURIComponent(booking.supplierBookingRef)}`, {
        headers: {
          Authorization: `Bearer ${c.env.DUFFEL_API_KEY}`,
          "Duffel-Version": "v2",
          Accept: "application/json",
        },
      });
      if (response.ok) {
        const body = await response.json() as { data?: Record<string, unknown> };
        supplierStatus = body.data ?? null;
      }
    } catch {
      // Fail open to the latest POOMAS booking state if the supplier cannot be reached.
    }
  }

  return c.json({
    pnr: booking.pnr,
    bookingId: booking.id,
    status: booking.status,
    supplier: booking.supplier,
    supplierBookingRef: booking.supplierBookingRef,
    ticketNumbers: booking.ticketNumbers,
    origin: booking.origin,
    destination: booking.destination,
    departureDate: booking.departureDate,
    returnDate: booking.returnDate,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    passengers,
    supplierStatus,
    updatedAt: booking.updatedAt,
  });
});
