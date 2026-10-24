// TripJack Hotel API v3.
//
//   POST /api/hotels/search             city (or hotel IDs) → hotels with cheapest option
//   POST /api/hotels/detail             all options for one hotel (+ static details)
//   POST /api/profile/hotels/review     authenticated durable quotation
//   POST /api/profile/hotels/book       durable UAT-only submission; default disabled
//   GET  /api/profile/hotels/bookings/:id owner-checked status recovery
//   Confirm-hold, cancel, booking list and the city sync are Admin-only
//   (/api/admin/hotels) so a booking ID alone can't cancel or charge a booking.
//   GET  /api/hotels/nationalities      nationality list (ISO2 + TripJack countryId)
//
// Supplier logs retain sanitized operational metadata only.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  HOTEL_TERMINAL_STATUSES, validHotelId, isHotelError, normalizeOption, parseHotelBookingDetails,
  type TripjackHotelV3Client,
} from "@poomas/suppliers";
import type { Env, Variables } from "../types.js";
import { logSupplierCall } from "../lib/supplier-logger.js";
import { realHotelDate, hotelStayIssues } from '../lib/hotel-input.js';
import { supplierLogCode } from '../lib/supplier-log-redaction.js';
import {
  SEARCH_TTL_MS, hotelExchanges, hotelRecorder, hotelClient, hotelContent, nationalityId, searchHotels,
} from "../lib/hotels.js";

// ── Logging helpers ─────────────────────────────────────────────────────────

function errorCodeOf(err: any): string {
  if (err?.code) return String(err.code);
  if (typeof err?.statusCode === "number") return `HTTP_${err.statusCode}`;
  if (err?.name === "TimeoutError" || /timed out|timeout/i.test(String(err?.message))) return "TIMEOUT";
  return err?.name === "TypeError" ? "NETWORK_ERROR" : "HOTEL_API_ERROR";
}

function errorMessageOf(err: any): string {
  const base = err instanceof Error ? err.message : String(err);
  const hint = err?.code === "UNSUPPORTED_TRIPJACK_ROUTE" || err?.statusCode === 404
    ? " — route not found: redeploy the TripJack gateway (hotel v3 routes) and check TRIPJACK_HMS_UPSTREAM / TRIPJACK_HOTEL_BOOKER_UPSTREAM"
    : err?.statusCode === 401 || err?.statusCode === 403 || ["UNAUTHORIZED", "FORBIDDEN", "API_KEY_SUSPENDED", "6518", "6519", "6520"].includes(String(err?.code))
      ? " — API key not authorised for hotels, or the gateway IP is not whitelisted on the TripJack hotel hosts"
      : "";
  return `${base}${hint}`;
}

export async function logged<T>(
  c: any, endpoint: string, requestSummary: Record<string, unknown>,
  call: () => Promise<T>, summarize: (result: T) => Record<string, unknown> = () => ({}),
): Promise<T> {
  const started = Date.now();
  // Same ID as the raw request / response files recorded for this call.
  const requestId = c.get("hotelRequestId") ?? crypto.randomUUID();
  const base = { tenantId: c.get("tenantId"), supplier: "TRIPJACK" as const, endpoint, requestId };
  try {
    const result = await call();
    c.executionCtx.waitUntil(logSupplierCall(c.get("db"), {
      ...base, level: "INFO", httpStatus: 200, durationMs: Date.now() - started,
      requestSummary: { ...requestSummary, ...summarize(result) },
    }));
    return result;
  } catch (err: any) {
    console.error('[hotel] supplier operation failed', { endpoint, requestId, code: supplierLogCode(errorCodeOf(err)) });
    await logSupplierCall(c.get("db"), {
      ...base, level: "ERROR",
      httpStatus: typeof err?.statusCode === "number" ? err.statusCode : undefined,
      errorCode: errorCodeOf(err),
      errorMessage: errorMessageOf(err),
      responseSnippet: typeof err?.responseSnippet === "string" ? err.responseSnippet : String(err?.stack ?? err).slice(0, 800),
      requestSummary: { ...requestSummary, tripjackEndpoint: err?.endpoint },
      durationMs: Date.now() - started,
    });
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { requestId });
  }
}

// TripJack hotel error codes that the customer can fix on the checkout form.
const GUEST_DETAIL_ERRORS: Record<string, { errorCode: string; message: string }> = {
  "1092": { errorCode: "PAN_REQUIRED", message: "This hotel needs a valid PAN (Indian tax ID, e.g. ABCDE1234F) for the lead guest. Please add it and confirm again." },
};

