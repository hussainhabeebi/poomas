// GET /api/eticket/:bookingId — serves e-ticket HTML for a confirmed booking
// No auth required for the actual download URL (uses a short-lived signed token)

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bookings } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../types.js";

export const eticketRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

eticketRoutes.get("/:bookingId", async (c) => {
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");
  const bookingId = c.req.param("bookingId");

  const [booking] = await db
    .select({ id: bookings.id, status: bookings.status, pnr: bookings.pnr })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) {
    throw new HTTPException(404, { message: "Booking not found" });
  }

  if (!["CONFIRMED", "TICKETED"].includes(booking.status)) {
    throw new HTTPException(400, { message: "E-ticket only available for confirmed bookings" });
  }

  const key  = `etickets/${bookingId}.html`;
  const obj  = await c.env.DOCUMENTS_R2.get(key);

  if (!obj) {
    throw new HTTPException(404, { message: "E-ticket not yet generated" });
  }

  const html = await obj.text();
  return c.body(html, 200, {
    "Content-Type":        "text/html; charset=utf-8",
    "Content-Disposition": `attachment; filename="eticket-${booking.pnr ?? bookingId}.html"`,
    "Cache-Control":       "private, no-cache",
  });
});
