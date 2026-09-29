// TripJack UAT certification pack for one booking.
//
// TripJack log rules: JSON for every request / response, a separate file for
// each, the API key included, response logs unmodified, real passenger names.
//
//   00-booking-summary.json               which certification case this booking covers
//   01-search-request.json                { url, method, headers: { apikey, Content-Type }, body }
//   01-search-response.json               exactly the bytes TripJack returned
//   02-review-request.json / -response.json
//   03-book-request.json / -response.json
//   04-booking-details-…
//
// Requests are shown as sent to TripJack: the Poomas gateway URL is replaced by
// TripJack's endpoint and our internal gateway secret is never included.

import { bookingPassengers, supplierExchanges, type bookings } from "@poomas/db/schema";
import { asc, eq, or } from "drizzle-orm";
import type { Env, Variables } from "../types.js";
import { passengerNameProblem } from "./passenger-names.js";

type Booking = typeof bookings.$inferSelect;
type Db = Variables["db"];
export type PackFile = { name: string; data: Uint8Array; date: Date };

const enc = new TextEncoder();

// Gateway alias paths → TripJack paths (mirrors apps/tripjack-gateway ROUTES).
const PATH_ALIASES: Record<string, string> = {
  "/air-search-all/v2": "/fms/v1/air-search-all",
  "/air-fare-detail/v2": "/fms/v2/farerule",
  "/air-book/v2": "/oms/v1/air/book",
  "/air-booking-detail/v2": "/oms/v1/booking-details",
  "/air-cancel/v2": "/oms/v1/air/amendment/submit-amendment",
  "/v1/air/search": "/fms/v1/air-search-all",
  "/v1/air/fare-detail": "/fms/v2/farerule",
  "/v1/air/review": "/fms/v1/review",
  "/v1/air/book": "/oms/v1/air/book",
  "/v1/air/booking-detail": "/oms/v1/booking-details",
  "/v1/air/cancel": "/oms/v1/air/amendment/submit-amendment",
};

const STEP_NAMES: Record<string, string> = {
  "/fms/v1/air-search-all": "search",
  "/fms/v2/farerule": "fare-rule",
  "/fms/v1/review": "review",
  "/fms/v1/seat": "seat-map",
  "/oms/v1/air/book/fare-validate": "fare-validate",
  "/oms/v1/air/fare-validate": "confirm-fare-before-ticket",
  "/oms/v1/air/book": "book",
  "/oms/v1/air/confirm-book": "confirm-book",
  "/oms/v1/booking-details": "booking-details",
  "/oms/v1/air/unhold": "release-pnr",
  "/oms/v1/air/amendment/amendment-charges": "amendment-charges",
  "/oms/v1/air/amendment/submit-amendment": "submit-amendment",
  "/oms/v1/air/amendment/amendment-details": "amendment-details",
};

export function tripjackHost(environment: "UAT" | "PRODUCTION") {
  return environment === "PRODUCTION" ? "https://tripjack.com" : "https://apitest.tripjack.com";
}

export function tripjackPath(endpoint: string) {
  return PATH_ALIASES[endpoint] ?? endpoint;
}

// The request as TripJack received it (the gateway forwards body + apikey unchanged).
export function certificationRequest(stored: Record<string, any>, host: string) {
  const headers = (stored?.headers ?? {}) as Record<string, string>;
  const apikey = headers.apikey ?? headers.apiKey ?? headers.APIKEY;
  const path = tripjackPath(new URL(String(stored?.url ?? "http://x/")).pathname);
  return {
    url: `${host}${path}`,
    method: stored?.method ?? "POST",
    headers: { ...(apikey ? { apikey } : {}), "Content-Type": "application/json" },
    body: stored?.body ?? null,
  };
}

function exchangeFilter(b: Booking) {
  const searchId = (b.flightData as Record<string, unknown> | null)?.searchId;
  return typeof searchId === "string"
    ? or(eq(supplierExchanges.bookingId, b.id), eq(supplierExchanges.searchId, searchId))
    : eq(supplierExchanges.bookingId, b.id);
}

