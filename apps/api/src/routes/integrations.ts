import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { bookings, bookingPassengers } from "@poomas/db/schema";
import type { Env, Variables } from "../types.js";

export const integrationRoutes=new Hono<{Bindings:Env;Variables:Variables}>();
async function duffelOrder(apiKey:string,orderId:string){try{const r=await fetch(`https://api.duffel.com/air/orders/${encodeURIComponent(orderId)}`,{headers:{Authorization:`Bearer ${apiKey}`,"Duffel-Version":"v2",Accept:"application/json"}});if(!r.ok)return null;const b=await r.json() as {data?:Record<string,unknown>};return b.data??null;}catch{return null;}}

const PREFILL_TTL_SECONDS=20*60;
function validIntegrationKey(c:any){
 const expected=c.env.POOMAS_INTEGRATION_KEY,supplied=c.req.header("X-POOMAS-INTEGRATION-KEY");
 return Boolean(expected&&supplied&&supplied===expected);
}
function cleanText(v:unknown,max=120){return String(v??"").trim().slice(0,max);}
function normalizePassenger(raw:any){
 const type=["ADULT","CHILD","INFANT"].includes(String(raw?.type).toUpperCase())?String(raw.type).toUpperCase():"ADULT";
 const gender=String(raw?.gender??"").toUpperCase();
 return {
  type,
  firstName:cleanText(raw?.firstName??raw?.first_name,80),
  lastName:cleanText(raw?.lastName??raw?.last_name,80),
  dob:cleanText(raw?.dob??raw?.dateOfBirth??raw?.date_of_birth,10),
  gender:gender==="F"||gender==="FEMALE"?"F":"M",
  nationality:cleanText(raw?.nationality,2).toUpperCase(),
  passportNumber:cleanText(raw?.passportNumber??raw?.passport_number,30),
  passportExpiry:cleanText(raw?.passportExpiry??raw?.passport_expiry,10),
 };
}

// Secure Leadvyne → Poomas booking-form handoff.
// PII is stored briefly in KV; the WhatsApp URL contains only a random opaque token.
integrationRoutes.post("/checkout-sessions",async(c)=>{
 if(!validIntegrationKey(c))return c.json({error:"Unauthorized integration"},401);
 const tenantId=c.get("tenantId");
 const body=await c.req.json().catch(()=>null) as any;
 if(!body)return c.json({error:"Invalid JSON body"},400);
 const fareId=cleanText(body.fareId??body.fare_id,500);
 const supplier=cleanText(body.supplier,30).toUpperCase();
 const passengers=Array.isArray(body.passengers)?body.passengers.map(normalizePassenger):[];
 const contact=body.contact??{};
 const email=cleanText(contact.email??body.contactEmail??body.email,254).toLowerCase();
 const mobile=cleanText(contact.mobile??contact.phone??body.contactPhone??body.mobile,30);
 if(!fareId||!supplier)return c.json({error:"fareId and supplier are required"},400);
 if(!passengers.length||passengers.some((p:any)=>!p.firstName||!p.lastName))return c.json({error:"Valid passenger names are required"},400);
 if(!email||!mobile)return c.json({error:"Contact email and mobile are required"},400);
 const token=crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"");
 const expiresAt=new Date(Date.now()+PREFILL_TTL_SECONDS*1000).toISOString();
 await c.env.SESSIONS_KV.put(`booking_prefill:${tenantId}:${token}`,JSON.stringify({
  fareId,supplier,passengers,email,mobile,source:cleanText(body.source||"leadvyne",30),
  clientId:cleanText(body.clientId??body.client_id,50),expiresAt
 }),{expirationTtl:PREFILL_TTL_SECONDS});
 return c.json({sessionId:token,checkoutUrl:`https://flypoomas.com/book?session=${encodeURIComponent(token)}`,expiresAt},201);
});

integrationRoutes.get("/checkout-sessions/:token",async(c)=>{
 const tenantId=c.get("tenantId"),token=cleanText(c.req.param("token"),160);
 if(!/^[a-f0-9]{64}$/.test(token))return c.json({error:"Invalid checkout session"},400);
 const data=await c.env.SESSIONS_KV.get(`booking_prefill:${tenantId}:${token}`,"json");
 if(!data)return c.json({error:"Checkout session expired or not found"},410);
 return c.json(data);
});

integrationRoutes.get("/pnr/:pnr",async(c)=>{
 const expected=c.env.POOMAS_INTEGRATION_KEY,supplied=c.req.header("X-POOMAS-INTEGRATION-KEY");
 if(!expected||!supplied||supplied!==expected)return c.json({error:"Unauthorized integration"},401);
 const pnr=c.req.param("pnr").trim().toUpperCase(),tenantId=c.get("tenantId"),db=c.get("db");
 const [booking]=await db.select().from(bookings).where(and(eq(bookings.tenantId,tenantId),eq(bookings.pnr,pnr))).limit(1);
 if(!booking){
   const cached=await c.env.SESSIONS_KV.get(`duffel_pnr:${pnr}`,"json") as any;
   if(!cached)return c.json({error:"PNR not found"},404);
   const supplierStatus=c.env.DUFFEL_API_KEY&&cached.bookingReference?await duffelOrder(c.env.DUFFEL_API_KEY,cached.bookingReference):null;
   return c.json({pnr:cached.pnr,status:String((supplierStatus as any)?.cancelled_at?"CANCELLED":cached.status||"CONFIRMED"),supplier:"DUFFEL",supplierBookingRef:cached.bookingReference,ticketNumbers:cached.ticketNumbers||[],origin:cached.offer?.origin,destination:cached.offer?.destination,departureDate:cached.offer?.departureTime,totalAmount:cached.offer?.totalFare,currency:cached.offer?.currency,passengers:cached.passengers||[],supplierStatus,sandbox:true,updatedAt:cached.createdAt});
 }
 const passengers=await db.select({passengerType:bookingPassengers.passengerType,firstName:bookingPassengers.firstName,lastName:bookingPassengers.lastName,ticketNumber:bookingPassengers.ticketNumber,seatNumber:bookingPassengers.seatNumber}).from(bookingPassengers).where(eq(bookingPassengers.bookingId,booking.id));
 const supplierStatus=booking.supplier==="DUFFEL"&&booking.supplierBookingRef&&c.env.DUFFEL_API_KEY?await duffelOrder(c.env.DUFFEL_API_KEY,booking.supplierBookingRef):null;
 return c.json({pnr:booking.pnr,bookingId:booking.id,status:booking.status,supplier:booking.supplier,supplierBookingRef:booking.supplierBookingRef,ticketNumbers:booking.ticketNumbers,origin:booking.origin,destination:booking.destination,departureDate:booking.departureDate,returnDate:booking.returnDate,totalAmount:booking.totalAmount,currency:booking.currency,passengers,supplierStatus,updatedAt:booking.updatedAt});
});
