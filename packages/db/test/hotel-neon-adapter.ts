// Real createDb/Drizzle/Neon HTTP calls; never a fetch/SQL mock. Dedicated DB only.
import { createDb } from '../src/client.js';
import { hotelQuotes, hotelAttempts } from '../src/schema/hotel.js';
import { sql, eq, and, isNull } from 'drizzle-orm';
import { spawn } from 'node:child_process';
async function main(){
const raw=process.env.HOTEL_TEST_NEON_URL;
if (!raw || process.env.HOTEL_TEST_NEON_APPROVED !== 'isolated-hotel-preuat') throw Error('BLOCKED: isolated Neon target approval required');
let url:URL;try{url=new URL(raw);}catch{throw Error('Invalid isolated target');}
if (url.protocol !== 'postgresql:' || url.hostname !== process.env.HOTEL_TEST_NEON_HOST || url.pathname !== '/hotel_preuat' || decodeURIComponent(url.username) !== 'hotel_preuat') throw Error('BLOCKED: isolated target identity mismatch');
const db=createDb(raw);
// No supplier fetches/imports. Only the explicitly approved Neon HTTPS host allowed.
const fetchOriginal=globalThis.fetch;
globalThis.fetch=(input:any,init:any)=>{
 const host=new URL(typeof input==='string'||input instanceof URL?input:input.url).hostname;
 if(host!==url.hostname)throw Error('Non-Neon network blocked');
 return fetchOriginal(input,init);
};
if(process.argv[2]==='claim'){
 const id=process.argv[3];
 const rows=await db.insert(hotelAttempts).values({id,tenantId:'fixture',userId:'fixture',quoteId:'q',idempotencyKey:'same-key',requestHash:'hash',providerBookingId:'provider-fixture',mode:'HOLD_UAT',state:'SUBMITTING'}).onConflictDoNothing().returning();
 console.log(JSON.stringify({claimed:rows.length}));
}else{
 // Provision migration separately on THIS disposable database. Never auto-migrate
 // a URL supplied through secrets; require an existing empty test schema.
 const before=await db.select().from(hotelAttempts).limit(1);
 const quotes=await db.select().from(hotelQuotes).limit(1);
 if(before.length||quotes.length)throw Error('BLOCKED: fixture database must be empty; never delete existing attempts');
 await db.insert(hotelQuotes).values({id:'q',tenantId:'fixture',userId:'fixture',selection:{},snapshot:{},providerBookingId:'provider-fixture',providerScope:'fixture',expiresAt:new Date(Date.now()+120000)});
 const worker=(id:string)=>new Promise<number>((resolve,reject)=>{
  const child=spawn(process.execPath,[...process.execArgv,process.argv[1],'claim',id],{env:process.env,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',d=>output+=d);child.stderr.on('data',()=>{});
  child.on('error',reject);child.on('exit',code=>{if(code)reject(Error('Adapter worker failed; inspect sanitized infrastructure logs'));else resolve(JSON.parse(output).claimed);});
 });
 const results=await Promise.all([worker('worker-a'),worker('worker-b')]);
 if(results.reduce((a,b)=>a+b,0)!==1)throw Error('Duplicate durable claim');
 const [a]=await db.select().from(hotelAttempts);if(!a)throw Error('Attempt missing');
 await db.update(hotelAttempts).set({checks:1}).where(and(eq(hotelAttempts.id,a.id),eq(hotelAttempts.checks,0)));
 await db.update(hotelAttempts).set({state:'CANCELLATION_PENDING',cancellationStartedAt:new Date()}).where(eq(hotelAttempts.id,a.id));
 const stale=await db.update(hotelAttempts).set({state:'SUCCESS'}).where(and(eq(hotelAttempts.id,a.id),eq(hotelAttempts.state,'SUBMITTING'),eq(hotelAttempts.checks,1),isNull(hotelAttempts.cancellationStartedAt))).returning();
 if(stale.length)throw Error('Stale update accepted');
 // New independent process after first workers exit: a retry cannot win the key.
 if(await worker('restart-worker')!==0)throw Error('Restart duplicated attempt');
 const [final]=await db.select().from(hotelAttempts);
 if(final.state!=='CANCELLATION_PENDING')throw Error('Recovery intent lost');
 const version:any=await db.execute(sql`select current_setting('server_version_num') as version`);
 if(Math.floor(Number(version.rows[0].version)/10000)!==16)throw Error('Expected PostgreSQL 16');
 console.log('PASS actual createDb/Neon HTTP adapter: independent-process claims, CAS and restart lookup. Synthetic records retained; disposable DB is now nonempty.');
}

}
main().catch(()=>{console.error('BLOCKED/FAIL: isolated Neon verification did not pass; check approved target, empty fixture schema and adapter prerequisites. No secret or raw provider error is logged.');process.exitCode=1;});
