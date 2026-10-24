const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname,'../src/tripjack/hotel-v3.ts'),'utf8');
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleUrl='data:text/javascript;base64,'+Buffer.from(js).toString('base64');
test('documented hold, instant, confirm and cancellation payloads use the correct v3 endpoints',async t=>{
 const {TripjackHotelV3Client}=await import(moduleUrl);const old=global.fetch;t.after(()=>{global.fetch=old});const requests=[];
 global.fetch=async(url,init)=>{requests.push({url,init,body:init.body?JSON.parse(init.body):undefined});return Response.json({bookingId:'TJ-fixture',status:{success:true}})};
 const client=new TripjackHotelV3Client({baseUrl:'https://fixture.invalid',apiKey:'mock-key',proxyKey:'mock-gateway'});
 const request={bookingId:'TJ-fixture',roomTravellerInfo:[{travellerInfo:[{ti:'Mr',pt:'ADULT',fN:'Fixture',lN:'Adult'},{ti:'Master',pt:'CHILD',fN:'Fixture',lN:'Child'}]}],deliveryInfo:{emails:['fixture@example.test'],contacts:['5551234567'],code:['+971']}};
 await client.book(request);await client.book({...request,paymentInfos:[{amount:120}]});await client.confirmBook('TJ-fixture',120);await client.cancel('TJ-fixture');await client.nationalities();
 assert.equal(requests[0].body.type,'HOTEL');assert.equal(requests[0].body.paymentInfos,undefined);assert.equal(requests[1].body.paymentInfos[0].amount,120);
 assert.equal(requests[2].url,'https://fixture.invalid/oms/v3/hotel/confirm-book');assert.deepEqual(requests[2].body,{bookingId:'TJ-fixture',paymentInfos:[{amount:120}]});
 assert.equal(requests[3].url,'https://fixture.invalid/oms/v3/hotel/cancel-booking/TJ-fixture');assert.equal(requests[3].body,undefined);assert.equal(requests[3].init.method,'POST');
 assert.equal(requests[4].url,'https://fixture.invalid/tj-main/hms/v3/nationality-info');
 for(const r of requests){assert.equal(r.init.headers.apikey,'mock-key');assert.equal(r.init.headers['X-Poomas-Gateway-Key'],'mock-gateway');}
});
test('booking details expose actual pending, hold, cancellation-pending and cancelled supplier states',async t=>{
 const {TripjackHotelV3Client,parseHotelBookingDetails}=await import(moduleUrl);const old=global.fetch;t.after(()=>{global.fetch=old});const client=new TripjackHotelV3Client({baseUrl:'https://fixture.invalid',apiKey:'mock-key'});
 for(const status of ['IN_PROGRESS','PAYMENT_SUCCESS','PAYMENT_PENDING','ON_HOLD','SUCCESS','CANCELLATION_PENDING','CANCELLED','FAILED','ABORTED']){
  global.fetch=async(url,init)=>{assert.equal(url,'https://fixture.invalid/oms/v3/hotel/booking-details');assert.deepEqual(JSON.parse(init.body),{bookingId:'TJ-fixture'});return Response.json({order:{bookingId:'TJ-fixture',status},status:{success:true}})};
  assert.equal(parseHotelBookingDetails(await client.bookingDetails('TJ-fixture')).status,status);
 }
});
test('HTTP-200 supplier errors and invalid credentials are rejected without automatic Book retry',async t=>{
 const {TripjackHotelV3Client}=await import(moduleUrl);const old=global.fetch;t.after(()=>{global.fetch=old});const client=new TripjackHotelV3Client({baseUrl:'https://fixture.invalid',apiKey:'mock-key'});let calls=0;
 for(const [http,code] of [[200,'6506'],[200,'6510'],[200,'6515'],[401,'6518']]){
  global.fetch=async()=>{calls++;return Response.json({status:{success:false},error:{code,message:'Mock failure'}},{status:http})};
  await assert.rejects(()=>client.book({bookingId:'TJ-fixture',roomTravellerInfo:[],deliveryInfo:{emails:[],contacts:[],code:[]}}),err=>err.code===code);
 }assert.equal(calls,4);
});
