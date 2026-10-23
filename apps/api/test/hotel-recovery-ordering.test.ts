// Regression for persisted compare-and-set guards against delayed supplier snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverStoredHotelBooking } from '../src/routes/hotel-checkout.js';
import { hotelDatabaseFixture } from './helpers/hotel-db.js';
import { hotelRequestHash } from '../src/lib/hotel-booking-state.js';
test('stale in-flight status lookup cannot overwrite a newer cancellation intent', { timeout: 3000 }, async t => {
  const {db,tables}=hotelDatabaseFixture();
  const env:any={TRIPJACK_API_BASE_URL:'https://mock.invalid',TRIPJACK_API_KEY:'fixture-key',TENANT_CACHE_KV:{get:async()=>null}};
  const a:any={id:'attempt',tenantId:'tenant',userId:'owner',quoteId:'quote',state:'ON_HOLD',mode:'HOLD_UAT',providerBookingId:'TJ-fixture-12345',checks:0,nextCheckAt:new Date(0),createdAt:new Date()};
  tables.hotel_attempts.push(structuredClone(a));
  const q={id:'quote',tenantId:'tenant',providerScope:await hotelRequestHash([env.TRIPJACK_API_BASE_URL,env.TRIPJACK_API_KEY,'UAT'])};
  const c:any={env,get:(key:string)=>key==='db'?db:key==='tenantId'?'tenant':undefined,json:(body:any)=>body};
  let started!:()=>void,release!:()=>void;
  const seen=new Promise<void>(r=>started=r),wait=new Promise<void>(r=>release=r);
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  globalThis.fetch=async()=>{started();await wait;return Response.json({order:{bookingId:a.providerBookingId,status:'ON_HOLD'}})};
  const pending=recoverStoredHotelBooking(c,a,q);
  await seen;
  // Same durable transition made by storedHotelAction('cancel') after claiming.
  Object.assign(tables.hotel_attempts[0],{state:'CANCELLATION_PENDING',cancellationStartedAt:new Date(),nextCheckAt:new Date()});
  release();await pending;
  assert.equal(tables.hotel_attempts[0].state,'CANCELLATION_PENDING');
});

