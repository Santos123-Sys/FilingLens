import type { Hono } from "hono";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { financialsSchema } from "../contracts/analysis";
import { prepareFinancialObservations } from "../contracts/history-ingestion";
import { buildAnnualHistory } from "../contracts/annual-history-adapter";
import { createHistoryStore } from "../db/history-store";

const COOKIE = "fl_history";
const MAX_AGE = 60 * 60 * 24 * 90;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const analyzedUpload = z.object({
  company:z.object({jurisdiction:z.enum(["us","br"]),registryId:z.string().min(6).max(64),legalName:z.string().min(1).max(255),ticker:z.string().max(32).nullable().optional()}),
  filing:z.object({filingKey:z.string().min(1).max(191),formType:z.string().min(1).max(64),periodEnd:date,filedAt:date,sourceUrl:z.string().url().nullable().optional()}),
  financials:financialsSchema.shape.financials,
  periods:z.array(z.object({label:z.string().min(1),endDate:date,fiscalYear:z.number().int().min(1900).max(2200),periodKind:z.enum(["FY","Q","YTD","LTM"]),fiscalQuarter:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]).optional()})).min(1).max(5),
  currency:z.string().min(3).max(8),unit:z.string().min(1).max(64),
});

function secret() {
 const s=process.env.HISTORY_COOKIE_SECRET ?? "";
 return s.length >= 32 && process.env.DATABASE_URL ? s : null;
}
function hmac(input:string,key:string):string {
 return createHmac("sha256",key).update(input).digest("hex");
}
function constantEqual(a:string,b:string):boolean {
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length && timingSafeEqual(x,y);
}
function sessionFromCookie(raw:string|undefined,key:string):string|null {
 const candidate=raw?.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
 if(!candidate) return null;
 const [nonce,timestamp,mac,...extra]=candidate.split(".");
 if(extra.length||!nonce||!timestamp||!mac||!/^[a-f0-9]{64}$/.test(nonce))return null;
 if(!/^\d{10,13}$/.test(timestamp)) return null;
 const age=Date.now()-Number(timestamp);
 if(!Number.isFinite(age)||age<0||age>MAX_AGE*1000) return null;
 if(!constantEqual(hmac(nonce+"."+timestamp,key),mac))return null;
 return nonce;
}
function scopedId(nonce:string,jurisdiction:"us"|"br",registryId:string,key:string) {
 return createHash("sha256").update(JSON.stringify(["browser-history-v1",nonce,jurisdiction,registryId.trim().toLowerCase(),key])).digest("hex");
}
function validOrigin(c:{req:{header:(key:string)=>string|undefined;url:string}}) {
 const origin=c.req.header("Origin");
 if(!origin)return false;
 try {
   const host=c.req.header("X-Forwarded-Host")??new URL(c.req.url).host;
   return new URL(origin).host===host && ["https:","http:"].includes(new URL(origin).protocol);
 }catch{return false;}
}
function responseNoStore(c:{header:(a:string,b:string)=>void}) {c.header("Cache-Control","no-store");c.header("Vary","Cookie");}
export function registerBrowserHistoryApi(app:Hono) {
 app.use("/api/history/*",async(c,next)=>{
   responseNoStore(c);
   if(!secret())return c.json({error:"history_unavailable"},503);
   if(c.req.method!=="GET"&&!validOrigin(c))return c.json({error:"origin_required"},403);
   await next();
 });
 app.get("/api/history/session",c=>c.json({enabled:Boolean(sessionFromCookie(c.req.header("Cookie"),secret()!))}));
 app.post("/api/history/session",c=>{
   const key=secret()!;
   const nonce=randomBytes(32).toString("hex");
   const timestamp=String(Date.now());
   const signature=hmac(nonce+"."+timestamp,key);
   const secure=process.env.NODE_ENV==="production" ? "; Secure" : "";
   c.header("Set-Cookie",COOKIE+"="+nonce+"."+timestamp+"."+signature+"; HttpOnly; SameSite=Strict; Path=/api/history; Max-Age="+MAX_AGE+secure);
   return c.json({enabled:true,privateWorkspace:true,expiresInDays:90});
 });
 app.post("/api/history/ingest",async c=>{
   const nonce=sessionFromCookie(c.req.header("Cookie"),secret()!);
   if(!nonce)return c.json({error:"private_session_required"},401);
   const raw=await c.req.text();
   if(raw.length>250000)return c.json({error:"payload_too_large"},413);
   const parsed=analyzedUpload.safeParse((()=>{try{return JSON.parse(raw)}catch{return null}})());
   if(!parsed.success)return c.json({error:"invalid_analysis_payload"},400);
   const {company,filing,financials,periods,currency,unit}=parsed.data;
   const mapped=prepareFinancialObservations({financials,periods,filingId:filing.filingKey,filedAt:filing.filedAt,currency,unit,sourceUrl:filing.sourceUrl??undefined});
   if(mapped.observations.length===0)return c.json({error:"no_source_backed_observations",issues:mapped.issues},422);
   const db=createHistoryStore(process.env.DATABASE_URL!);
   try {
     const scoped=await db.saveCompany({...company,registryId:scopedId(nonce,company.jurisdiction,company.registryId,secret()!)});
     const f=await db.saveFiling({...filing,companyId:scoped.id});
     await db.replaceObservations(f.id,mapped.observations);
     return c.json({stored:mapped.observations.length,skipped:mapped.issues.length,issues:mapped.issues.slice(0,25)});
   }catch(e){console.error("[browser-history] write",e instanceof Error?e.name:"unknown");return c.json({error:"history_unavailable"},503)}
   finally{await db.close()}
 });
 app.get("/api/history/company",async c=>{
   const nonce=sessionFromCookie(c.req.header("Cookie"),secret()!);
   if(!nonce)return c.json({error:"private_session_required"},401);
   const jurisdiction=c.req.query("jurisdiction");
   const registryId=c.req.query("registryId")??"";
   if(!["us","br"].includes(jurisdiction??"")||registryId.length<6||registryId.length>64)return c.json({error:"invalid_company"},400);
   const market=jurisdiction as "us"|"br";
   const store=createHistoryStore(process.env.DATABASE_URL!);
   try {
     const company=await store.findCompany(market,scopedId(nonce,market,registryId,secret()!));
     if(!company)return c.json({status:"empty",annualHistory:null,reconciliation:{points:[],flags:[]}});
     const result=await store.getHistory(company.id);
     return c.json({status:"available",annualHistory:buildAnnualHistory(result.points.flatMap(p=>p.candidates)).history,reconciliation:result});
   }catch(e){console.error("[browser-history] read",e instanceof Error?e.name:"unknown");return c.json({error:"history_unavailable"},503)}
   finally{await store.close()}
 });
 app.delete("/api/history/company",async c=>{
   const nonce=sessionFromCookie(c.req.header("Cookie"),secret()!);
   if(!nonce)return c.json({error:"private_session_required"},401);
   const jurisdiction=c.req.query("jurisdiction");
   const registryId=c.req.query("registryId")??"";
   if(!["us","br"].includes(jurisdiction??"")||registryId.length<6||registryId.length>64)return c.json({error:"invalid_company"},400);
   const market=jurisdiction as "us"|"br";
   const store=createHistoryStore(process.env.DATABASE_URL!);
   try {
     const company=await store.findCompany(market,scopedId(nonce,market,registryId,secret()!));
     if(company)await store.deleteCompanyHistory(company.id);
     return c.json({deleted:true});
   }catch(e){console.error("[browser-history] delete",e instanceof Error?e.name:"unknown");return c.json({error:"history_unavailable"},503)}
   finally{await store.close()}
 });
}