export async function certificationSummary(db: Db, b: Booking) {
  const pax = await db.select().from(bookingPassengers).where(eq(bookingPassengers.bookingId, b.id));
  const fd = (b.flightData ?? {}) as Record<string, any>;
  const tj = (fd.tripjack ?? {}) as Record<string, any>;
  const segments = Array.isArray(tj.segments) ? tj.segments : [];
  const extras = Array.isArray(tj.pax) ? tj.pax : [];
  const counts = { ADULT: 0, CHILD: 0, INFANT: 0 } as Record<string, number>;
  for (const p of pax) counts[p.passengerType] = (counts[p.passengerType] ?? 0) + 1;
  const fareIdentifiers: string[] = Array.isArray(tj.fareIdentifiers) ? tj.fareIdentifiers : [];
  const nameProblems = pax.flatMap((p) => [passengerNameProblem(p.firstName, "First name"), passengerNameProblem(p.lastName, "Last name")]).filter(Boolean);
  return {
    poomasBookingId: b.id,
    tripjackBookingId: b.supplierBookingRef,
    pnr: b.pnr,
    ticketNumbers: b.ticketNumbers,
    status: b.status,
    tripType: b.tripType,
    sector: `${b.origin}-${b.destination}`,
    departureDate: b.departureDate,
    segments: segments.map((s: any) => `${s.origin}-${s.destination} ${s.airline ?? ""}${s.flightNumber ?? ""} ${s.departureTime ?? ""}`.trim()),
    flightType: segments.length ? (segments.length > (b.tripType === "ONEWAY" ? 1 : 2) ? "Connecting" : "Direct") : undefined,
    passengers: { adults: counts.ADULT, children: counts.CHILD, infants: counts.INFANT,
      names: pax.map((p) => `${p.firstName} ${p.lastName} (${p.passengerType})`) },
    namesAreReal: nameProblems.length === 0,
    ...(nameProblems.length ? { nameProblems } : {}),
    bookingTypes: {
      publishedFare: fareIdentifiers.includes("PUBLISHED") || !fareIdentifiers.length,
      specialReturn: fareIdentifiers.includes("SPECIAL_RETURN"),
      studentOrSeniorCitizen: fareIdentifiers.some((f) => f === "STUDENT" || f === "SENIOR_CITIZEN") || extras.some((x: any) => x.documentId),
      withPassport: pax.some((p) => p.passportNumber),
      withGst: Boolean(tj.gstInfo || b.gstNumber),
      withSsr: extras.some((x: any) => x.ssr?.baggage?.length || x.ssr?.meal?.length),
      withSeat: extras.some((x: any) => x.ssr?.seat?.length),
      ssrAmount: tj.ssrAmount ?? 0,
      ...(tj.seatAmount ? { seatAmount: tj.seatAmount } : {}),
    },
    fareIdentifiers,
    createdAt: b.createdAt,
  };
}

// Builds the files for one booking (optionally under a folder).
export async function certificationPack(env: Env, db: Db, b: Booking, environment: "UAT" | "PRODUCTION", folder = ""): Promise<PackFile[]> {
  const host = tripjackHost(environment);
  const all = await db.select().from(supplierExchanges).where(exchangeFilter(b)).orderBy(asc(supplierExchanges.startedAt));
  // Booking details is polled every few seconds until the PNR / ticket arrive;
  // the certification pack keeps only the last (final-status) call. Every call
  // stays available individually in Admin.
  const lastDetails = [...all].reverse().find((x) => tripjackPath(x.endpoint) === "/oms/v1/booking-details" && x.responseKey);
  const rows = all.filter((x) => tripjackPath(x.endpoint) !== "/oms/v1/booking-details" || x === lastDetails);
  const files: PackFile[] = [{
    name: `${folder}00-booking-summary.json`,
    data: enc.encode(JSON.stringify(await certificationSummary(db, b), null, 2)),
    date: b.createdAt,
  }];
  let n = 0;
  for (const x of rows) {
    n += 1;
    const step = STEP_NAMES[tripjackPath(x.endpoint)] ?? tripjackPath(x.endpoint).replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-");
    const base = `${folder}${String(n).padStart(2, "0")}-${step}`;
    if (x.requestKey) {
      const obj = await env.DOCUMENTS_R2.get(x.requestKey);
      if (obj) {
        let stored: Record<string, any> = {};
        try { stored = JSON.parse(await obj.text()); } catch { /* keep empty */ }
        files.push({ name: `${base}-request.json`, data: enc.encode(JSON.stringify(certificationRequest(stored, host), null, 2)), date: x.startedAt });
      }
    }
    if (x.responseKey) {
      const obj = await env.DOCUMENTS_R2.get(x.responseKey);
      // Unmodified: the exact bytes TripJack returned.
      if (obj) files.push({ name: `${base}-response.${x.responseKey.endsWith(".txt") ? "txt" : "json"}`, data: new Uint8Array(await obj.arrayBuffer()), date: x.startedAt });
    }
  }
  return files;
}

export function packFolderName(index: number, b: Booking) {
  const clean = (v: string) => v.replace(/[^A-Za-z0-9-]+/g, "");
  return `${String(index).padStart(2, "0")}-${clean(b.origin)}-${clean(b.destination)}-${clean(b.tripType)}-${clean(b.pnr ?? b.id.slice(0, 8))}/`;
}
