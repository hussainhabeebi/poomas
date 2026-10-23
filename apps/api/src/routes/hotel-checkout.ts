import { Hono } from 'hono';
import { and, eq, lte, desc, isNull } from 'drizzle-orm';
import { hotelQuotes, hotelAttempts } from '@poomas/db/schema';
import { normalizeOption, parseHotelBookingDetails } from '@poomas/suppliers';
import type { Env, Variables } from '../types.js';
import { authMiddleware } from '../middleware/auth.js';
import { hotelClient, hotelRecorder, hotelExchanges, tripjackEnvironment } from '../lib/hotels.js';
import { bookSchema, reviewSchema, validJson, reviewedHotel, pricingFor, hotelError } from './hotel.js';
import { HOTEL_QUOTE_TTL_MS, HOTEL_POLL_WINDOW_MS, HOTEL_MAX_CHECKS, HOTEL_SETTLED, hotelRateEqual, validateHotelGuests, hotelRequestHash, hotelRecoveryState } from '../lib/hotel-booking-state.js';

export const hotelCheckoutRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
hotelCheckoutRoutes.use('*', authMiddleware, async (c, next) => {
  // API keys and flight-scoped checkout tokens do not establish hotel ownership.
  if (!c.get('userId') || !['CUSTOMER', 'AGENT_ADMIN', 'AGENT_STAFF', 'SUPER_ADMIN', 'TENANT_ADMIN', 'STAFF'].includes(c.get('userRole') ?? '')) return c.json({ error: 'A signed-in hotel customer is required.' }, 403);
  await next();
}, hotelExchanges);
const owner = (c: any) => and(eq(hotelQuotes.tenantId, c.get('tenantId')), eq(hotelQuotes.userId, c.get('userId')));
const attemptOwner = (c: any) => and(eq(hotelAttempts.tenantId, c.get('tenantId')), eq(hotelAttempts.userId, c.get('userId')));
// A SQL compare-and-set token: state + monotonic poll counter + one-time action
// markers. Every status writer checks the same persisted snapshot. Admin intents
// change state/markers and immediately invalidate all earlier in-flight lookups.
function attemptStateGuard(a: typeof hotelAttempts.$inferSelect) {
  return and(eq(hotelAttempts.id, a.id), eq(hotelAttempts.tenantId, a.tenantId),
    eq(hotelAttempts.state, a.state),
    a.confirmationStartedAt == null ? isNull(hotelAttempts.confirmationStartedAt) : eq(hotelAttempts.confirmationStartedAt, a.confirmationStartedAt),
    a.cancellationStartedAt == null ? isNull(hotelAttempts.cancellationStartedAt) : eq(hotelAttempts.cancellationStartedAt, a.cancellationStartedAt));
}
function attemptPollGuard(a: typeof hotelAttempts.$inferSelect, checks = a.checks) {
  return and(attemptStateGuard(a), eq(hotelAttempts.checks, checks));
}

// Fingerprint prevents recovering a booking against a different gateway/account.
async function providerScope(c: any) {
  const saved = await c.env.TENANT_CACHE_KV.get(`admin_settings:${c.get('tenantId')}:integration:tripjack`, 'json');
  return hotelRequestHash([c.env.TRIPJACK_API_BASE_URL, saved?.apiKey || c.env.TRIPJACK_API_KEY, await tripjackEnvironment(c.env, c.get('tenantId'))]);
}
function publicAttempt(a: any) {
  return { id: a.id, quoteId: a.quoteId, status: a.state, mode: a.mode, details: a.outcome,
    pending: !HOTEL_SETTLED.includes(a.state), manualRecoveryRequired: ![...HOTEL_SETTLED, 'CANCELLATION_PENDING'].includes(a.state) && (a.checks >= HOTEL_MAX_CHECKS || Date.now() - a.createdAt.getTime() >= HOTEL_POLL_WINDOW_MS),
    nextCheckAt: a.nextCheckAt, createdAt: a.createdAt };
}
hotelCheckoutRoutes.post('/review', validJson(reviewSchema, 'review'), async c => {
  const p = c.req.valid('json');
  try {
    const client = await hotelClient(c.env, c.get('tenantId'), hotelRecorder(c));
    const result = await reviewedHotel(c, client, p);
    if (result instanceof Response) return result;
    if (!/^[A-Za-z0-9_-]{5,100}$/.test(result.bookingId ?? '')) return c.json({ error: 'Supplier review did not return a valid booking reference.' }, 502);
    const id = crypto.randomUUID(), expiresAt = new Date(Date.now() + HOTEL_QUOTE_TTL_MS);
    await c.get('db').insert(hotelQuotes).values({ id, tenantId: c.get('tenantId'), userId: c.get('userId')!,
      selection: p, snapshot: result, providerBookingId: result.bookingId, providerScope: await providerScope(c), expiresAt });
    return c.json({ ...result, quoteId: id, expiresAt, bookingEnabled: ['HOLD_UAT', 'INSTANT_UAT'].includes(c.env.HOTEL_BOOKING_MODE ?? '') && c.env.ENVIRONMENT !== 'production' && await tripjackEnvironment(c.env, c.get('tenantId')) === 'UAT' });
  } catch (err) { return hotelError(c, err, 'Could not securely save this quotation. Please review again.'); }
});

