import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { bookings, bookingPassengers } from "@poomas/db/schema";
import type { Env, Variables } from "../types.js";

export const integrationRoutes=new Hono<{Bindings:Env;Variables:Variables}>();
async function duffelOrder(apiKey:string,orderId:string){try{const r=await fetch(`https://api.duffel.com/air/orders/${encodeURIComponent(orderId)}`,{headers:{Authorization:`Bearer ${apiKey}`,"Duffel-Version":"v2",Accept:"application/json"}});if(!r.ok)return null;const b=await r.json() as {data?:Record<string,unknown>};return b.data??null;}catch{return null;}}

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