// All concurrency cases execute real route/service SQL builders with a labelled
// in-memory database fixture. They do NOT prove native PostgreSQL locking/restart.
import { storedHotelAction } from '../src/routes/hotel-checkout.js';
import { hotelRecoveryState } from '../src/lib/hotel-booking-state.js';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function recoveryFixture(t: any, state = 'ON_HOLD') {
  const {db,tables} = hotelDatabaseFixture();
  const env:any = { ENVIRONMENT: 'test', HOTEL_BOOKING_MODE: 'HOLD_UAT', TRIPJACK_API_BASE_URL: 'https://mock.invalid', TRIPJACK_API_KEY: 'fixture-key', TENANT_CACHE_KV: { get: async () => null } };
  const a:any = { id: 'attempt', tenantId: 'tenant', userId: 'owner', quoteId: 'quote', state, mode: 'HOLD_UAT', providerBookingId: 'TJ-fixture-12345', checks: 0,
    confirmationStartedAt: null, cancellationStartedAt: null, outcome: { status: state, confirmationNo: 'existing-confirmation' }, nextCheckAt: new Date(0), createdAt: new Date() };
  const q:any = { id: 'quote', tenantId: 'tenant', providerScope: await hotelRequestHash([env.TRIPJACK_API_BASE_URL,env.TRIPJACK_API_KEY,'UAT']), snapshot: { option: { pricing: { totalPrice: 120, currency: 'INR' } } } };
  tables.hotel_attempts.push(structuredClone(a)); tables.hotel_quotes.push(q);
  const context = () => ({ env, get: (key:string) => key === 'db' ? db : key === 'tenantId' ? 'tenant' : key === 'userRole' ? 'SUPER_ADMIN' : undefined,
    json: (body:any, status = 200) => ({body,status}) } as any);
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  return { db,tables,a,q,context,row: () => tables.hotel_attempts[0] };
}
function supplierStatus(status: string, confirmationNo = 'new-confirmation') {
  return Response.json({ order: { bookingId: 'TJ-fixture-12345', status, amount: 120 }, itemInfos: { HOTEL: { hInfo: { ops: [{ sc: 'INR' }] } } }, hotelConfirmationNumber: confirmationNo });
}
for (const action of ['cancel','confirm'] as const) {
  test(`delayed lookup cannot overwrite actual concurrent ${action} intent or its polling schedule`, { timeout: 3000 }, async t => {
    const f = await recoveryFixture(t), started = deferred(), release = deferred();
    let lookups = 0, actions = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith('/booking-details')) {
        lookups++;
        if (lookups === 1) { started.resolve(); await release.promise; }
        return supplierStatus('ON_HOLD');
      }
      assert.ok(String(url).includes(action === 'cancel' ? '/cancel-booking/' : '/confirm-book'));
      actions++; return Response.json({ status: { success: true } });
    };
    const pending = recoverStoredHotelBooking(f.context(), f.a, f.q);
    await started.promise;
    const result = await storedHotelAction(f.context(), action, f.a.providerBookingId);
    assert.equal(result.status,202);
    const schedule = f.row().nextCheckAt.getTime();
    release.resolve(); await pending;
    assert.equal(f.row().state, action === 'cancel' ? 'CANCELLATION_PENDING' : 'CONFIRM_PENDING');
    assert.equal(f.row().nextCheckAt.getTime(),schedule);
    assert.ok(f.row()[action === 'cancel' ? 'cancellationStartedAt' : 'confirmationStartedAt']);
    // A second action request reads its durable marker, without sending again.
    await storedHotelAction(f.context(), action, f.a.providerBookingId);
    assert.equal(actions,1);
  });
}
test('delayed lookup errors cannot postpone a newer cancellation intent', { timeout: 3000 }, async t => {
  const f = await recoveryFixture(t), started = deferred(), release = deferred();
  globalThis.fetch = async () => { started.resolve(); await release.promise; throw new Error('Fixture timeout'); };
  const pending = recoverStoredHotelBooking(f.context(),f.a,f.q);
  await started.promise;
  const nextCheckAt = new Date(Date.now() + 300_000);
  Object.assign(f.row(),{state:'CANCELLATION_PENDING',cancellationStartedAt:new Date(),nextCheckAt});
  release.resolve(); await pending;
  assert.equal(f.row().nextCheckAt.getTime(),nextCheckAt.getTime());
  assert.equal(f.row().state,'CANCELLATION_PENDING');
});
test('a stale snapshot cannot even claim a lookup after an admin intent changes the row', async t => {
  const f=await recoveryFixture(t); let calls=0;
  Object.assign(f.row(),{state:'CONFIRM_PENDING',confirmationStartedAt:new Date()});
  globalThis.fetch=async()=>{calls++;throw new Error('No supplier call expected');};
  await recoverStoredHotelBooking(f.context(),f.a,f.q);
  assert.equal(calls,0);assert.equal(f.row().checks,0);assert.equal(f.row().state,'CONFIRM_PENDING');
});
test('simultaneous polls claim one persisted lease and send one Booking Details request', { timeout: 3000 }, async t => {
  const f=await recoveryFixture(t),started=deferred(),release=deferred();let calls=0;
  globalThis.fetch=async()=>{calls++;started.resolve();await release.promise;return supplierStatus('SUCCESS');};
  const first=recoverStoredHotelBooking(f.context(),structuredClone(f.a),f.q);
  await started.promise;
  await recoverStoredHotelBooking(f.context(),structuredClone(f.a),f.q);
  assert.equal(calls,1);release.resolve();await first;
  assert.equal(f.row().state,'SUCCESS');assert.equal(f.row().checks,1);
});
for (const oldFails of [false,true]) {
  test(`recovered lease/new context keeps newer confirmation despite late ${oldFails ? 'error' : 'response'}`, { timeout:3000 }, async t => {
    const f=await recoveryFixture(t),started=deferred(),release=deferred();let calls=0;
    globalThis.fetch=async()=>{
      calls++;
      if(calls===1){started.resolve();await release.promise;if(oldFails)throw new Error('Lost old request');return supplierStatus('ON_HOLD','old-confirmation');}
      return supplierStatus('SUCCESS','new-confirmation');
    };
    const old=recoverStoredHotelBooking(f.context(),structuredClone(f.a),f.q);await started.promise;
    // Simulate a dead worker's expired durable lease. A fresh request context,
    // reading only database state, can recover it; no in-memory lock is reused.
    f.row().nextCheckAt=new Date(0);
    await recoverStoredHotelBooking(f.context(),structuredClone(f.row()),f.q);
    const schedule=f.row().nextCheckAt.getTime();release.resolve();await old;
    assert.equal(calls,2);assert.equal(f.row().checks,2);assert.equal(f.row().state,'SUCCESS');
    assert.equal(f.row().outcome.confirmationNo,'new-confirmation');assert.equal(f.row().nextCheckAt.getTime(),schedule);
  });
}
for (const [previous,incoming,expected] of [
  ['CANCELLATION_PENDING','SUCCESS','CANCELLATION_PENDING'],
  ['CANCELLATION_PENDING','ON_HOLD','CANCELLATION_PENDING'],
  ['CANCELLATION_PENDING','CANCELLED','CANCELLED'],
  ['CONFIRM_PENDING','ON_HOLD','CONFIRM_PENDING'],
  ['CONFIRM_PENDING','PENDING','CONFIRM_PENDING'],
  ['CONFIRM_PENDING','SUCCESS','SUCCESS'],
  ['SUCCESS','ON_HOLD','SUCCESS'],['SUCCESS','PENDING','SUCCESS'],
  ['SUCCESS','CANCELLATION_PENDING','CANCELLATION_PENDING'],
  ['CANCELLED','SUCCESS','CANCELLED'],
] as const) {
  test(`supplier order ${previous} → ${incoming} preserves ${expected}`, () => {
    assert.equal(hotelRecoveryState(previous,incoming),expected);
  });
}
test('a fresh request context (simulated restart) preserves cancellation intent despite supplier success', async t => {
  const f=await recoveryFixture(t,'CANCELLATION_PENDING');f.row().cancellationStartedAt=new Date();let calls=0;
  globalThis.fetch=async()=>{calls++;return supplierStatus('SUCCESS');};
  const snapshot=structuredClone(f.row());
  await recoverStoredHotelBooking(f.context(),snapshot,f.q);
  assert.equal(calls,1);assert.equal(f.row().state,'CANCELLATION_PENDING');
  assert.deepEqual(f.row().outcome,snapshot.outcome);assert.ok(f.row().cancellationStartedAt);
});
