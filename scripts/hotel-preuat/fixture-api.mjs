// Local synthetic DTOs, not supplier-contract evidence. No fetch, DB, keys or SDK.
import http from 'node:http';
const quotes=new Map(),attempts=new Map(),submissions=new Map();
let scenario='success';
const allowed=new Set(['success','hold','unknown','changed','soldout','failure','disabled']);
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function option(rooms,changed=false){return {optionId:'fixture-rate',roomInfo:rooms.map((_,i)=>({name:`Fixture room ${i+1}`})),mealBasis:'Breakfast (fixture)',pricing:{totalPrice:changed?140:120,currency:'INR',basePrice:100,taxes:20},pricingFields:['basePrice','taxes'],cancellation:{isRefundable:true,penalties:[]},compliance:{panRequired:false,passportRequired:false}};}
const server=http.createServer(async(req,res)=>{
 if(req.headers.origin && req.headers.origin!=='http://127.0.0.1:3000')return json(res,403,{error:'Local preview origin only'});
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3000');res.setHeader('Vary','Origin');
 res.setHeader('Access-Control-Allow-Headers','content-type,authorization,x-tenant-slug');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 const url=new URL(req.url,'http://127.0.0.1:4001'),path=url.pathname;
 if(req.method==='GET'&&path==='/fixture/login'){
  // Synthetic cookie is valid only in this mock API. Never a production JWT.
  res.writeHead(302,{'Set-Cookie':'poomas_token=local-hotel-fixture; Path=/; SameSite=Lax','Location':'http://127.0.0.1:3000/hotels'});return res.end();
 }
 if(req.method==='GET'&&path==='/fixture/scenario'){
  const next=url.searchParams.get('value');if(!allowed.has(next))return json(res,400,{error:'Unknown scenario'});
  scenario=next;return json(res,200,{scenario,synthetic:true});
 }
 if(path.startsWith('/api/profile/')&&req.headers.authorization!=='Bearer local-hotel-fixture')return json(res,401,{error:'Fixture sign-in required'});
 let body={};try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw Error();}body=raw?JSON.parse(raw):{};}catch{return json(res,400,{error:'Invalid fixture input'});}
 if(path==='/api/profile/trips')return json(res,200,{trips:[]});
 if(path==='/api/hotels/search'){
  if(scenario==='failure')return json(res,503,{error:'Synthetic supplier unavailable'});
  const nights=Math.max(1,(Date.parse(body.checkOut)-Date.parse(body.checkIn))/86400000);
  return json(res,200,{hotels:scenario==='soldout'?[]:[{id:'fixture-hotel',hid:'fixture-hotel',hotelCode:'fixture-hotel',correlationId:'a'.repeat(32),name:'Local Fixture Hotel — NOT BOOKABLE',starRating:4,address:'Synthetic preview only',cityCode:body.cityCode,checkIn:body.checkIn,checkOut:body.checkOut,nights,rooms:body.rooms?.length??1,roomType:'Fixture room',mealPlan:'Breakfast',isRefundable:true,baseFare:100,taxes:20,totalFare:120,currency:'INR',images:[],amenities:['Fixture Wi-Fi']} ]});
 }
 if(path==='/api/hotels/detail')return scenario==='soldout'?json(res,409,{error:'Selected rooms are sold out (fixture).'}):json(res,200,{hotelName:'Local Fixture Hotel — NOT BOOKABLE',options:[option(body.rooms??[{adults:1,children:0}])]});
 if(path==='/api/profile/hotels/review'&&req.method==='POST'){
  const quoteId=`fixture-quote-${quotes.size+1}`,q={quoteId,hotelName:'Local Fixture Hotel',selection:body,option:option(body.rooms,scenario==='changed'),priceChanged:scenario==='changed',expiresAt:new Date(Date.now()+120000).toISOString(),bookingEnabled:scenario!=='disabled'};quotes.set(quoteId,q);return json(res,200,q);
 }
 if(path.startsWith('/api/profile/hotels/quotes/')){const q=quotes.get(decodeURIComponent(path.split('/').pop()));return json(res,q?200:404,q??{error:'Fixture quotation expired; search again'});}
 if(path==='/api/profile/hotels/book'&&req.method==='POST'){
  if(scenario==='disabled')return json(res,503,{error:'Fixture booking disabled'});
  if(submissions.has(body.idempotencyKey))return json(res,202,submissions.get(body.idempotencyKey));
  const q=quotes.get(body.quoteId);if(!q)return json(res,410,{error:'Fixture quotation expired'});
  const id=`fixture-attempt-${attempts.size+1}`,status=scenario==='hold'?'ON_HOLD':scenario==='unknown'?'UNKNOWN':'SUCCESS';
  const a={id,status,pending:status==='UNKNOWN',manualRecoveryRequired:status==='UNKNOWN',selection:q.selection,quotation:{hotelName:q.hotelName,option:q.option},details:status==='SUCCESS'?{confirmationNo:'SYNTHETIC-ONLY'}:{}};
  attempts.set(id,a);submissions.set(body.idempotencyKey,a);return json(res,202,a);
 }
 if(path==='/api/profile/hotels/bookings')return json(res,200,{bookings:[...attempts.values()]});
 if(path.startsWith('/api/profile/hotels/bookings/')){const a=attempts.get(decodeURIComponent(path.split('/').pop()));return json(res,a?200:404,a??{error:'Fixture booking not found'});}
 if(path.startsWith('/api/profile/hotels/submissions/')){const a=submissions.get(decodeURIComponent(path.split('/').pop()));return json(res,a?200:404,a??{error:'Fixture submission not found'});}
 return json(res,404,{error:'Not implemented in isolated fixture API'});
});
server.listen(4001,'127.0.0.1',()=>console.log('Synthetic API bound to 127.0.0.1:4001; no supplier or database connections.'));