hotelCheckoutRoutes.post('/book', validJson(bookSchema, 'book'), async c => {
  const p = c.req.valid('json'), db = c.get('db');
  // No silent default to an instant charge or hold. Only explicit authorized UAT.
  const mode = c.env.HOTEL_BOOKING_MODE;
  if (!['HOLD_UAT', 'INSTANT_UAT'].includes(mode ?? '') || c.env.ENVIRONMENT === 'production' || await tripjackEnvironment(c.env, c.get('tenantId')) !== 'UAT') return c.json({ error: 'Hotel booking is awaiting authorization.', bookingEnabled: false }, 503);
  const [q] = await db.select().from(hotelQuotes).where(and(owner(c), eq(hotelQuotes.id, p.quoteId))).limit(1);
  if (!q) return c.json({ error: 'Quotation not found.' }, 404);
  if (q.providerScope !== await providerScope(c)) return c.json({ error: 'Supplier configuration changed. Contact support.' }, 409);
  const requestHash = await hotelRequestHash(p);
  const [existing] = await db.select().from(hotelAttempts).where(and(attemptOwner(c), eq(hotelAttempts.idempotencyKey, p.idempotencyKey))).limit(1);
  if (existing) return existing.requestHash === requestHash ? c.json(publicAttempt(existing), 202) : c.json({ error: 'This submission key has already been used for different details.' }, 409);
  if (q.expiresAt.getTime() <= Date.now()) return c.json({ error: 'Your quotation expired. Review this room again.', errorCode: 'QUOTE_EXPIRED' }, 410);
  const selection = q.selection as any, snapshot = q.snapshot as any;
  if (p.gstInfo || !['NA', ''].includes(snapshot.option.compliance?.gstType ?? '')) return c.json({ error: 'GST passthrough requires a verified supplier and business configuration. Contact the team.' }, 409);
  const invalid = validateHotelGuests(selection, snapshot.option, p.rooms);
  if (invalid) return c.json({ error: invalid }, 400);
  if (mode === 'HOLD_UAT' && !snapshot.onholdAllowed) return c.json({ error: 'This rate cannot be held.' }, 409);
  const client = await hotelClient(c.env, c.get('tenantId'), hotelRecorder(c));
  try {
    const pricing = await pricingFor(c, client, selection);
    const current = (pricing.options ?? []).filter((o: any) => o.inventory?.available !== false && typeof o.pricing?.totalPrice === 'number' && o.pricing?.currency === selection.currency).map(normalizeOption).find(o => o.optionId === selection.optionId);
    if (!current || !hotelRateEqual(snapshot.option, current)) return c.json({ error: 'Availability, price or terms changed. Review and explicitly accept the new quotation.', errorCode: 'PRICE_CHANGED' }, 409);
    if (q.expiresAt.getTime() <= Date.now()) return c.json({ error: 'Your quotation expired during validation. Review again.', errorCode: 'QUOTE_EXPIRED' }, 410);
    // UNIQUE quote + owner/idempotency key arbitrate races across workers/restarts.
    const id = crypto.randomUUID();
    const rows = await db.insert(hotelAttempts).values({ id, tenantId: c.get('tenantId'), userId: c.get('userId')!, quoteId: q.id,
      idempotencyKey: p.idempotencyKey, requestHash, providerBookingId: q.providerBookingId, mode: mode!, state: 'SUBMITTING' }).onConflictDoNothing().returning();
    if (!rows.length) {
      const [a] = await db.select().from(hotelAttempts).where(and(attemptOwner(c), eq(hotelAttempts.providerBookingId, q.providerBookingId))).limit(1);
      return a && a.requestHash === requestHash ? c.json(publicAttempt(a), 202) : c.json({ error: 'This quotation already has a booking attempt. Check My Trips; do not submit again.' }, 409);
    }
    // Everything after the durable claim is uncertain on error, even HTTP errors.
    try {
      const result = await client.book({ bookingId: q.providerBookingId,
        roomTravellerInfo: p.rooms.map(r => ({ travellerInfo: r.guests.map(g => ({ ti: g.title, pt: g.type, fN: g.firstName, lN: g.lastName,
          ...(g.pan ? { pan: g.pan.toUpperCase() } : {}), ...(g.passport ? { pNum: g.passport } : {}) })) })),
        deliveryInfo: { emails: [p.contactEmail], contacts: [p.contactPhone.replace(/\D/g, '')], code: [p.dialCode.startsWith('+') ? p.dialCode : `+${p.dialCode}`] },
        ...(p.gstInfo ? { gstInfo: p.gstInfo } : {}),
        ...(mode === 'INSTANT_UAT' ? { paymentInfos: [{ amount: snapshot.option.pricing.totalPrice }] } : {}) });
      // Never trust an unrelated returned booking ID for recovery.
      if (result.bookingId && result.bookingId !== q.providerBookingId) throw new Error('Supplier reference mismatch');
      await db.update(hotelAttempts).set({ state: 'PENDING', updatedAt: new Date() }).where(and(eq(hotelAttempts.id, id), eq(hotelAttempts.state, 'SUBMITTING'), isNull(hotelAttempts.confirmationStartedAt), isNull(hotelAttempts.cancellationStartedAt)));
    } catch {
      await db.update(hotelAttempts).set({ state: 'UNKNOWN', updatedAt: new Date() }).where(and(eq(hotelAttempts.id, id), eq(hotelAttempts.state, 'SUBMITTING'), isNull(hotelAttempts.confirmationStartedAt), isNull(hotelAttempts.cancellationStartedAt)));
    }
    const [a] = await db.select().from(hotelAttempts).where(eq(hotelAttempts.id, id)).limit(1);
    return c.json(publicAttempt(a), 202);
  } catch (err) { return hotelError(c, err, 'Could not validate this booking. Check My Trips before retrying.'); }
});

