// POST /api/checkout/session — create a signed checkout token for bot→web handoff
// GET  /api/checkout/session/:token — verify token and return booking context (server-side only)

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { bookings, bookingPassengers } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../types.js";

const CHECKOUT_TTL = 20 * 60;  // 20 minutes

const createSchema = z.object({
  bookingId:      z.string(),
  whatsappPhone:  z.string().optional(),
  agentId:        z.string().optional(),
});

export const checkoutRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helpers — HMAC-SHA256 JWT (HS256) using Web Crypto
export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header  = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body    = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data    = `${header}.${body}`;
  const key     = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig     = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sigB64  = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${sigB64}`;
}

async function verifyToken(token: string, secret: string): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [header, body, sig] = parts;
  const data    = `${header}.${body}`;
  const key     = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const valid    = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
  if (!valid) throw new Error("Invalid signature");
  const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return payload;
}

// POST /api/checkout/session — called by the WhatsApp bot after collecting passengers
// Auth: any authenticated agent or the session middleware verifies agentId
checkoutRoutes.post("/session", zValidator("json", createSchema), async (c) => {
  const { bookingId, whatsappPhone, agentId } = c.req.valid("json");
  const tenantId = c.get("tenantId");
  const db       = c.get("db");

  const [booking] = await db
    .select({
      id:          bookings.id,
      status:      bookings.status,
      totalAmount: bookings.totalAmount,
      currency:    bookings.currency,
      heldUntil:   bookings.heldUntil,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });
  if (!["HELD", "PAYMENT_PENDING"].includes(booking.status)) {
    throw new HTTPException(400, { message: `Booking is ${booking.status} — checkout not available` });
  }

  const now     = Math.floor(Date.now() / 1000);
  const exp     = now + CHECKOUT_TTL;
  const payload = { sub: bookingId, tenantId, whatsappPhone, agentId, iat: now, exp };
  const token   = await signToken(payload, c.env.JWT_SECRET);

  // Store token in KV for single-use enforcement
  await c.env.SESSIONS_KV.put(
    `checkout:${tenantId}:${bookingId}`,
    JSON.stringify({ token, used: false }),
    { expirationTtl: CHECKOUT_TTL + 60 },
  );

  // Update booking with whatsapp phone if provided
  if (whatsappPhone) {
    await db.update(bookings).set({ whatsappPhone }).where(eq(bookings.id, bookingId));
  }

  const apiUrl = `https://api.flypoomas.com`;
  const webUrl = `https://flypoomas.com`;

  return c.json({
    token,
    checkoutUrl: `${webUrl}/checkout/${token}`,
    expiresAt:   new Date(exp * 1000).toISOString(),
    booking: {
      id:          booking.id,
      totalAmount: booking.totalAmount,
      currency:    booking.currency,
      heldUntil:   booking.heldUntil,
    },
  });
});

// GET /api/checkout/session/:token — verify and return full booking context
// Called server-side from the checkout page; not exposed to the browser directly
checkoutRoutes.get("/session/:token", async (c) => {
  const token    = c.req.param("token");
  const tenantId = c.get("tenantId");
  const db       = c.get("db");

  let payload: Record<string, unknown>;
  try {
    payload = await verifyToken(token, c.env.JWT_SECRET);
  } catch (err: any) {
    throw new HTTPException(401, { message: err.message ?? "Invalid token" });
  }

  if (payload.tenantId !== tenantId) {
    throw new HTTPException(403, { message: "Token tenant mismatch" });
  }

  const bookingId = payload.sub as string;

  // Check KV store — token must exist and not be used for payment
  const kvRaw = await c.env.SESSIONS_KV.get(`checkout:${tenantId}:${bookingId}`);
  if (!kvRaw) throw new HTTPException(410, { message: "Checkout session expired" });

  const kv = JSON.parse(kvRaw) as { token: string; used: boolean };
  if (kv.token !== token) throw new HTTPException(401, { message: "Token superseded" });

  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
    .limit(1);

  if (!booking) throw new HTTPException(404, { message: "Booking not found" });

  const passengers = await db
    .select()
    .from(bookingPassengers)
    .where(eq(bookingPassengers.bookingId, bookingId));

  return c.json({
    booking,
    passengers,
    meta: {
      whatsappPhone:  payload.whatsappPhone,
      agentId:        payload.agentId,
      tokenExpiresAt: new Date((payload.exp as number) * 1000).toISOString(),
    },
  });
});

// POST /api/checkout/session/:token/mark-paid — called after successful payment to invalidate token
checkoutRoutes.post("/session/:token/mark-paid", async (c) => {
  const token    = c.req.param("token");
  const tenantId = c.get("tenantId");

  let payload: Record<string, unknown>;
  try {
    payload = await verifyToken(token, c.env.JWT_SECRET);
  } catch {
    throw new HTTPException(401, { message: "Invalid token" });
  }

  const bookingId = payload.sub as string;
  const kvRaw = await c.env.SESSIONS_KV.get(`checkout:${tenantId}:${bookingId}`);
  if (kvRaw) {
    const kv = JSON.parse(kvRaw);
    await c.env.SESSIONS_KV.put(
      `checkout:${tenantId}:${bookingId}`,
      JSON.stringify({ ...kv, used: true }),
      { expirationTtl: 300 },  // Keep for 5 min for dedup
    );
  }

  return c.json({ ok: true });
});
