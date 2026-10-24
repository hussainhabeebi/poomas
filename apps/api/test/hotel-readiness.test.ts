import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { hotelClient } from '../src/lib/hotels.js';
import { hotelRoutes, reviewedHotel, validJson, reviewSchema, hotelError } from '../src/routes/hotel.js';
import { realHotelDate, hotelStayIssues } from '../src/lib/hotel-input.js';
import { persistExchanges } from '../src/lib/api-exchanges.js';
import { logSupplierCall } from '../src/lib/supplier-logger.js';
import { supplierLogBody, supplierLogCode } from '../src/lib/supplier-log-redaction.js';

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const stay = () => ({ checkIn: day(30), checkOut: day(32), rooms: [{ adults: 2, children: 0 }], nationality: 'IN', currency: 'INR' });
const selection = () => ({ ...stay(), hid: '100123', correlationId: 'a'.repeat(32), optionId: 'selected' });
const option = (extra: any = {}) => ({ optionId: 'selected', roomInfo: [{ id: 'room', name: 'Fixture suite', adults: 2, children: 0 }], mealBasis: 'Breakfast', pricing: { totalPrice: 100, currency: 'INR' }, ...extra });

function fixture() {
  const records: any[] = [], files: any[] = [], jobs: Promise<any>[] = [];
  const db: any = { insert: () => ({ values: async (value: any) => { records.push(value); } }) };
  const env: any = {
    TRIPJACK_API_BASE_URL: 'https://mock-gateway.invalid', TRIPJACK_API_KEY: 'fixture-api-secret', TRIPJACK_PROXY_KEY: 'fixture-proxy-secret',
    TENANT_CACHE_KV: { get: async () => null },
    FARE_CACHE_KV: { get: async () => ({ IN: '106' }), put: async () => {} },
    DOCUMENTS_R2: { put: async (...args: any[]) => { files.push(args); } },
  };
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('tenantId', 'tenant'); c.set('db', db); await next(); });
  // Isolate Review contract tests from the signed-in persistence boundary.
  app.post('/hotels/review', validJson(reviewSchema, 'review'), async c => {
    try { const r = await reviewedHotel(c, await hotelClient(c.env, 'tenant'), c.req.valid('json')); return r instanceof Response ? r : c.json(r); }
    catch (e) { return hotelError(c, e, 'Could not confirm this room'); }
  });
  app.route('/hotels', hotelRoutes);
  const post = (path: string, body: any) => app.fetch(new Request(`https://fixture.invalid/hotels/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env, { waitUntil: p => { jobs.push(p); }, passThroughOnException() {} });
  return { post, db, env, records, files, jobs };
}

test('calendar validation rejects impossible dates and compares date-only values consistently', () => {
  for (const date of ['2026-02-29', '2024-02-30', '0000-01-01', '2026-13-01', '2026-04-31', '2026-1-01', '222222-01-01']) assert.equal(realHotelDate(date), false, date);
  assert.equal(realHotelDate('2024-02-29'), true);
  const now = new Date('2026-10-23T23:30:00-05:00');
  assert.deepEqual(hotelStayIssues({ checkIn: '2026-10-24', checkOut: '2026-10-25' }, now), []);
  for (const stay of [{ checkIn: '2026-10-23', checkOut: '2026-10-25' }, { checkIn: '2026-10-24', checkOut: '2026-10-24' }, { checkIn: '2026-10-25', checkOut: '2026-10-24' }]) assert.ok(hotelStayIssues(stay, now).length);
});

test('invalid dates, occupancy, age counts and currency are rejected before supplier requests', async t => {
  const f = fixture();
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('No network permitted'); };
  const cases = [
    { checkIn: '2099-02-30' }, { checkIn: day(-1) }, { checkOut: day(30) }, { checkOut: day(29) },
    { rooms: [] }, { rooms: [{ adults: 0 }] }, { rooms: [{ adults: 1.5 }] }, { rooms: [{ adults: 10 }] },
    { rooms: [{ adults: 1, children: 1 }] }, { rooms: [{ adults: 1, children: 0, childAge: [4] }] },
    { rooms: [{ adults: 1, children: 1, childAge: [-1] }] }, { rooms: [{ adults: 1, children: 1, childAge: [18] }] },
    { rooms: [{ adults: 1, children: 1, childAge: [4], childAges: [5] }] },
    { nationality: '106' }, { currency: 'XYZ' }, { currency: 'INR<script>' },
  ];
  for (const patch of cases) {
    const response = await f.post('search', { cityCode: 'DXB', ...stay(), ...patch });
    assert.equal(response.status, 400, JSON.stringify(patch));
  }
  assert.equal(calls, 0);
});

test('booking guest validation rejects missing adults, blank names and malformed contact details without provider calls', async t => {
  const f = fixture(); const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('No network permitted'); };
  const guest = { title: 'Mr', firstName: 'Test', lastName: 'Guest', type: 'ADULT' };
  const valid = { quoteId: crypto.randomUUID(), acceptedQuote: true, idempotencyKey: crypto.randomUUID(), rooms: [{ guests: [guest] }], contactEmail: 'guest@example.test', contactPhone: '9999999999' };
  for (const patch of [
    { rooms: [{ guests: [{ ...guest, type: 'CHILD' }] }] },
    { rooms: [{ guests: [{ ...guest, firstName: '   ' }] }] },
    { rooms: [{ guests: [{ ...guest, lastName: 'Test\nGuest' }] }] },
    { rooms: [{ guests: [{ ...guest, passport: 'bad<script>' }] }] },
    { rooms: [] }, { quoteId: '../private' }, { contactPhone: 'not-a-phone' }, { idempotencyKey: 'invalid' },
  ]) assert.equal((await f.post('book', { ...valid, ...patch })).status, 400);
  assert.equal(calls, 0);
});

test('a vanished selected rate is not silently replaced, even with a browser-supplied review hash', async t => {
  const f = fixture(); const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const urls: string[] = [];
  globalThis.fetch = async (url, request) => {
    urls.push(String(url));
    assert.equal(new Headers(request?.headers).get('apikey'), 'fixture-api-secret');
    return Response.json({ reviewHash: 'server-hash', options: [option({ optionId: 'different' })] });
  };
  const response = await f.post('review', { ...selection(), reviewHash: 'untrusted-hash' });
  assert.equal(response.status, 409);
  assert.equal((await response.json() as any).errorCode, 'OPTION_SOLD_OUT');
  assert.deepEqual(urls, ['https://mock-gateway.invalid/hms/v3/hotel/pricing']);
  await Promise.all(f.jobs);
});

test('review detects changed price and rejects unexpected currency or option substitution', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  for (const [reviewed, expected] of [[option({ pricing: { totalPrice: 125, currency: 'INR' } }), 200], [option({ pricing: { totalPrice: 100, currency: 'AED' } }), 409], [option({ optionId: 'other' }), 409]] as const) {
    const f = fixture();
    globalThis.fetch = async url => Response.json(String(url).endsWith('/pricing')
      ? { reviewHash: 'server-hash', options: [option()] }
      : { bookingId: 'mock-ref', option: reviewed });
    const response = await f.post('review', selection());
    assert.equal(response.status, expected);
    if (expected === 200) assert.equal((await response.json() as any).priceChanged, true);
    await Promise.all(f.jobs);
  }
});

test('supplier authentication errors do not expose provider messages or payloads to customers or logs', async t => {
  const f = fixture(); const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => Response.json({ status: { success: false }, errors: [{ errCode: '6518', message: 'fixture-api-secret guest@example.test ABCDE1234F' }] }, { status: 401 });
  const response = await f.post('review', selection());
  assert.equal(response.status, 502);
  const output = await response.text(); await Promise.all(f.jobs);
  assert.doesNotMatch(output + JSON.stringify(f.records) + JSON.stringify(f.files), /fixture-api-secret|guest@example|ABCDE1234F/);
});

test('exchange persistence removes credentials and personal data from success, failure and non-JSON paths', async () => {
  const f = fixture();
  const personal = { travellerInfo: [{ fN: 'Private Person', pan: 'ABCDE1234F', pNum: 'P1234567' }], deliveryInfo: { emails: ['private@example.test'], contacts: ['9999999999'] }, paymentInfos: [{ card: '4111111111111111' }] };
  for (const responseBody of [JSON.stringify({ ...personal, status: { success: true, httpStatus: 200 }, errors: [{ errCode: '1092', message: 'Private Person' }] }), '<html>Private Person api-secret</html>', null]) {
    await persistExchanges(f.env, f.db, 'tenant', [{
      supplier: 'TRIPJACK', endpoint: '/hms/v3/hotel/review', method: 'POST', url: 'https://user:pass@gateway.invalid/hms/v3/hotel/review?apikey=api-secret#private',
      requestHeaders: { apikey: 'api-secret', Authorization: 'Bearer bearer-secret', Cookie: 'session-secret', 'X-Poomas-Gateway-Key': 'proxy-secret', 'Content-Type': 'application/json' },
      requestBody: JSON.stringify(personal), status: 200, responseHeaders: { 'set-cookie': 'session-secret', 'content-type': 'application/json' }, responseBody,
      error: 'Private Person api-secret', startedAt: new Date().toISOString(), durationMs: 123,
    }], { requestId: 'request-123' });
  }
  const output = JSON.stringify([f.files, f.records]);
  assert.doesNotMatch(output, /api-secret|bearer-secret|session-secret|proxy-secret|Private Person|ABCDE1234F|P1234567|private@example|9999999999|4111111111111111|user:pass/);
  assert.match(output, /1092/); assert.match(output, /123/); assert.match(output, /application\/json/);
  assert.ok(f.files.every(x => JSON.parse(x[1])));
});

test('summary logs also redact error text, unknown codes and nested sensitive fields', async () => {
  const f = fixture();
  await logSupplierCall(f.db, { tenantId: 'tenant', supplier: 'TRIPJACK', endpoint: '/hms/v3/hotel/book', level: 'ERROR', errorCode: 'api-secret', errorMessage: 'private@example.test', responseSnippet: '{"message":"private@example.test"}', requestSummary: { rooms: 2, guests: 3, nested: { password: 'secret' }, contactEmail: 'private@example.test' } });
  assert.doesNotMatch(JSON.stringify(f.records), /api-secret|private@example|password/);
  assert.deepEqual(f.records[0].requestSummary, { rooms: 2, guests: 3 });
  assert.equal(supplierLogCode('1092'), '1092');
  assert.deepEqual(supplierLogBody('not-json with private data'), { redacted: true, format: 'non-json' });
});