export function hotelError(c: any, err: any, fallback: string) {
  const code = errorCodeOf(err);
  const fixable = GUEST_DETAIL_ERRORS[code];
  if (fixable) return c.json({ error: fixable.message, errorCode: fixable.errorCode, supplierCode: code, requestId: err?.requestId }, 400);
  const status = isHotelError(err, "SESSION_EXPIRED") ? 410 : isHotelError(err, "SOLD_OUT") ? 409
    : ["CITY_INDEX_MISSING", "CITY_NOT_FOUND", "NATIONALITY_UNSUPPORTED"].includes(code) ? 404 : 502;
  const message = isHotelError(err, "SESSION_EXPIRED") ? "Your search has expired. Please search again."
    : isHotelError(err, "SOLD_OUT") ? "This room was just sold out. Please choose another option."
    : isHotelError(err, "PRICE_CHANGED") ? "The price for this room has changed. Please review the new price."
    : fallback;
  return c.json({ error: message, errorCode: supplierLogCode(code), requestId: err?.requestId }, status);
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const roomSchema = z.object({
  adults:    z.number().int().min(1).max(6).default(1),
  children:  z.number().int().min(0).max(4).default(0),
  childAge:  z.array(z.number().int().min(0).max(17)).optional(),
  childAges: z.array(z.number().int().min(0).max(17)).optional(),   // older clients
}).superRefine((r, c) => {
  const ages = r.childAge ?? r.childAges ?? [];
  if (ages.length !== r.children) c.addIssue({ code: 'custom', path: ['childAge'], message: 'Provide one age for each child.' });
  if (r.childAge && r.childAges && JSON.stringify(r.childAge) !== JSON.stringify(r.childAges)) c.addIssue({ code: 'custom', path: ['childAges'], message: 'Child ages must agree.' });
}).transform((r) => ({
  adults: r.adults,
  ...(r.children ? { children: r.children, childAge: r.childAge ?? r.childAges ?? [] } : {}),
}));

const stayFields = {
  checkIn:     z.string().refine(realHotelDate, 'Enter a real date in YYYY-MM-DD format.'),
  checkOut:    z.string().refine(realHotelDate, 'Enter a real date in YYYY-MM-DD format.'),
  rooms:       z.array(roomSchema).min(1).max(9).default([{ adults: 1, children: 0 }]),
  nationality: z.string().regex(/^[A-Za-z]{2}$/).transform(x => x.toUpperCase()).default("IN"),
  currency:    z.enum(['INR', 'AED', 'USD']).default("INR"),
};

const searchSchema = z.object({
  cityCode:    z.string().optional(),
  cityName:    z.string().optional(),
  countryCode: z.string().length(2).optional(),
  hids:        z.array(z.string().regex(/^\d+$/)).max(300).optional(),
  ...stayFields,
}).refine((b) => b.cityCode || b.cityName || b.hids?.length, { message: "cityCode, cityName or hids is required" });

// TripJack hotel IDs are numeric today; accept any plain ID so a format change
// doesn't block checkout (it is only ever sent back to TripJack).
const detailSchema = z.object({ correlationId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/), hid: z.string().refine(validHotelId, "Invalid TripJack hotel ID"), ...stayFields });

export const reviewSchema = detailSchema.extend({
  optionId:   z.string().min(1).max(1000),
  reviewHash: z.string().max(4000).optional(),
});

export const guestSchema = z.object({
  title:     z.enum(["Mr", "Mrs", "Ms", "Miss", "Master"]),
  firstName: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/),
  lastName:  z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/),
  type:      z.enum(["ADULT", "CHILD"]).default("ADULT"),
  pan:       z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/i).optional(),
  passport:  z.string().trim().min(5).max(30).regex(/^[A-Za-z0-9 -]+$/).optional(),
});

export const bookSchema = z.object({
  quoteId: z.string().uuid(),
  acceptedQuote: z.literal(true),
  idempotencyKey: z.string().uuid(),

  rooms:        z.array(z.object({ guests: z.array(guestSchema).min(1).max(10) }).superRefine((r, c) => {
    const adults = r.guests.filter(g => g.type === 'ADULT').length;
    const children = r.guests.filter(g => g.type === 'CHILD').length;
    if (adults < 1 || adults > 6 || children > 4) c.addIssue({ code: 'custom', path: ['guests'], message: 'Each room needs 1–6 adults and at most 4 children.' });
  })).min(1).max(9),
  contactEmail: z.string().email(),
  contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{6,22}$/),
  dialCode:     z.string().regex(/^\+?\d{1,4}$/).default("+91"),
  gstInfo:      z.object({ gstNumber: z.string().min(5), registeredName: z.string().min(2) }).optional(),

});

