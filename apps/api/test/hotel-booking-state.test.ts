import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { hotelCheckoutRoutes } from '../src/routes/hotel-checkout.js';
import { hotelsAdminRoutes } from '../src/routes/admin/hotels.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { hotelRoutes } from '../src/routes/hotel.js';
import { hotelDatabaseFixture } from './helpers/hotel-db.js';
import { hotelRateEqual, hotelRecoveryState, validateHotelGuests, hotelRequestHash } from '../src/lib/hotel-booking-state.js';
import { parseHotelRooms, hotelGuestSlots } from '../../web/app/hotels/lib/occupancy.js';
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0,10);
const selection = { hid: '100123', correlationId: 'a'.repeat(32), optionId: 'rate', checkIn: day(20), checkOut: day(22), rooms: [{ adults: 1, children: 1, childAge: [5] }], currency: 'INR', nationality: 'IN' };
const option = { optionId: 'rate', roomInfo: [{ id: 'room', name: 'Suite', adults: 1, children: 1 }], mealBasis: 'Breakfast', pricing: { totalPrice: 120, basePrice: 100, taxes: 10, mf: 8, mft: 2, currency: 'INR' }, compliance: {}, cancellation: { isRefundable: true, penalties: [] } };
const guest = { title: 'Mr', firstName: 'Fixture', lastName: 'Adult', type: 'ADULT' };
const guests = [{ guests: [guest, { ...guest, title: 'Miss', type: 'CHILD', firstName: 'Child' }] }];
async function fixture(control: { bookWait?: Promise<void>; bookStarted?: () => void } = {}) {
  const { db, tables } = hotelDatabaseFixture(); const jobs: Promise<any>[] = [];
  const env: any = { ENVIRONMENT: 'test', JWT_SECRET: 'fixture-signing-key-not-a-real-secret', HOTEL_BOOKING_MODE: 'HOLD_UAT', TRIPJACK_API_BASE_URL: 'https://mock.invalid', TRIPJACK_API_KEY: 'fixture-key',
    TENANT_CACHE_KV: { get: async () => null }, SESSIONS_KV: { get: async () => ({ sessionId: 'fixture-session', tenantId: 'tenant' }) }, FARE_CACHE_KV: { get: async () => ({ IN: '106' }), put: async () => {} }, DOCUMENTS_R2: { put: async () => {} } };
  const token = async (user = 'owner', tenant = 'tenant', extra: any = {}) => new SignJWT({ userId: user, tenantId: tenant, role: 'CUSTOMER', scope: 'customer-profile', sessionId: 'fixture-session', ...extra }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const jwt = await token(); const app = new Hono<any>();
  app.use('*', async (c,next) => { c.set('tenantId','tenant'); c.set('db',db); await next(); });
  app.use('/api/admin/*',authMiddleware); app.route('/api/admin/hotels',hotelsAdminRoutes);
  app.route('/api/profile/hotels', hotelCheckoutRoutes); app.route('/api/hotels', hotelRoutes);
  const request = (path: string, body?: any, auth = jwt) => app.fetch(new Request(`https://fixture.invalid${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil: p => { jobs.push(p); }, passThroughOnException() {} });
  let bookCalls = 0, detailsCalls = 0, confirmCalls = 0, cancelCalls = 0; const bookBodies: any[] = [];
  let bookError = false, actionTimeout = false, changed = false, status = 'SUCCESS';
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.endsWith('/pricing')) return Response.json({ reviewHash: 'server-hash', options: [{ ...option, pricing: { ...option.pricing, totalPrice: changed ? 130 : 120 } }] });
    if (path.endsWith('/review')) return Response.json({ bookingId: 'TJ-fixture-12345', option, onholdAllowed: 'true', hotelName: 'Fixture hotel' });
    if (path.endsWith('/book')) { bookCalls++; bookBodies.push(JSON.parse(init?.body as string)); control.bookStarted?.(); if (control.bookWait) await control.bookWait; if (bookError) throw new Error('Timeout after send'); return Response.json({ bookingId: 'TJ-fixture-12345', status: { success: true } }); }
    if (path.endsWith('/confirm-book')) { confirmCalls++; if (actionTimeout) throw new Error('Ambiguous confirmation'); bookBodies.push(JSON.parse(init?.body as string)); status='SUCCESS'; return Response.json({status:{success:true}}); }
    if (path.includes('/cancel-booking/')) { cancelCalls++; status='CANCELLED'; return Response.json({status:{success:true}}); }
    if (path.endsWith('/booking-details')) { detailsCalls++; if (status === 'NOT_FOUND') return Response.json({ status: { success: false }, errors: [{ errCode: '6511' }] }, { status: 400 }); return Response.json({ order: { bookingId: 'TJ-fixture-12345', status, amount: 120 }, itemInfos: { HOTEL: { hInfo: { ops: [{ sc: 'INR' }] } } }, hotelConfirmationNumber: 'fixture-confirmation' }); }
    throw new Error('Unexpected mocked provider path');
  };
  const review = async () => { const res = await request('/api/profile/hotels/review', selection); assert.equal(res.status,200); return res.json() as Promise<any>; };
  const payload = (q: any, patch: any = {}) => ({ quoteId: q.quoteId, acceptedQuote: true, idempotencyKey: crypto.randomUUID(), rooms: guests, contactEmail: 'fixture@example.test', contactPhone: '5551234567', dialCode: '+971', ...patch });
  return { request, token, tables, env, review, payload, jobs, bookBodies, counts: () => ({ bookCalls, detailsCalls, confirmCalls, cancelCalls }), change: (v: boolean) => { changed=v; }, timeout: () => { bookError=true; }, actionTimeout: () => { actionTimeout=true; }, status: (s: string) => { status=s; }, restore: () => { globalThis.fetch=previous; } };
}
test('owner-bound review persists supplier quote, blocks unauthenticated and cross-tenant access', async t => {
  const f = await fixture(); t.after(f.restore); const q = await f.review();
  assert.equal(f.tables.hotel_quotes.length,1); assert.equal(q.option.pricing.totalPrice,120);
  for (const auth of ['', await f.token('other'), await f.token('owner','other')]) {
    const res = await f.request(`/api/profile/hotels/quotes/${q.quoteId}`,undefined,auth); assert.ok([401,403,404].includes(res.status));
  }
  assert.equal((await f.request('/api/hotels/bookings/TJ-fixture-12345',undefined,'')).status,401);
  assert.equal((await f.request('/api/profile/hotels/review',selection,'')).status,401);
});
test('booking is disabled by default and on production, with no supplier submission', async t => {
  const f = await fixture(); t.after(f.restore); const q = await f.review();
  delete f.env.HOTEL_BOOKING_MODE;
  assert.equal((await f.request('/api/profile/hotels/book',f.payload(q))).status,503);
  f.env.HOTEL_BOOKING_MODE='INSTANT_UAT'; f.env.ENVIRONMENT='production';
  assert.equal((await f.request('/api/profile/hotels/book',f.payload(q))).status,503);
  assert.equal(f.counts().bookCalls,0);
});
test('server quote amount and Review bookingId override browser amount; concurrent retries submit once', async t => {
  const f = await fixture(); t.after(f.restore); f.env.HOTEL_BOOKING_MODE='INSTANT_UAT'; const q = await f.review();
  const p = f.payload(q,{amount:0.01,bookingId:'attacker-reference'});
  const responses = await Promise.all([f.request('/api/profile/hotels/book',p),f.request('/api/profile/hotels/book',p)]);
  assert.ok(responses.every(r => r.status===202), JSON.stringify(await Promise.all(responses.map(r=>r.clone().json())))); assert.equal(f.counts().bookCalls,1);
  assert.equal(f.bookBodies[0].bookingId,'TJ-fixture-12345'); assert.equal(f.bookBodies[0].paymentInfos[0].amount,120);
  assert.equal(f.tables.hotel_attempts.length,1);
  assert.equal((await f.request('/api/profile/hotels/book',{...p,contactPhone:'5559999999'})).status,409);
  const other = f.payload(q); assert.equal((await f.request('/api/profile/hotels/book',other)).status,409);
});
test('expired, changed, sold-out and mismatched occupancy quotes cannot book', async t => {
  const f = await fixture(); t.after(f.restore); const q = await f.review(); const p=f.payload(q);
  f.tables.hotel_quotes[0].expiresAt=new Date(0); assert.equal((await f.request('/api/profile/hotels/book',p)).status,410);
  f.tables.hotel_quotes[0].expiresAt=new Date(Date.now()+60000); f.change(true);
  const res=await f.request('/api/profile/hotels/book',p); assert.equal(res.status,409); assert.equal((await res.json() as any).errorCode,'PRICE_CHANGED');
  assert.equal((await f.request('/api/profile/hotels/book',{...p,rooms:[{guests:[guest]}]})).status,400);
  assert.equal(f.counts().bookCalls,0);
});
test('timeout persists unknown outcome; restart-style lookup reconciles without resubmission', async t => {
  const f=await fixture(); t.after(f.restore); const q=await f.review(); const p=f.payload(q); f.timeout();
  const a:any=await (await f.request('/api/profile/hotels/book',p)).json(); assert.equal(a.status,'UNKNOWN');
  const recovery:any=await (await f.request(`/api/profile/hotels/submissions/${p.idempotencyKey}`)).json(); assert.equal(recovery.id,a.id);
  const confirmed:any=await (await f.request(`/api/profile/hotels/bookings/${a.id}`)).json(); assert.equal(confirmed.status,'SUCCESS');
  assert.equal(f.counts().bookCalls,1);
  assert.equal((await f.request(`/api/profile/hotels/bookings/${a.id}`,undefined,await f.token('other'))).status,404);
  await f.request('/api/profile/hotels/book',p); assert.equal(f.counts().bookCalls,1);
});
test('not-found after timeout remains unresolved, cooldown and retry bound survive requests', async t => {
  const f=await fixture(); t.after(f.restore); const q=await f.review(); f.timeout(); f.status('NOT_FOUND');
  const a:any=await (await f.request('/api/profile/hotels/book',f.payload(q))).json();
  await f.request(`/api/profile/hotels/bookings/${a.id}`); await f.request(`/api/profile/hotels/bookings/${a.id}`);
  assert.equal(f.counts().detailsCalls,1); assert.equal(f.tables.hotel_attempts[0].state,'UNKNOWN');
  f.tables.hotel_attempts[0].checks=36; f.tables.hotel_attempts[0].nextCheckAt=new Date(0);
  const result:any=await (await f.request(`/api/profile/hotels/bookings/${a.id}`)).json(); assert.equal(result.manualRecoveryRequired,true); assert.equal(f.counts().detailsCalls,1);
});
test('individual room occupancy preserves child ages and builds the exact guest slots', () => {
  const rooms=parseHotelRooms(JSON.stringify([{adults:2,children:2,childAge:[0,17]},{adults:3,children:1,childAge:[8]}]));
  assert.deepEqual(hotelGuestSlots(rooms),[['ADULT','ADULT','CHILD','CHILD'],['ADULT','ADULT','ADULT','CHILD']]);
  for (const raw of ['[]','null','[{"adults":7,"children":0}]','[{"adults":1,"children":1,"childAge":[]}]']) assert.throws(()=>parseHotelRooms(raw));
});
test('rate identity, chronology and compliance do not silently substitute supplier terms', async () => {
  assert.equal(hotelRateEqual(option,{...option,mealBasis:'Room Only'}),false);
  assert.equal(hotelRecoveryState('CANCELLED','SUCCESS'),'CANCELLED');
  assert.equal(hotelRecoveryState('ON_HOLD','CANCELLED'),'CANCELLED');
  assert.equal(hotelRecoveryState('UNKNOWN','PENDING'),'UNKNOWN');
  assert.match(validateHotelGuests(selection,{compliance:{panRequired:true}},guests)!,/PAN/);
  assert.notEqual(await hotelRequestHash({amount:1}),await hotelRequestHash({amount:2}));
});

test('a refreshed quote sharing the provider reference cannot produce a second booking', async t => {
  const f=await fixture();t.after(f.restore);const q1=await f.review(), q2=await f.review();
  assert.notEqual(q1.quoteId,q2.quoteId);assert.equal(f.tables.hotel_quotes.length,2);
  await f.request('/api/profile/hotels/book',f.payload(q1));
  assert.equal((await f.request('/api/profile/hotels/book',f.payload(q2))).status,409);
  assert.equal(f.counts().bookCalls,1);
});
test('held bookings remain unconfirmed and supplier auto-cancellation is recorded only after lookup', async t => {
  const f=await fixture();t.after(f.restore);f.status('ON_HOLD');const q=await f.review();
  const a:any=await (await f.request('/api/profile/hotels/book',f.payload(q))).json();
  const held:any=await (await f.request(`/api/profile/hotels/bookings/${a.id}`)).json();assert.equal(held.status,'ON_HOLD');
  assert.equal(f.bookBodies[0].paymentInfos,undefined);
  f.status('CANCELLED');f.tables.hotel_attempts[0].nextCheckAt=new Date(0);
  const cancelled:any=await (await f.request(`/api/profile/hotels/bookings/${a.id}`)).json();assert.equal(cancelled.status,'CANCELLED');
  f.status('SUCCESS');await f.request(`/api/profile/hotels/bookings/${a.id}`);assert.equal(f.counts().detailsCalls,2);
});
test('pending polling expires after 180 seconds and changed supplier configuration blocks recovery', async t => {
  const f=await fixture();t.after(f.restore);const q=await f.review();f.timeout();
  const a:any=await (await f.request('/api/profile/hotels/book',f.payload(q))).json();
  f.tables.hotel_attempts[0].createdAt=new Date(Date.now()-181000);
  const stopped:any=await (await f.request(`/api/profile/hotels/bookings/${a.id}`)).json();assert.equal(stopped.manualRecoveryRequired,true);assert.equal(f.counts().detailsCalls,0);
  f.env.TRIPJACK_API_BASE_URL='https://changed-fixture.invalid';assert.equal((await f.request(`/api/profile/hotels/bookings/${a.id}`)).status,409);assert.equal(f.counts().bookCalls,1);
});
test('unapproved GST and missing explicit quote acceptance cannot reach Book', async t => {
  const f=await fixture();t.after(f.restore);const q=await f.review();const p=f.payload(q);
  assert.equal((await f.request('/api/profile/hotels/book',{...p,acceptedQuote:false})).status,400);
  f.tables.hotel_quotes[0].snapshot.option.compliance.gstType='PASSTHROUGH';
  assert.equal((await f.request('/api/profile/hotels/book',p)).status,409);assert.equal(f.counts().bookCalls,0);
});
test('admin attempt recovery remains behind existing live-role and permission guards', async () => {
  const { adminRoutes }=await import('../src/routes/admin/index.js');
  for(const role of ['CUSTOMER','AGENT_ADMIN',undefined]){
    const app=new Hono<any>();app.use('*',async(c,next)=>{c.set('tenantId','tenant');c.set('userRole',role);await next();});app.route('/api/admin',adminRoutes);
    const response=await app.request('/api/admin/hotels/attempts/fixture/reconcile',{method:'POST'});assert.equal(response.status,403);
  }
});

test('My Trips hotel list is owner-scoped and contains the saved room and price snapshot', async t => {
  const f=await fixture();t.after(f.restore);const q=await f.review();await f.request('/api/profile/hotels/book',f.payload(q));
  f.tables.hotel_attempts.push({...f.tables.hotel_attempts[0],id:'other-owner-attempt',userId:'other'});
  const response=await f.request('/api/profile/hotels/bookings');assert.equal(response.status,200);const result:any=await response.json();
  assert.equal(result.bookings.length,1);assert.equal(result.bookings[0].quotation.option.pricing.totalPrice,120);assert.deepEqual(result.bookings[0].selection.rooms,[{adults:1,children:1,childAge:[5]}]);
});

test('authorized UAT hold confirmation uses verified amount and durable action markers; cancellation requires reconciliation', async t => {
  const f=await fixture();t.after(f.restore);const q=await f.review();f.status('ON_HOLD');
  const a:any=await (await f.request('/api/profile/hotels/book',f.payload(q))).json();await f.request(`/api/profile/hotels/bookings/${a.id}`);
  const admin=await f.token('admin','tenant',{role:'SUPER_ADMIN',scope:undefined});
  const path='/api/admin/hotels/bookings/TJ-fixture-12345';
  const results=await Promise.all([f.request(path+'/confirm',{amount:0.01},admin),f.request(path+'/confirm',{amount:999},admin)]);
  assert.ok(results.every(r=>[202,409].includes(r.status)));assert.equal(f.counts().confirmCalls,1);
  assert.equal(f.bookBodies.at(-1).paymentInfos[0].amount,120);assert.ok(f.tables.hotel_attempts[0].confirmationStartedAt);
  // Acknowledgement isn't verified confirmation; don't allow racing cancellation.
  assert.equal((await f.request(path+'/cancel',{},admin)).status,409);
  f.tables.hotel_attempts[0].nextCheckAt=new Date(0);await f.request(`/api/profile/hotels/bookings/${a.id}`);assert.equal(f.tables.hotel_attempts[0].state,'SUCCESS');
  assert.equal((await f.request(path+'/cancel',{},admin)).status,202);await f.request(path+'/cancel',{},admin);assert.equal(f.counts().cancelCalls,1);
  delete f.env.HOTEL_BOOKING_MODE;assert.equal((await f.request(path+'/confirm',{},admin)).status,503);
});

test('ambiguous admin confirmation remains durably reserved and cannot be replayed', async t => {
  const f=await fixture();t.after(f.restore);const q=await f.review();f.status('ON_HOLD');
  await f.request('/api/profile/hotels/book',f.payload(q));f.actionTimeout();const admin=await f.token('admin','tenant',{role:'SUPER_ADMIN',scope:undefined});
  const path='/api/admin/hotels/bookings/TJ-fixture-12345/confirm';
  const first=await f.request(path,{amount:1},admin);assert.equal(first.status,202);assert.equal((await first.json() as any).status,'CONFIRM_PENDING');
  assert.equal((await f.request(path,{amount:1},admin)).status,202);assert.equal(f.counts().confirmCalls,1);
  assert.ok(f.tables.hotel_attempts[0].confirmationStartedAt);
});

for (const failedResponse of [false,true]) {
  test(`late Book ${failedResponse ? 'error' : 'acknowledgement'} cannot overwrite already-reconciled confirmation`, {timeout:3000}, async t => {
    let release!:()=>void,started!:()=>void;
    const wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r);
    const f=await fixture({bookWait:wait,bookStarted:started});t.after(f.restore);
    const q=await f.review();if(failedResponse)f.timeout();
    const submitting=f.request('/api/profile/hotels/book',f.payload(q));await seen;
    const id=f.tables.hotel_attempts[0].id;
    await f.request(`/api/profile/hotels/bookings/${id}`);
    assert.equal(f.tables.hotel_attempts[0].state,'SUCCESS');
    release();const result:any=await (await submitting).json();
    assert.equal(result.status,'SUCCESS');assert.equal(f.tables.hotel_attempts[0].state,'SUCCESS');assert.equal(f.counts().bookCalls,1);
  });
}
