import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { TripjackHotelAdapter } from "@poomas/suppliers";
import type { SupplierCredentials } from "@poomas/suppliers";
import type { Env, Variables } from "../types.js";
import { logSupplierCall } from "../lib/supplier-logger.js";

// Every hotel call is written to Admin → Supplier logs: endpoint, gateway URL,
// HTTP status, error code, TripJack's (or the gateway's) response and timing.
function errorCodeOf(err: any): string {
  const snippet = typeof err?.responseSnippet === "string" ? err.responseSnippet : "";
  try {
    const body = JSON.parse(snippet);
    const code = body?.error ?? body?.errors?.[0]?.errCode ?? body?.status?.errCode;
    if (code) return String(code);
  } catch { /* not JSON */ }
  if (typeof err?.statusCode === "number") return `HTTP_${err.statusCode}`;
  if (err?.name === "TimeoutError" || /timed out|timeout/i.test(String(err?.message))) return "TIMEOUT";
  return err?.name === "TypeError" ? "NETWORK_ERROR" : "HOTEL_API_ERROR";
}

function errorMessageOf(err: any): string {
  const base = err instanceof Error ? err.message : String(err);
  let supplier = "";
  try {
    const body = JSON.parse(err?.responseSnippet ?? "");
    supplier = body?.errors?.map((e: any) => e?.message ?? e?.details).filter(Boolean).join("; ")
      || body?.status?.statusMessage || body?.message || body?.error || "";
  } catch { /* not JSON */ }
  const hint = err?.statusCode === 404
    ? " — the gateway or TripJack has no such route (check the gateway ROUTES map and the TripJack hotel base URL)"
    : err?.statusCode === 401 || err?.statusCode === 403 ? " — API key or IP whitelist rejected" : "";
  return `${base}${supplier ? ` — TripJack: ${supplier}` : ""}${hint}`;
}

async function logged<T>(
  c: any,
  endpoint: string,
  requestSummary: Record<string, unknown>,
  call: () => Promise<T>,
  summarize: (result: T) => Record<string, unknown> = () => ({}),
): Promise<T> {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const base = { tenantId: c.get("tenantId"), supplier: "TRIPJACK" as const, endpoint, requestId };
  const summary = { ...requestSummary, gatewayUrl: `${(c.env.TRIPJACK_API_BASE_URL ?? "").replace(/\/$/, "")}${endpoint}` };
  try {
    const result = await call();
    c.executionCtx.waitUntil(logSupplierCall(c.get("db"), {
      ...base, level: "INFO", httpStatus: 200, durationMs: Date.now() - started,
      requestSummary: { ...summary, ...summarize(result) },
    }));
    return result;
  } catch (err: any) {
    console.error(`[hotel] ${endpoint} failed`, err);
    await logSupplierCall(c.get("db"), {
      ...base, level: "ERROR",
      httpStatus: typeof err?.statusCode === "number" ? err.statusCode : undefined,
      errorCode: errorCodeOf(err),
      errorMessage: errorMessageOf(err),
      responseSnippet: typeof err?.responseSnippet === "string" ? err.responseSnippet : (err?.stack ?? String(err)).slice(0, 800),
      requestSummary: summary,
      durationMs: Date.now() - started,
    });
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { requestId });
  }
}

function hotelError(c: any, err: any, fallback: string) {
  return c.json({ error: err?.message ?? fallback, errorCode: errorCodeOf(err), requestId: err?.requestId }, 502);
}

function tripjackCredentials(env: Env): SupplierCredentials {
  return { apiKey: env.TRIPJACK_API_KEY, baseUrl: env.TRIPJACK_API_BASE_URL, proxyKey: env.TRIPJACK_PROXY_KEY };
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

  let hotels;
  try {
    hotels = await logged(c, "/hotel-search/v1", {
      cityCode: params.cityCode, checkIn: params.checkIn, checkOut: params.checkOut,
      rooms: params.rooms.length, guests: params.rooms.reduce((n, r) => n + r.adults + r.children, 0),
      nationality: params.nationality, currency: params.currency,
    }, () => adapter.search(params), (list) => ({ hotelCount: list.length }));
  } catch (err) {
    return hotelError(c, err, "Hotel search failed");
  }
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
  try {
    const result = await logged(c, "/hotel-prebook/v1", { optionId }, () => adapter.preBook(optionId),
      (r) => ({ isAvailable: r.isAvailable, totalFare: r.totalFare, currency: r.currency }));
    return c.json(result);
  } catch (err) {
    return hotelError(c, err, "Hotel price check failed");
  }
});

// Book hotel
hotelRoutes.post("/book", zValidator("json", hotelBookSchema), async (c) => {
  const params  = c.req.valid("json");
  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));
  try {
    const result = await logged(c, "/hotel-book/v1", {
      optionId: params.optionId, guests: params.guests.length, contactEmail: params.contactEmail,
    }, () => adapter.book(params), (r) => ({ success: r.success, bookingRef: r.bookingRef }));
    if (!result.success) {
      await logSupplierCall(c.get("db"), {
        tenantId: c.get("tenantId"), supplier: "TRIPJACK", endpoint: "/hotel-book/v1", level: "ERROR",
        errorCode: "HOTEL_BOOK_NOT_CONFIRMED", errorMessage: "TripJack did not confirm the hotel booking",
        requestSummary: { optionId: params.optionId }, responseSnippet: JSON.stringify(result.raw ?? {}).slice(0, 800),
      });
    }
    return c.json(result, result.success ? 201 : 422);
  } catch (err) {
    return hotelError(c, err, "Hotel booking failed");
  }
});

// Get hotel booking detail
hotelRoutes.get("/bookings/:bookingId", async (c) => {
  const { bookingId } = c.req.param();
  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));
  try {
    return c.json(await logged(c, "/hotel-booking-detail/v1", { bookingId }, () => adapter.getBookingDetail(bookingId)));
  } catch (err) {
    return hotelError(c, err, "Hotel booking details failed");
  }
});

// Cancel hotel booking
hotelRoutes.post("/bookings/:bookingId/cancel", async (c) => {
  const { bookingId } = c.req.param();
  const adapter = new TripjackHotelAdapter(tripjackCredentials(c.env));
  try {
    return c.json(await logged(c, "/hotel-cancel/v1", { bookingId }, () => adapter.cancel(bookingId),
      (r) => ({ success: r.success, status: r.status })));
  } catch (err) {
    return hotelError(c, err, "Hotel cancellation failed");
  }
});
