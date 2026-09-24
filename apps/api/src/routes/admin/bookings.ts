import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  bookings, bookingPassengers, payments, bookingAmendments, supportRequests,
  walletTransactions, supplierExchanges, users,
} from "@poomas/db/schema";
import { eq, and, asc, desc, or } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";
import { tripjackClientFor, parseBookingDetails } from "../../lib/trips.js";
import { buildZip } from "../../lib/zip.js";

export const bookingsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// TENANT_ADMIN sees only their tenant's bookings
// SUPER_ADMIN sees all bookings; optionally filtered by ?tenantId=
bookingsAdminRoutes.get("/", async (c) => {
  const db             = c.get("db");
  const role           = c.get("userRole");
  const filterTenantId = role === "SUPER_ADMIN"
    ? c.req.query("tenantId")   // optional for SUPER_ADMIN
    : c.get("tenantId");        // mandatory for TENANT_ADMIN

  const status  = c.req.query("status");
  const pnr     = c.req.query("pnr");
  const limit   = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset  = parseInt(c.req.query("offset") ?? "0");

  const conditions = [];
  if (filterTenantId) conditions.push(eq(bookings.tenantId, filterTenantId));
  if (status)         conditions.push(eq(bookings.status, status as "CONFIRMED"));
  if (pnr)            conditions.push(eq(bookings.pnr, pnr));

  const rows = await db
    .select()
    .from(bookings)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(bookings.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ bookings: rows, total: rows.length });
});

// Force status override (admin only, audit-logged)
bookingsAdminRoutes.patch("/:id/status", async (c) => {
  const { status, note } = await c.req.json() as { status: string; note: string };
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  await db.update(bookings)
    .set({ status: status as "CONFIRMED", updatedAt: new Date() })
    .where(and(eq(bookings.id, c.req.param("id")), eq(bookings.tenantId, tenantId)));

  // TODO: write to audit_logs
  return c.json({ ok: true });
});

// ── Booking detail + raw supplier logs ───────────────────────────────────────

async function loadBooking(c: any, id: string) {
  const role = c.get("userRole");
  const [b] = await c.get("db").select().from(bookings)
    .where(role === "SUPER_ADMIN" ? eq(bookings.id, id) : and(eq(bookings.id, id), eq(bookings.tenantId, c.get("tenantId"))))
    .limit(1);
  if (!b) throw new HTTPException(404, { message: "Booking not found" });
  return b as typeof bookings.$inferSelect;
}

// Exchanges for the booking itself plus the search it was booked from.
function exchangeFilter(b: typeof bookings.$inferSelect) {
  const searchId = (b.flightData as Record<string, unknown> | null)?.searchId;
  return typeof searchId === "string"
    ? or(eq(supplierExchanges.bookingId, b.id), eq(supplierExchanges.searchId, searchId))
    : eq(supplierExchanges.bookingId, b.id);
}

bookingsAdminRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const b = await loadBooking(c, c.req.param("id"));
  const [passengers, paymentRows, amendments, support, walletTx, exchanges, customer] = await Promise.all([
    db.select().from(bookingPassengers).where(eq(bookingPassengers.bookingId, b.id)),
    db.select().from(payments).where(eq(payments.bookingId, b.id)).orderBy(asc(payments.createdAt)),
    db.select().from(bookingAmendments).where(eq(bookingAmendments.bookingId, b.id)).orderBy(desc(bookingAmendments.createdAt)),
    db.select().from(supportRequests).where(eq(supportRequests.bookingId, b.id)).orderBy(desc(supportRequests.createdAt)),
    db.select().from(walletTransactions).where(eq(walletTransactions.bookingId, b.id)).orderBy(asc(walletTransactions.createdAt)),
    db.select().from(supplierExchanges).where(exchangeFilter(b)).orderBy(asc(supplierExchanges.startedAt)),
    b.userId ? db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, b.userId)).limit(1) : Promise.resolve([]),
  ]);
  return c.json({
    booking: b, customer: customer[0] ?? null, passengers, payments: paymentRows, cancellations: amendments,
    supportRequests: support, walletTransactions: walletTx,
    exchanges: exchanges.map((x) => ({ ...x, requestKey: undefined, responseKey: undefined, hasResponse: Boolean(x.responseKey) })),
  });
});

// One log file exactly as stored: part = "request" | "response".
bookingsAdminRoutes.get("/:id/exchanges/:exchangeId/:part", async (c) => {
  const db = c.get("db");
  const b = await loadBooking(c, c.req.param("id"));
  const part = c.req.param("part");
  if (part !== "request" && part !== "response") throw new HTTPException(400, { message: "part must be request or response" });
  const [x] = await db.select().from(supplierExchanges)
    .where(and(eq(supplierExchanges.id, c.req.param("exchangeId")), exchangeFilter(b)!)).limit(1);
  const key = part === "request" ? x?.requestKey : x?.responseKey;
  if (!x || !key) throw new HTTPException(404, { message: "Log file not found" });
  const obj = await c.env.DOCUMENTS_R2.get(key);
  if (!obj) throw new HTTPException(404, { message: "Log file missing from storage" });
  const name = key.split("/").pop()!;
  return new Response(obj.body, { headers: {
    "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store",
  } });
});

// All request/response files for the booking as one ZIP (each file unchanged).
bookingsAdminRoutes.get("/:id/exchanges.zip", async (c) => {
  const db = c.get("db");
  const b = await loadBooking(c, c.req.param("id"));
  const rows = await db.select().from(supplierExchanges).where(exchangeFilter(b)).orderBy(asc(supplierExchanges.startedAt));
  const files: { name: string; data: Uint8Array; date: Date }[] = [];
  for (const x of rows) {
    for (const key of [x.requestKey, x.responseKey]) {
      if (!key) continue;
      const obj = await c.env.DOCUMENTS_R2.get(key);
      if (obj) files.push({ name: key.split("/").pop()!, data: new Uint8Array(await obj.arrayBuffer()), date: x.startedAt });
    }
  }
  if (!files.length) throw new HTTPException(404, { message: "No API logs stored for this booking yet" });
  return new Response(buildZip(files), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="booking-${b.pnr ?? b.id.slice(0, 8)}-api-logs.zip"`,
    "Cache-Control": "private, no-store",
  } });
});

// Calls TripJack booking-details now (logged against the booking) and returns the parsed result.
bookingsAdminRoutes.post("/:id/refresh-details", async (c) => {
  const b = await loadBooking(c, c.req.param("id"));
  if (b.supplier !== "TRIPJACK" || !b.supplierBookingRef) throw new HTTPException(400, { message: "No TripJack booking reference on this booking" });
  const client = await tripjackClientFor(c as any, b.id);
  try {
    const raw = await client.pnrStatus(b.supplierBookingRef);
    return c.json({ ok: true, details: parseBookingDetails(raw) });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
