import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';
const bundle = await build({
 stdin:{contents:`import {createRoot} from 'react-dom/client';import Page from './app/hotels/book/page';createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'tsx'},
 define:{'process.env.NEXT_PUBLIC_API_URL':'"https://fixture.invalid"'},bundle:true,write:false,outdir:'/virtual',jsx:'automatic',platform:'browser',
 plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function useSearchParams(){return new URLSearchParams(window.location.search)}',loader:'js'}));}}],
});
const script=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const settle=()=>new Promise(r=>setTimeout(r,45));
const option={optionId:'selected-rate',roomInfo:[{name:'Suite'},{name:'Twin'}],mealBasis:'Breakfast',pricing:{totalPrice:120,currency:'INR',basePrice:100,taxes:10,mf:8,mft:2},pricingFields:['basePrice','taxes','mf','mft'],cancellation:{isRefundable:true,penalties:[{from:'2026-11-01T12:00',to:'2026-11-05T12:00',amount:20}]},compliance:{panRequired:false,passportRequired:false}};
const rooms=[{adults:1,children:1,childAge:[6]},{adults:2,children:0,childAge:[]}];
const selection={hid:'100123',correlationId:'a'.repeat(32),checkIn:'2026-11-01',checkOut:'2026-11-05',rooms,nationality:'IN',currency:'INR'};
async function fixture(t,config={}) {
 const requests=[],errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const q=new URLSearchParams({hid:selection.hid,sid:selection.correlationId,checkIn:selection.checkIn,checkOut:selection.checkOut,occupancy:JSON.stringify(rooms),...(config.query||{})});
 const dom=new JSDOM('<div id="root"></div>',{url:`https://fixture.invalid/hotels/book?${q}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.document.cookie='poomas_token=fixture-account; Path=/';
  w.fetch=async(url,init={})=>{
   requests.push({url:String(url),body:init.body?JSON.parse(init.body):undefined});
   const review={quoteId:'fixture-quote',hotelName:'Fixture stay',option,expiresAt:'2099-01-01T00:00:00Z',selection,priceChanged:true,bookingEnabled:config.enabled??false};
   const path=String(url),data=path.endsWith('/detail')?{hotelName:'Fixture stay',options:[option]}:path.endsWith('/review')||path.includes('/quotes/')?review:path.endsWith('/book')?{id:'fixture-attempt',status:'ON_HOLD',pending:false}:path.includes('/submissions/')?{id:'saved-attempt',status:'SUCCESS',pending:false}:{};
   if(config.error&&path.endsWith('/detail'))return {ok:false,status:409,headers:{get:()=> 'application/json'},json:async()=>({error:'Selected rooms are sold out.'})};
   return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>data};
  };
 }});dom.window.eval(script);await settle();await settle();t.after(()=>{dom.window.close();assert.deepEqual(errors,[])});
 const doc=dom.window.document;
 const click=async text=>{const btn=[...doc.querySelectorAll('button')].find(b=>b.textContent.includes(text));assert.ok(btn,text);btn.click();await settle();await settle();return btn;};
 return {doc,window:dom.window,requests,click};
}
test('explicit rate selection preserves occupancy, requires acceptance and keeps booking disabled',async t=>{
 const f=await fixture(t);assert.match(f.doc.body.textContent,/Choose your rooms/);assert.deepEqual(f.requests[0].body.rooms,rooms);await f.click('Select and review');
 const r=f.requests.find(r=>r.url.endsWith('/review'));assert.equal(r.body.optionId,'selected-rate');assert.equal(r.body.amount,undefined);
 assert.equal(f.doc.querySelectorAll('input[autocomplete="given-name"]').length,4);assert.match(f.doc.body.textContent,/supplier price changed/);
 assert.equal(f.doc.querySelector('button[type="submit"]').disabled,true);assert.match(f.doc.body.textContent,/await approval/);assert.equal(f.requests.filter(r=>r.url.endsWith('/book')).length,0);
});
test('authorized fixture submits identifiers and exact guests once, never browser prices',async t=>{
 const f=await fixture(t,{enabled:true});await f.click('Select and review');f.doc.querySelector('input[type="checkbox"]').click();await settle();
 const form=f.doc.querySelector('form');form.dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
 const b=f.requests.filter(r=>r.url.endsWith('/book'));assert.equal(b.length,1);assert.equal(b[0].body.acceptedQuote,true);assert.equal(b[0].body.amount,undefined);assert.equal(b[0].body.bookingId,undefined);assert.equal(b[0].body.quoteId,'fixture-quote');
 assert.deepEqual(b[0].body.rooms.map(r=>r.guests.map(g=>g.type)),[['ADULT','CHILD'],['ADULT','ADULT']]);assert.match(f.doc.body.textContent,/On hold — not confirmed/);
});
test('refresh restores owner quote; unknown-submission recovery never reposts booking',async t=>{
 const f=await fixture(t,{query:{quote:'fixture-quote'}});assert.equal(f.requests.filter(r=>r.url.includes('/quotes/')).length,1);assert.equal(f.doc.querySelectorAll('input[autocomplete="given-name"]').length,4);
 const g=await fixture(t,{query:{submission:'saved-key'}});assert.match(g.doc.body.textContent,/Booking confirmed/);assert.equal(g.requests.filter(r=>r.url.endsWith('/book')).length,0);assert.match(g.window.location.search,/attempt=saved-attempt/);
});
test('sold-out errors preserve search navigation and expose no booking control',async t=>{
 const f=await fixture(t,{error:true});assert.match(f.doc.querySelector('[role="alert"]').textContent,/sold out/);assert.equal(f.doc.querySelector('a').getAttribute('href'),'/hotels');assert.equal(f.doc.querySelector('button[type="submit"]'),null);
});
