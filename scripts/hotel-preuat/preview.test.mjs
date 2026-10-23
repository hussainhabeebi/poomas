import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const guard=fileURLToPath(new URL('./loopback-only.cjs',import.meta.url));
test('preview rejects outbound fetch, HTTP, TLS and raw TCP before connecting',()=>{
 for(const code of ["fetch('https://apitest-hms.tripjack.com')","require('node:http').get('http://example.com')","require('node:tls').connect({host:'example.com',port:443})","require('node:net').connect({host:'example.com',port:80})"]){
  const r=spawnSync(process.execPath,['--require',guard,'-e',code],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.notEqual(r.status,0);assert.match(r.stderr,/PREVIEW_EGRESS_BLOCKED/);
 }
});
test('fixture API requires synthetic auth, preserves room occupancy and never books upstream',{timeout:15000},async t=>{
 const child=spawn(process.execPath,['--require',guard,fileURLToPath(new URL('./fixture-api.mjs',import.meta.url))],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error(`Fixture exited ${code}`)));});
 const base='http://127.0.0.1:4001';
 const call=(path,body,auth=true)=>fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer local-hotel-fixture'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await call('/api/profile/hotels/bookings',null,false)).status,401);
 const rooms=[{adults:1,children:1,childAge:[6]},{adults:2,children:0,childAge:[]}];
 const q=await(await call('/api/profile/hotels/review',{rooms,optionId:'fixture-rate'})).json();assert.equal(q.option.roomInfo.length,2);
 const request={quoteId:q.quoteId,idempotencyKey:'fixture-key'},a=await(await call('/api/profile/hotels/book',request)).json(),b=await(await call('/api/profile/hotels/book',request)).json();assert.equal(a.id,b.id);
 assert.equal((await(await call('/api/profile/hotels/bookings')).json()).bookings.length,1);
 await call('/fixture/scenario?value=disabled');assert.equal((await call('/api/profile/hotels/book',request)).status,503);
});
