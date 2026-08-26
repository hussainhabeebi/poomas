// GET /api/og/booking/:bookingId — WhatsApp/social share image for a confirmed booking
// Returns a 1200×630 PNG rendered via Cloudflare Browser Rendering.

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bookings } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import { htmlToPng } from "../lib/browser-pdf.js";
import type { Env, Variables } from "../types.js";

export const ogRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

ogRoutes.get("/booking/:bookingId", async (c) => {
  const bookingId = c.req.param("bookingId");
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");

  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });

  // Check R2 cache first
  const cacheKey = `og/${bookingId}.png`;
  const cached   = await c.env.PUBLIC_ASSETS_R2.get(cacheKey);
  if (cached) {
    return new Response(await cached.arrayBuffer(), {
      headers: {
        "Content-Type":  "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const flightData = (booking.flightData ?? {}) as Record<string, unknown>;
  const html = renderOgCard({
    pnr:           booking.pnr ?? "TBD",
    origin:        booking.origin,
    destination:   booking.destination,
    airline:       String(flightData.airline ?? ""),
    departureTime: String(flightData.departureTime ?? ""),
    passengers:    (booking.passengerCount as number) ?? 1,
    totalAmount:   (booking.totalAmount as number) ?? 0,
    currency:      booking.currency ?? "INR",
  });

  const png = await htmlToPng(c.env.BROWSER, html);

  // Cache for 24 h
  await c.env.PUBLIC_ASSETS_R2.put(cacheKey, png, {
    httpMetadata:   { contentType: "image/png" },
    customMetadata: { bookingId, generatedAt: new Date().toISOString() },
  });

  return new Response(png, {
    headers: {
      "Content-Type":  "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

function renderOgCard(data: {
  pnr: string; origin: string; destination: string;
  airline: string; departureTime: string;
  passengers: number; totalAmount: number; currency: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    width:1200px;height:630px;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:linear-gradient(135deg,#E31E24 0%,#F7941D 100%);
    display:flex;align-items:center;justify-content:center;
  }
  .card{
    background:#fff;border-radius:28px;padding:52px 60px;width:940px;
    box-shadow:0 40px 80px rgba(0,0,0,.22);
  }
  .badge{font-size:15px;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px}
  .route{display:flex;align-items:center;gap:28px;margin:14px 0 28px}
  .city{font-size:80px;font-weight:900;color:#111;line-height:1}
  .arrow{font-size:40px;color:#E31E24;font-weight:700}
  .meta{display:flex;gap:36px}
  .mi{display:flex;flex-direction:column;gap:5px}
  .ml{font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em}
  .mv{font-size:20px;font-weight:700;color:#111}
  .footer{display:flex;justify-content:space-between;align-items:center;margin-top:36px;padding-top:28px;border-top:1.5px solid #f3f4f6}
  .brand{font-size:20px;font-weight:900;color:#E31E24;letter-spacing:-.02em}
  .price{font-size:32px;font-weight:900;color:#111}
</style>
</head>
<body><div class="card">
  <div class="badge">✈️ POOMAS Traveldays · Booking Confirmed</div>
  <div class="route">
    <span class="city">${data.origin}</span>
    <span class="arrow">→</span>
    <span class="city">${data.destination}</span>
  </div>
  <div class="meta">
    <div class="mi"><span class="ml">PNR</span><span class="mv">${data.pnr}</span></div>
    <div class="mi"><span class="ml">Airline</span><span class="mv">${data.airline || "—"}</span></div>
    <div class="mi"><span class="ml">Departure</span><span class="mv">${data.departureTime || "—"}</span></div>
    <div class="mi"><span class="ml">Passengers</span><span class="mv">${data.passengers}</span></div>
  </div>
  <div class="footer">
    <span class="brand">POOMAS Traveldays</span>
    <span class="price">${data.currency} ${Number(data.totalAmount).toLocaleString("en-IN")}</span>
  </div>
</div></body></html>`;
}
