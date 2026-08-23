import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { DuffelAdapter } from "@poomas/suppliers";
import type { Env, Variables } from "../types.js";

const passengerSchema = z.object({
  type: z.enum(["ADULT", "CHILD", "INFANT"]),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["M", "F"]),
  nationality: z.string().length(2).default("IN"),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const bookSchema = z.object({
  fareId: z.string().min(1),
  passengers: z.array(passengerSchema).min(1).max(9),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8),
});

export const duffelSandboxRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function adapterFor(c: any) {
  const key = c.env.DUFFEL_API_KEY as string | undefined;
  if (!key) throw new Error("Duffel sandbox is not configured");
  // Hard safety rail: this public checkout endpoint must never use a live token.
  if (!key.startsWith("duffel_test_")) throw new Error("Duffel sandbox checkout requires a duffel_test_ token");
  return new DuffelAdapter({ apiKey: key });
}

// Re-fetch the selected offer immediately before checkout so the customer sees
// the current supplier price/currency and expiry rather than stale search data.
duffelSandboxRoutes.get("/offer/:fareId", async (c) => {
  try {
    const adapter = adapterFor(c);
    const held = await adapter.hold!({ fareId: c.req.param("fareId"), passengers: [] });
    return c.json({
      sandbox: true,
      offer: held.fareSnapshot,
      expiresAt: held.expiresAt,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unable to load Duffel offer" }, 422);
  }
});

// Sandbox-only instant booking. Payment uses Duffel test balance; no real card or
// POOMAS payment gateway is charged. The returned Duffel booking reference is the
// test PNR/confirmation reference for validating the end-to-end flow.
duffelSandboxRoutes.post("/book", zValidator("json", bookSchema), async (c) => {
  try {
    const body = c.req.valid("json");
    const adapter = adapterFor(c);
    const result = await adapter.book!({
      fareId: body.fareId,
      holdId: body.fareId,
      passengers: body.passengers,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      paymentRef: "DUFFEL_SANDBOX_BALANCE",
    });

    return c.json({
      sandbox: true,
      success: result.success,
      bookingReference: result.bookingRef,
      pnr: result.pnr,
      status: result.status,
      ticketNumbers: result.ticketNumbers,
    }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Duffel sandbox booking failed" }, 422);
  }
});