export const hotelRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
hotelRoutes.use("*", hotelExchanges);

// Request validation with a readable reason ("checkIn: Invalid") instead of the
// raw zod object, logged to Admin → Supplier logs so a rejected request shows up.
export function validJson<T extends z.ZodTypeAny>(schema: T, endpoint: string) {
  return zValidator("json", schema, (result, c: any) => {
    const stay = result.success && typeof result.data.checkIn === 'string' && typeof result.data.checkOut === 'string'
      ? hotelStayIssues(result.data) : [];
    if (result.success && !stay.length) return;
    const issues = result.success ? stay : result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    c.executionCtx.waitUntil(logSupplierCall(c.get("db"), {
      tenantId: c.get("tenantId"), supplier: "TRIPJACK", endpoint: `hotel ${endpoint}`, level: "WARN",
      errorCode: "INVALID_REQUEST", errorMessage: `Hotel ${endpoint} request rejected before calling TripJack — ${issues.join("; ")}`,
      requestSummary: {},
    }).catch(() => {}));
    return c.json({ error: `Some booking details are invalid (${issues[0]}). Please search again.`, code: "INVALID_REQUEST", issues }, 400);
  });
}

// ── Search ──────────────────────────────────────────────────────────────────

hotelRoutes.post("/search", validJson(searchSchema, "search"), async (c) => {
  const params = c.req.valid("json");
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const result = await logged(c, "/hms/v3/hotel/listing", {
      city: params.cityName ?? params.cityCode, hids: params.hids?.length, checkIn: params.checkIn, checkOut: params.checkOut,
      rooms: params.rooms.length, guests: params.rooms.reduce((n, r) => n + r.adults + (r.children ?? 0), 0),
      nationality: params.nationality, currency: params.currency,
    }, () => searchHotels(c.env, client, params), (r) => ({
      correlationId: r.correlationId, candidates: r.totalCandidates, hotelCount: r.hotels.length,
    }));
    return c.json({
      searchId:      result.correlationId,
      correlationId: result.correlationId,
      expiresAt:     new Date(Date.now() + SEARCH_TTL_MS).toISOString(),
      city:          result.city,
      hotels:        result.hotels,
      totalCandidates: result.totalCandidates,
      supplier:      "TRIPJACK",
    });
  } catch (err) {
    return hotelError(c, err, "Hotel search failed");
  }
});

// ── Detail (all options for one hotel) ──────────────────────────────────────

export async function pricingFor(c: any, client: TripjackHotelV3Client, p: z.infer<typeof detailSchema>) {
  const nationality = await nationalityId(c.env, client, p.nationality);
  return logged(c, "/hms/v3/hotel/pricing", { correlationId: p.correlationId, hid: p.hid, checkIn: p.checkIn, checkOut: p.checkOut },
    () => client.pricing({ correlationId: p.correlationId, hid: p.hid, checkIn: p.checkIn, checkOut: p.checkOut,
      rooms: p.rooms, currency: p.currency, nationality, timeoutMs: 13000 }),
    (r) => ({ optionCount: r.options?.length ?? 0 }));
}

hotelRoutes.post("/detail", validJson(detailSchema, "detail"), async (c) => {
  const p = c.req.valid("json");
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const [pricing, content] = await Promise.all([pricingFor(c, client, p), hotelContent(c.env, client, [p.hid])]);
    const options = (pricing.options ?? []).filter((o: any) => o.inventory?.available !== false && typeof o.pricing?.totalPrice === "number" && o.pricing.totalPrice > 0 && o.pricing?.currency === p.currency).map(normalizeOption).sort((a, b) => a.pricing.totalPrice - b.pricing.totalPrice);
    return c.json({
      correlationId: p.correlationId,
      hid:           p.hid,
      hotelName:     pricing.hotelName ?? content[p.hid]?.name ?? "",
      hotel:         content[p.hid] ?? null,
      reviewHash:    pricing.reviewHash,
      options,
    });
  } catch (err) {
    return hotelError(c, err, "Could not load this hotel's rooms");
  }
});

// ── Review (re-validate the chosen option; returns TripJack bookingId) ───────

