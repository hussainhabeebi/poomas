// GET  /api/eticket/:bookingId      — serves e-ticket HTML for a confirmed booking
// GET  /api/eticket/:bookingId/pdf  — serves e-ticket PDF (generated via Browser Rendering)
// POST /api/eticket/:bookingId/send — send e-ticket via WhatsApp (Leadvyne) + email (Resend)

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { bookings, bookingPassengers } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import { htmlToPdf } from "../lib/browser-pdf.js";
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

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });
  if (!["CONFIRMED", "TICKETED"].includes(booking.status)) {
    throw new HTTPException(400, { message: "E-ticket only available for confirmed bookings" });
  }

  const key = `etickets/${bookingId}.html`;
  const obj = await c.env.DOCUMENTS_R2.get(key);
  if (!obj) throw new HTTPException(404, { message: "E-ticket not yet generated" });

  const html = await obj.text();
  return c.body(html, 200, {
    "Content-Type":        "text/html; charset=utf-8",
    "Content-Disposition": `attachment; filename="eticket-${booking.pnr ?? bookingId}.html"`,
    "Cache-Control":       "private, no-cache",
  });
});

// ── PDF endpoint ──────────────────────────────────────────────────────────────

eticketRoutes.get("/:bookingId/pdf", async (c) => {
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");
  const bookingId = c.req.param("bookingId");

  const [booking] = await db
    .select({ id: bookings.id, status: bookings.status, pnr: bookings.pnr })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });
  if (!["CONFIRMED", "TICKETED"].includes(booking.status)) {
    throw new HTTPException(400, { message: "E-ticket only available for confirmed bookings" });
  }

  // Serve cached PDF if available
  const pdfKey = `etickets/${bookingId}.pdf`;
  const cached = await c.env.DOCUMENTS_R2.get(pdfKey);
  if (cached) {
    return new Response(await cached.arrayBuffer(), {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="eticket-${booking.pnr ?? bookingId}.pdf"`,
        "Cache-Control":       "private, max-age=3600",
      },
    });
  }

  // Load the HTML source
  const htmlObj = await c.env.DOCUMENTS_R2.get(`etickets/${bookingId}.html`);
  if (!htmlObj) throw new HTTPException(404, { message: "E-ticket HTML not yet generated" });

  const html = await htmlObj.text();
  const pdfBytes = await htmlToPdf(c.env.BROWSER, html);

  // Cache PDF in R2 for subsequent requests
  await c.env.DOCUMENTS_R2.put(pdfKey, pdfBytes, {
    httpMetadata:   { contentType: "application/pdf" },
    customMetadata: { bookingId, generatedAt: new Date().toISOString() },
  });

  return new Response(pdfBytes, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="eticket-${booking.pnr ?? bookingId}.pdf"`,
      "Cache-Control":       "private, max-age=3600",
    },
  });
});

const sendSchema = z.object({
  channels: z.array(z.enum(["WHATSAPP", "EMAIL"])).min(1).default(["WHATSAPP", "EMAIL"]),
  whatsappPhone: z.string().optional(),
  email:         z.string().email().optional(),
});

eticketRoutes.post("/:bookingId/send", zValidator("json", sendSchema), async (c) => {
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");
  const bookingId = c.req.param("bookingId");
  const body      = c.req.valid("json");

  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });
  if (!["CONFIRMED", "TICKETED"].includes(booking.status)) {
    throw new HTTPException(400, { message: "E-ticket only available for confirmed bookings" });
  }

  const passengers = await db
    .select({ firstName: bookingPassengers.firstName, lastName: bookingPassengers.lastName })
    .from(bookingPassengers)
    .where(eq(bookingPassengers.bookingId, bookingId));

  const paxNames  = passengers.map((p) => `${p.firstName} ${p.lastName}`).join(", ");
  const flightData = booking.flightData as Record<string, unknown>;
  const pnr       = booking.pnr ?? "TBD";

  const eticketUrl = `https://assets.flypoomas.com/etickets/${bookingId}.html`;

  const results: Record<string, unknown> = {};

  if (body.channels.includes("WHATSAPP") && c.env.LEADVYNE_API_KEY) {
    const phone = body.whatsappPhone ?? booking.whatsappPhone;
    if (phone) {
      const msg = [
        `✈️ *Booking Confirmed!*`,
        `PNR: *${pnr}*`,
        `Route: ${booking.origin} → ${booking.destination}`,
        `Passengers: ${paxNames}`,
        ``,
        `📄 Download your e-ticket:`,
        eticketUrl,
      ].join("\n");

      try {
        const waRes = await fetch(`${c.env.LEADVYNE_BASE_URL ?? "https://api.leadvyne.com"}/v1/messages/send`, {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${c.env.LEADVYNE_API_KEY}`,
            "X-Instance-ID": c.env.LEADVYNE_INSTANCE_ID ?? "",
          },
          body: JSON.stringify({ to: phone, message: msg }),
        });
        results.whatsapp = { ok: waRes.ok, status: waRes.status };
      } catch (err: any) {
        results.whatsapp = { ok: false, error: err.message };
      }
    } else {
      results.whatsapp = { ok: false, error: "No WhatsApp phone on booking" };
    }
  }

  if (body.channels.includes("EMAIL") && c.env.RESEND_API_KEY) {
    const email = body.email ?? booking.contactEmail;
    if (email) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${c.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from:    "POOMAS Flights <tickets@flypoomas.com>",
            to:      [email],
            subject: `E-Ticket — PNR ${pnr} | ${booking.origin} → ${booking.destination}`,
            html: `
              <h2>Your E-Ticket is Ready</h2>
              <p>PNR: <strong>${pnr}</strong></p>
              <p>Route: ${booking.origin} → ${booking.destination}</p>
              <p>Passengers: ${paxNames}</p>
              <p><a href="${eticketUrl}" style="background:#E31E24;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Download E-Ticket</a></p>
              <p style="font-size:12px;color:#6b7280;">Total paid: ${booking.currency} ${booking.totalAmount}</p>
            `,
          }),
        });
        results.email = { ok: emailRes.ok, status: emailRes.status };
      } catch (err: any) {
        results.email = { ok: false, error: err.message };
      }
    } else {
      results.email = { ok: false, error: "No contact email on booking" };
    }
  }

  return c.json({ bookingId, pnr, results });
});