hotelCheckoutRoutes.get('/bookings', async c => {
  const rows = await c.get('db').select({ attempt: hotelAttempts, quote: hotelQuotes }).from(hotelAttempts)
    .innerJoin(hotelQuotes, eq(hotelAttempts.quoteId, hotelQuotes.id)).where(attemptOwner(c)).orderBy(desc(hotelAttempts.createdAt)).limit(100);
  return c.json({ bookings: rows.map(({ attempt, quote }) => ({ ...publicAttempt(attempt), selection: quote.selection, quotation: quote.snapshot })) });
});
hotelCheckoutRoutes.get('/bookings/:id', async c => {
  const db = c.get('db');
  const [a] = await db.select().from(hotelAttempts).where(and(attemptOwner(c), eq(hotelAttempts.id, c.req.param('id')))).limit(1);
  if (!a) return c.json({ error: 'Booking not found.' }, 404);
  const [q] = await db.select().from(hotelQuotes).where(and(owner(c), eq(hotelQuotes.id, a.quoteId))).limit(1);
  return recoverStoredHotelBooking(c, a, q);
});

// Reused by the existing permission-checked admin router; lookup only, never Book.
export async function recoverStoredHotelBooking(c: any, a: any, q: any, operator = false) {
  const db = c.get('db');
  if (a.tenantId !== c.get('tenantId') || q?.tenantId !== c.get('tenantId')) return c.json({ error: 'Booking not found.' }, 404);
  if (!q || q.providerScope !== await providerScope(c)) return c.json({ error: 'Supplier configuration changed. Contact support.' }, 409);
  // ON_HOLD must be checked again later to observe auto-cancellation/confirmation.
  if (!['FAILED', 'ABORTED', 'CANCELLED'].includes(a.state) && (operator || a.checks < HOTEL_MAX_CHECKS && Date.now() - a.createdAt.getTime() < HOTEL_POLL_WINDOW_MS || ['SUCCESS', 'ON_HOLD', 'CANCELLATION_PENDING'].includes(a.state))) {
    const now = new Date();
    const claimed = await db.update(hotelAttempts).set({ checks: a.checks + 1, nextCheckAt: new Date(now.getTime() + 60_000), updatedAt: now })
      .where(and(attemptPollGuard(a), lte(hotelAttempts.nextCheckAt, now))).returning();
    if (claimed.length) {
      try {
        const client = await hotelClient(c.env, c.get('tenantId'), hotelRecorder(c));
        const details = parseHotelBookingDetails(await client.bookingDetails(a.providerBookingId));
        if (details.bookingId !== a.providerBookingId) throw new Error('Unrelated booking details');
        // Persist only status metadata, never supplier guest/contact payloads.
        const state = hotelRecoveryState(a.state, details.status);
        // Without supplier ordering/version fields, regressive observations cannot
        // erase verified details or acknowledge an unresolved admin action.
        const outcome = state === details.status
          ? { status: state, confirmationNo: details.confirmationNo, holdDeadline: details.holdDeadline }
          : a.outcome;
        const settled = ['SUCCESS', 'ON_HOLD', 'CANCELLATION_PENDING'].includes(state);
        let nextCheckAt = new Date(Date.now() + (settled ? 86400_000 : 5000));
        // Supplier deadline strings without an offset are IST, never browser-local.
        const holdDeadline = (outcome as { holdDeadline?: string } | null)?.holdDeadline;
        if (state === 'ON_HOLD' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(holdDeadline ?? '')) {
          const deadline = Date.parse(`${holdDeadline}+05:30`);
          if (Number.isFinite(deadline)) nextCheckAt = new Date(Math.min(nextCheckAt.getTime(), Math.max(Date.now() + 5000, deadline + 5000)));
        }
        await db.update(hotelAttempts).set({ state, outcome, nextCheckAt, updatedAt: new Date() })
          .where(attemptPollGuard(a, a.checks + 1));
      } catch {
        // Unknown/not-found is NOT proof no booking exists. Never resubmit.
        await db.update(hotelAttempts).set({ nextCheckAt: new Date(Date.now() + (operator ? 60_000 : 5000)) }).where(attemptPollGuard(a, a.checks + 1));
      }
    }
  }
  const [latest] = await db.select().from(hotelAttempts).where(eq(hotelAttempts.id, a.id)).limit(1);
  return c.json(publicAttempt(latest));
}

