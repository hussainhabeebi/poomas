"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Passenger={type:"ADULT"|"CHILD"|"INFANT";firstName:string;lastName:string;dob:string;gender:"M"|"F";nationality:string;passportNumber:string;passportExpiry:string};
type DuffelOffer={id:string;airlineName:string;flightNumber:string;origin:string;destination:string;departureTime:string;arrivalTime:string;totalFare:number;currency:string;baggage?:{checked?:string};raw?:{passengers?:{type?:string}[];passenger_identity_documents_required?:boolean}};
type TripjackFare={id:string;supplier:string;airlineName:string;flightNumber:string;origin:string;destination:string;departureTime:string;arrivalTime:string;totalFare:number;baseFare:number;taxes:number;currency:string;baggage?:{cabin?:string;checked?:string};isRefundable?:boolean};
const emptyPassenger=(type:Passenger["type"]="ADULT"):Passenger=>({type,firstName:"",lastName:"",dob:"",gender:"M",nationality:"IN",passportNumber:"",passportExpiry:""});

export default function BookPage(){
 const apiUrl=process.env.NEXT_PUBLIC_API_URL??"https://api.flypoomas.com";
 const [fareId,setFareId]=useState(""); const [supplier,setSupplier]=useState(""); const [duffelOffer,setDuffelOffer]=useState<DuffelOffer|null>(null); const [tripjackFare,setTripjackFare]=useState<TripjackFare|null>(null); const [tripjackBookingId,setTripjackBookingId]=useState(""); const [priceChanged,setPriceChanged]=useState<{from:number;to:number}|null>(null); const [expiresAt,setExpiresAt]=useState("");
 const [passengers,setPassengers]=useState<Passenger[]>([emptyPassenger()]); const [email,setEmail]=useState(""); const [phone,setPhone]=useState(""); const [loading,setLoading]=useState(true); const [submitting,setSubmitting]=useState(false); const [error,setError]=useState(""); const [confirmation,setConfirmation]=useState<any>(null);

 // Load checkout session (WhatsApp flow)
 useEffect(()=>{const q=new URLSearchParams(window.location.search);const directFare=q.get("fareId")??"";const directSupplier=q.get("supplier")??"";const session=q.get("session")??"";if(directFare||directSupplier){setFareId(directFare);setSupplier(directSupplier.toUpperCase())}if(!session)return;const c=new AbortController();setLoading(true);fetch(`${apiUrl}/api/integrations/checkout-sessions/${encodeURIComponent(session)}`,{headers:{"x-tenant-slug":"poomas"},signal:c.signal,cache:"no-store"}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error??"This secure booking link has expired.");return d}).then(data=>{setFareId(String(data.fareId??""));setSupplier(String(data.supplier??"").toUpperCase());if(Array.isArray(data.passengers)&&data.passengers.length)setPassengers(data.passengers.map((x:any)=>({...emptyPassenger(x.type==="CHILD"?"CHILD":x.type==="INFANT"?"INFANT":"ADULT"),firstName:String(x.firstName??""),lastName:String(x.lastName??""),dob:String(x.dob??""),gender:x.gender==="F"?"F":"M",nationality:String(x.nationality??"IN").toUpperCase().slice(0,2),passportNumber:String(x.passportNumber??""),passportExpiry:String(x.passportExpiry??"")})));setEmail(String(data.email??""));setPhone(String(data.mobile??""));history.replaceState(null,"",window.location.pathname+"?session="+encodeURIComponent(session))}).catch(e=>{if(e.name!=="AbortError"){setError(e.message);setLoading(false)}});return()=>c.abort()},[apiUrl]);

 // Load fare details based on supplier
 useEffect(()=>{
  if(!fareId||!supplier)return;

  if(supplier==="DUFFEL"){
   // Duffel: fetch from API to hold the fare
   const c=new AbortController();setLoading(true);
   fetch(`${apiUrl}/api/duffel-sandbox/offer/${encodeURIComponent(fareId)}`,{signal:c.signal,cache:"no-store"})
    .then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error??`Unable to load fare (${r.status})`);return d})
    .then(d=>{const o=d.offer as DuffelOffer;setDuffelOffer(o);setExpiresAt(d.expiresAt??"");const p=o.raw?.passengers??[];if(p.length)setPassengers(cur=>cur.some(x=>x.firstName||x.lastName||x.passportNumber)?cur:p.map(x=>emptyPassenger(x.type==="child"?"CHILD":x.type==="infant_without_seat"?"INFANT":"ADULT")))})
    .catch(e=>{if(e.name!=="AbortError")setError(e.message)}).finally(()=>setLoading(false));
   return()=>c.abort();
  }

  if(supplier==="TRIPJACK"){
   const c=new AbortController();setLoading(true);setError("");setTripjackBookingId("");setPriceChanged(null);
   let original:TripjackFare;
   try{
    const stored=sessionStorage.getItem(`fare:${fareId}`);
    if(!stored)throw new Error("Fare data not found. Please search again.");
    original=JSON.parse(stored) as TripjackFare;
   }catch(e:any){setError(e?.message??"Could not load fare data. Please try again.");setLoading(false);return;}

   fetch(`${apiUrl}/api/search/revalidate`,{method:"POST",headers:{"Content-Type":"application/json","x-tenant-slug":"poomas"},body:JSON.stringify({fareId,supplier:"TRIPJACK"}),signal:c.signal,cache:"no-store"})
    .then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error??"This fare is no longer available. Please search again.");return d})
    .then(d=>{
      const updated={...original,
        baseFare:Number.isFinite(Number(d.baseFare))?Number(d.baseFare):original.baseFare,
        taxes:Number.isFinite(Number(d.taxes))?Number(d.taxes):original.taxes,
        totalFare:Number.isFinite(Number(d.totalFare))?Number(d.totalFare):original.totalFare,
        currency:d.currency||original.currency};
      if(updated.totalFare!==original.totalFare)setPriceChanged({from:original.totalFare,to:updated.totalFare});
      setTripjackFare(updated);setTripjackBookingId(String(d.bookingId??""));
      sessionStorage.setItem(`fare:${fareId}`,JSON.stringify(updated));
    })
    .catch(e=>{if(e.name!=="AbortError")setError(e.message)})
    .finally(()=>setLoading(false));
   return()=>c.abort();
  }

  if(supplier==="RIYA"){
   try{
    const stored=sessionStorage.getItem(`fare:${fareId}`);
    if(stored)setTripjackFare(JSON.parse(stored) as TripjackFare);
    else setError("Fare data not found. Please go back and click Book Now again.");
   }catch{setError("Could not load fare data. Please try again.");}
   setLoading(false);
   return;
  }

  setError("Unsupported supplier: "+supplier);setLoading(false);
 },[fareId,supplier,apiUrl]);

 const offer=duffelOffer??tripjackFare;
 const money=useMemo(()=>{try{return new Intl.NumberFormat("en",{style:"currency",currency:offer?.currency??"INR",maximumFractionDigits:0})}catch{return new Intl.NumberFormat("en")}},[offer?.currency]);
 const upd=(i:number,k:keyof Passenger,v:string)=>setPassengers(p=>p.map((x,n)=>n===i?{...x,[k]:v}:x));

 async function submit(e:FormEvent){
  e.preventDefault();if(!offer||submitting)return;setError("");setSubmitting(true);
  try{
   if(supplier==="DUFFEL"){
    // Duffel sandbox booking
    const o=duffelOffer!;
    if(o.raw?.passenger_identity_documents_required&&passengers.some(p=>!p.passportNumber||!p.passportExpiry))throw new Error("Passport number and expiry are required for this fare.");
    const r=await fetch(`${apiUrl}/api/duffel-sandbox/book`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fareId,contactEmail:email.trim(),contactPhone:phone.trim(),passengers:passengers.map(p=>({...p,firstName:p.firstName.trim(),lastName:p.lastName.trim(),nationality:p.nationality.trim().toUpperCase(),passportNumber:p.passportNumber.trim()||undefined,passportExpiry:p.passportExpiry||undefined}))})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error??`Booking failed (${r.status})`);
    setConfirmation(d);window.scrollTo({top:0,behavior:"smooth"});
   }else{
    // TripJack / RIYA: submit to main bookings API
    const f=tripjackFare!;
    const r=await fetch(`${apiUrl}/api/bookings`,{method:"POST",headers:{"Content-Type":"application/json","x-tenant-slug":"poomas"},body:JSON.stringify({fareId,supplier,sessionId:supplier==="TRIPJACK"?tripjackBookingId:undefined,passengers:passengers.map(p=>({...p,firstName:p.firstName.trim(),lastName:p.lastName.trim(),nationality:p.nationality.trim().toUpperCase()||undefined,passportNumber:p.passportNumber.trim()||undefined,passportExpiry:p.passportExpiry||undefined,dob:p.dob||undefined,gender:p.gender||undefined})),contactEmail:email.trim(),contactPhone:phone.trim().replace(/\D/g,""),fareSnapshot:{origin:f.origin,destination:f.destination,departureTime:f.departureTime,baseFare:Number(f.baseFare??0),taxes:Number(f.taxes??0),totalFare:Number(f.totalFare??0),currency:f.currency,airlineName:f.airlineName,flightNumber:f.flightNumber}})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error??(d.message??`Booking failed (${r.status})`));
    setConfirmation(d);window.scrollTo({top:0,behavior:"smooth"});
   }
  }catch(x:any){setError(x?.message??"Booking failed");window.scrollTo({top:0,behavior:"smooth"})}
  finally{setSubmitting(false)}
 }

 const t=(s?:string)=>s?new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"--:--";

 if(loading)return <main className="ck"><style>{css}</style><div className="loading"><div className="spin"/><b>Checking latest fare</b><span>Confirming availability…</span></div></main>;
 if(confirmation)return <main className="ck success"><style>{css}</style><div className="ok">✓</div>{supplier==="DUFFEL"&&<small>DUFFEL SANDBOX</small>}<h1>Booking confirmed</h1>{supplier==="DUFFEL"&&<p>No real charge or airline ticket was issued.</p>}{supplier!=="DUFFEL"&&<p>Your booking has been submitted. You will receive a confirmation shortly.</p>}<div className="receipt"><Row l="Booking ID" v={confirmation.bookingId??"—"}/>{confirmation.pnr&&<Row l="PNR" v={confirmation.pnr}/>}{confirmation.bookingReference&&<Row l="Order ref" v={confirmation.bookingReference}/>}<Row l="Status" v={confirmation.status??"CONFIRMED"}/></div><a className="home" href="/">Search another flight</a></main>;

 return <main className="ck"><style>{css}</style>
  <header><button type="button" onClick={()=>history.back()}>‹</button><div><b>Secure checkout</b><span>{supplier==="DUFFEL"?"Duffel sandbox":supplier}</span></div><i>🔒</i></header>
  <div className="steps"><b>1</b><em/><b>2</b><em className="off"/><b className="off">3</b></div>
  <div className="stepLabels"><span>Flight</span><span>Travellers</span><span>Confirm</span></div>
  {error&&<div className="err"><b>Couldn't continue</b><span>{error}</span></div>}
  {offer&&<section className="card flight">
   <div className="fh"><div><b>{offer.airlineName}</b><span>{offer.flightNumber}</span></div><strong>{money.format(offer.totalFare)}</strong></div>
   <div className="route"><div><b>{t(offer.departureTime)}</b><span>{offer.origin}</span></div><div className="plane">✈</div><div className="end"><b>{t(offer.arrivalTime)}</b><span>{offer.destination}</span></div></div>
   <div className="meta"><span>{(offer as any).baggage?.checked||(offer as DuffelOffer).baggage?.checked||"Baggage per fare"}</span><span>{offer.currency}</span></div>
   {expiresAt&&<small>Offer expires {new Date(expiresAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</small>}
  </section>}
  {priceChanged&&<div className="note">⚠️ <div><b>Fare updated after airline check</b><p>{money.format(priceChanged.from)} → {money.format(priceChanged.to)}. The latest amount is shown below.</p></div></div>}
  <form onSubmit={submit}>
   <section className="card">
    <div className="title"><span>👤</span><div><h2>Traveller details</h2><p>Enter details exactly as on the travel document.</p></div></div>
    {passengers.map((p,i)=><div className="pax" key={i}><div className="chip">Passenger {i+1} · {p.type}</div><div className="grid"><Input l="First name" v={p.firstName} c={v=>upd(i,"firstName",v)} r/><Input l="Last name" v={p.lastName} c={v=>upd(i,"lastName",v)} r/><Input l="Date of birth" t="date" v={p.dob} c={v=>upd(i,"dob",v)} r/><label>Gender<select value={p.gender} onChange={e=>upd(i,"gender",e.target.value as "M"|"F")}><option value="M">Male</option><option value="F">Female</option></select></label><Input l="Nationality (2-letter)" v={p.nationality} c={v=>upd(i,"nationality",v.toUpperCase().slice(0,2))} r max={2}/><Input l="Passport number" v={p.passportNumber} c={v=>upd(i,"passportNumber",v)}/><Input l="Passport expiry" t="date" v={p.passportExpiry} c={v=>upd(i,"passportExpiry",v)}/></div></div>)}
   </section>
   <section className="card">
    <div className="title"><span>☎</span><div><h2>Contact details</h2><p>We'll send the confirmation here.</p></div></div>
    <div className="grid"><Input l="Email address" t="email" v={email} c={setEmail} r/><Input l="Mobile number" t="tel" v={phone} c={setPhone} r ph="+91 / +971…"/></div>
   </section>
   {supplier==="DUFFEL"&&<div className="note">🧪 <div><b>Sandbox mode</b><p>Test order only. No real money will be charged.</p></div></div>}
   <div className="spacer"/>
   <div className="pay">
    <div><span>Total</span><b>{offer?money.format(offer.totalFare):"—"}</b></div>
    <button disabled={!offer||submitting||(supplier==="TRIPJACK"&&!tripjackBookingId)}>{submitting?"Booking…":"Confirm booking"}</button>
   </div>
  </form>
 </main>;
}
function Input({l,v,c,t="text",r=false,ph,max}:{l:string;v:string;c:(v:string)=>void;t?:string;r?:boolean;ph?:string;max?:number}){return <label>{l}<input type={t} value={v} onChange={e=>c(e.target.value)} required={r} placeholder={ph} maxLength={max}/></label>}
function Row({l,v}:{l:string;v:string}){return <div className="row"><span>{l}</span><b>{v}</b></div>}
const css=`body{background:#f5f7fb}.ck{max-width:760px;margin:auto;min-height:100vh;padding:0 14px 32px;color:#101828}.ck header{position:sticky;top:0;z-index:30;margin:0 -14px;padding:12px 14px;background:#fff;display:flex;gap:12px;align-items:center;border-bottom:1px solid #eaecf0}.ck header button{width:44px;height:44px;border:0;border-radius:14px;background:#f2f4f7;font-size:31px}.ck header div{display:flex;flex-direction:column}.ck header div span{font-size:11px;color:#667085}.ck header i{margin-left:auto;font-style:normal}.steps{display:flex;align-items:center;padding:18px 24px 4px}.steps b{width:28px;height:28px;border-radius:50%;background:#ed1c24;color:#fff;display:grid;place-items:center;font-size:12px}.steps b.off{background:#e4e7ec;color:#667085}.steps em{height:3px;flex:1;background:#ed1c24}.steps em.off{background:#e4e7ec}.stepLabels{display:flex;justify-content:space-between;padding:0 10px 16px;color:#667085;font-size:11px;font-weight:700}.err{display:flex;flex-direction:column;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;padding:13px;border-radius:14px;margin-bottom:14px}.card{background:white;border:1px solid #eaecf0;border-radius:18px;padding:16px;margin-bottom:14px}.fh{display:flex;justify-content:space-between}.fh>div{display:flex;flex-direction:column}.fh span,.route span,.meta,.flight small{font-size:12px;color:#667085}.fh strong{font-size:20px;color:#ed1c24}.route{display:grid;grid-template-columns:1fr 1.2fr 1fr;align-items:center;margin:20px 0 12px}.route>div{display:flex;flex-direction:column}.route .end{text-align:right;align-items:flex-end}.plane{text-align:center;border-bottom:1px solid #d0d5dd;height:10px;color:#ed1c24}.meta{display:flex;justify-content:space-between;border-top:1px dashed #eaecf0;padding-top:10px}.title{display:flex;gap:10px}.title h2{font-size:17px;margin:0}.title p{font-size:12px;color:#667085;margin:3px 0 14px}.pax+.pax{border-top:1px solid #f2f4f7;margin-top:16px;padding-top:16px}.chip{display:inline-block;background:#fff1f2;color:#be123c;padding:6px 10px;border-radius:99px;font-size:11px;font-weight:800;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr;gap:12px}.grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#344054}.grid input,.grid select{height:50px;border:1px solid #d0d5dd;border-radius:12px;padding:0 13px;background:#fff;font-size:16px}.grid input:focus,.grid select:focus{outline:none;border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.08)}.note{display:flex;gap:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:13px;font-size:12px}.note p{margin:2px 0 0;color:#667085}.spacer{height:96px}.pay{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#fff;border-top:1px solid #eaecf0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;gap:12px;align-items:center}.pay>div{display:flex;flex-direction:column;min-width:110px}.pay span{font-size:11px;color:#667085}.pay button{flex:1;height:52px;border:0;border-radius:14px;background:#ed1c24;color:#fff;font-size:16px;font-weight:800}.pay button:disabled{opacity:.55}.loading{min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}.loading span{font-size:13px;color:#667085}.spin{width:30px;height:30px;border:3px solid #e5e7eb;border-top-color:#ed1c24;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}.success{text-align:center;padding-top:48px}.ok{width:72px;height:72px;border-radius:50%;background:#dcfce7;color:#15803d;display:grid;place-items:center;margin:auto;font-size:36px}.success>small{display:block;margin-top:12px;color:#15803d;font-weight:800}.success p{color:#667085}.receipt{background:#fff;border:1px solid #eaecf0;border-radius:16px;margin:22px 0;text-align:left}.row{display:flex;justify-content:space-between;padding:14px;border-bottom:1px solid #f2f4f7}.row:last-child{border-bottom:0}.home{display:block;background:#111827;color:#fff;text-decoration:none;padding:14px;border-radius:14px;font-weight:800}.ck button,.home{touch-action:manipulation;-webkit-tap-highlight-color:transparent}@media(min-width:640px){.grid{grid-template-columns:repeat(2,1fr)}.pay{left:50%;transform:translateX(-50%);max-width:760px;border-radius:18px 18px 0 0}}`;