export async function reviewedHotel(c: any, client: TripjackHotelV3Client, p: z.infer<typeof reviewSchema>) {
    // Never accept a browser-supplied review hash as proof of availability and
    // never fall back to a cheaper/different option if the selected rate is gone.
    const pricing = await pricingFor(c, client, p);
    const reviewHash = pricing.reviewHash;
    const optionId = p.optionId;
    const same = (pricing.options ?? []).filter((o: any) => o.inventory?.available !== false && typeof o.pricing?.totalPrice === "number" && o.pricing.totalPrice > 0 && o.pricing?.currency === p.currency).map(normalizeOption).find(o => o.optionId === optionId);
    if (!same) return c.json({ error: "The selected room or rate is no longer available. Choose another option.", errorCode: "OPTION_SOLD_OUT" }, 409);
    if (!reviewHash || same.pricing.currency !== p.currency || !Number.isFinite(same.pricing.totalPrice) || same.pricing.totalPrice <= 0) {
      return c.json({ error: 'This rate could not be verified. Please choose another option.', errorCode: 'INVALID_RATE' }, 409);
    }
    if (same.roomInfo.length !== p.rooms.length || same.roomInfo.some(r => !r.id || !r.name)) return c.json({ error: 'Supplier room details are incomplete. Choose another rate.', errorCode: 'INVALID_RATE' }, 409);
    const listedPrice = same.pricing.totalPrice;
    const review = await logged(c, "/hms/v3/hotel/review", { correlationId: p.correlationId, hid: p.hid, optionId },
      () => client.review({ correlationId: p.correlationId, optionId, reviewHash: reviewHash!, hid: p.hid }),
      (r) => ({ bookingId: r.bookingId, totalPrice: r.option?.pricing?.totalPrice }));
    if (typeof review.option?.pricing?.totalPrice !== 'number' || review.option?.pricing?.currency !== p.currency) return c.json({ error: 'Supplier rate is incomplete.', errorCode: 'INVALID_RATE' }, 409);
    const option = normalizeOption(review.option);
    if (JSON.stringify(option.roomInfo) !== JSON.stringify(same.roomInfo) || option.mealBasis !== same.mealBasis || option.optionId !== optionId || option.pricing.currency !== p.currency || !Number.isFinite(option.pricing.totalPrice) || option.pricing.totalPrice <= 0) {
      return c.json({ error: 'The selected rate has changed. Please choose a room again.', errorCode: 'INVALID_RATE' }, 409);
    }
    return {
      bookingId:     review.bookingId,
      hid:           p.hid,
      hotelName:     review.hotelName,
      option,
      optionChanged: optionId !== p.optionId,
      priceChanged:  listedPrice !== undefined && Math.abs(listedPrice - option.pricing.totalPrice) > 0.01,
      onholdAllowed: String(review.onholdAllowed) === "true",
    };
}
hotelRoutes.post('/review', validJson(reviewSchema, 'review'), c => c.json({ error: 'Sign in and use the secure hotel quotation flow.', errorCode: 'AUTHENTICATED_QUOTE_REQUIRED' }, 401));

// ── Book ────────────────────────────────────────────────────────────────────

export async function pollDetails(c: any, client: TripjackHotelV3Client, bookingId: string, maxMs: number) {
  const started = Date.now();
  let last: ReturnType<typeof parseHotelBookingDetails> | null = null;
  while (Date.now() - started < maxMs) {
    try {
      last = parseHotelBookingDetails(await client.bookingDetails(bookingId));
      if (HOTEL_TERMINAL_STATUSES.includes(last.status)) return last;
    } catch (err) {
      console.warn('[hotel] booking status lookup failed', { code: supplierLogCode(errorCodeOf(err)) });
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return last;
}

// Legacy public endpoints cannot submit or disclose bookings. Secure operations
// live under /api/profile/hotels and require a verified account and owner match.
hotelRoutes.post('/book', validJson(bookSchema, 'book'), c => c.json({ error: 'Use the signed-in hotel booking flow.', bookingEnabled: false }, 401));
hotelRoutes.get('/bookings/:bookingId', c => c.json({ error: 'Authentication required.' }, 401));

hotelRoutes.get("/nationalities", async (c) => {
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const res = await logged(c, "/hms/v3/nationality-info", {}, () => client.nationalities(),
      (r) => ({ count: r.nationalityInfos?.length ?? 0 }));
    return c.json({ nationalities: (res.nationalityInfos ?? []).map((n) => ({ code: n.code, countryId: n.countryId, name: n.name, dialCode: n.dialCode })) });
  } catch (err) {
    return hotelError(c, err, "Could not load nationalities");
  }
});