hotelCheckoutRoutes.get('/quotes/:id', async c => {
  const [q] = await c.get('db').select().from(hotelQuotes).where(and(owner(c), eq(hotelQuotes.id, c.req.param('id')))).limit(1);
  if (!q) return c.json({ error: 'Quotation not found.' }, 404);
  return c.json({ quoteId: q.id, selection: q.selection, ...(q.snapshot as object), expiresAt: q.expiresAt,
    bookingEnabled: ['HOLD_UAT', 'INSTANT_UAT'].includes(c.env.HOTEL_BOOKING_MODE ?? '') && c.env.ENVIRONMENT !== 'production' && await tripjackEnvironment(c.env, c.get('tenantId')) === 'UAT' });
});
hotelCheckoutRoutes.get('/submissions/:key', async c => {
  const [a] = await c.get('db').select().from(hotelAttempts).where(and(attemptOwner(c), eq(hotelAttempts.idempotencyKey, c.req.param('key')))).limit(1);
  return a ? c.json(publicAttempt(a)) : c.json({ error: 'Submission not found.' }, 404);
});

// Consequential admin actions remain provisional and isolated-UAT only. Persist
// intent before sending; an ambiguous response can only be reconciled, not retried.
export async function storedHotelAction(c: any, action: 'confirm' | 'cancel', bookingId: string) {
  if (!['SUPER_ADMIN', 'TENANT_ADMIN', 'STAFF'].includes(c.get('userRole') ?? '')) return c.json({ error: 'Admin access required.' }, 403);
  if (!['HOLD_UAT', 'INSTANT_UAT'].includes(c.env.HOTEL_BOOKING_MODE ?? '') || c.env.ENVIRONMENT === 'production' || await tripjackEnvironment(c.env, c.get('tenantId')) !== 'UAT') return c.json({ error: 'Hotel booking actions await authorization.' }, 503);
  const db = c.get('db');
  const [a] = await db.select().from(hotelAttempts).where(and(eq(hotelAttempts.tenantId, c.get('tenantId')), eq(hotelAttempts.providerBookingId, bookingId))).limit(1);
  if (!a) return c.json({ error: 'A verified stored hotel booking is required. Legacy bookings require manual supplier review.' }, 409);
  const [q] = await db.select().from(hotelQuotes).where(and(eq(hotelQuotes.tenantId, c.get('tenantId')), eq(hotelQuotes.id, a.quoteId))).limit(1);
  if (!q || q.providerScope !== await providerScope(c)) return c.json({ error: 'Supplier configuration changed.' }, 409);
  const marker = action === 'confirm' ? 'confirmationStartedAt' : 'cancellationStartedAt';
  if (a[marker]) return c.json({ ...publicAttempt(a), actionAlreadyRequested: true }, 202);
  if (action === 'cancel' && a.confirmationStartedAt && a.state !== 'SUCCESS') return c.json({ error: 'Confirmation is unresolved. Reconcile it before cancellation.' }, 409);

  const client = await hotelClient(c.env, c.get('tenantId'), hotelRecorder(c));
  try {
    const raw = await client.bookingDetails(bookingId);
    if (raw?.order?.bookingId !== bookingId) return c.json({ error: 'Supplier booking reference mismatch.' }, 409);
    const status = raw.order.status;
    if (action === 'confirm' && status !== 'ON_HOLD' || action === 'cancel' && !['ON_HOLD', 'SUCCESS'].includes(status)) return c.json({ error: 'Booking is not eligible for this action. Reconcile its status first.' }, 409);
    const price = (q.snapshot as any).option.pricing;
    if (typeof raw.order.amount !== 'number' || raw.order.amount !== price.totalPrice) return c.json({ error: 'Supplier amount changed. Staff must review the discrepancy.' }, 409);
    const currency = raw?.itemInfos?.HOTEL?.hInfo?.ops?.[0]?.sc;
    if (currency !== price.currency) return c.json({ error: 'Supplier currency mismatch.' }, 409);
    // Exclude concurrent confirmation and cancellation. No browser amount is used.
    const claimed = await db.update(hotelAttempts).set({ [marker]: new Date(), state: action === 'confirm' ? 'CONFIRM_PENDING' : 'CANCELLATION_PENDING', nextCheckAt: new Date(), updatedAt: new Date() })
      .where(and(attemptStateGuard(a), ...(action === 'confirm' ? [isNull(hotelAttempts.confirmationStartedAt), isNull(hotelAttempts.cancellationStartedAt)] : [isNull(hotelAttempts.cancellationStartedAt), eq(hotelAttempts.state, a.state)]))).returning();
    if (!claimed.length) return c.json({ error: 'An action is already in progress. Reconcile before proceeding.' }, 409);
    try { if (action === 'confirm') await client.confirmBook(bookingId, price.totalPrice); else await client.cancel(bookingId); }
    catch { /* Persisted intent survives errors and process restarts. Never replay. */ }
    const [saved] = await db.select().from(hotelAttempts).where(eq(hotelAttempts.id, a.id)).limit(1);
    return c.json({ ...publicAttempt(saved), actionRequested: true }, 202);
  } catch (err) { return hotelError(c, err, 'Could not verify this booking action. Reconcile before retrying.'); }
}
