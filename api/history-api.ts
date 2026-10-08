import type { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createHistoryStore } from "../db/history-store";
import { buildAnnualHistory } from "../contracts/annual-history-adapter";
import { reconcileFinancialHistory } from "../contracts/financial-history";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const observation = z.object({
 metric:z.string().min(1).max(100),periodEnd:date,periodKind:z.enum(["FY","Q","YTD","LTM"]),
 fiscalYear:z.number().int().min(1900).max(2200),fiscalQuarter:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]).optional(),
 value:z.number().finite().nullable(),unit:z.string().min(1).max(64),currency:z.string().min(1).max(8),
 filingId:z.string().min(1).max(191),filedAt:date,sourceSection:z.string().min(1),
 sourceUrl:z.string().url().optional(),
});
const upload=z.object({
 company:z.object({jurisdiction:z.enum(["us","br"]),registryId:z.string().min(1).max(64),legalName:z.string().min(1).max(255),ticker:z.string().max(32).nullable().optional()}),
 filing:z.object({filingKey:z.string().min(1).max(191),formType:z.string().min(1).max(64),periodEnd:date,filedAt:date,sourceUrl:z.string().url().nullable().optional()}),
 observations:z.array(observation).min(1).max(200),
});
function authorized(header:string|undefined,token:string):boolean {
 const expected=Buffer.from(token);
 const received=Buffer.from(header?.startsWith("Bearer ")?header.slice(7):"");
 return expected.length>=32 && expected.length===received.length && timingSafeEqual(expected,received);
}
export function registerHistoryApi(app:Hono) {
 app.use("/api/internal/history/*",async(c,next)=>{
  const token=process.env.HISTORY_API_TOKEN;
  if(!token || !process.env.DATABASE_URL) return c.json({error:"history_disabled"},503);
  if(!authorized(c.req.header("Authorization"),token)) return c.json({error:"unauthorized"},401);
  c.header("Cache-Control","no-store");
  await next();
 });
 app.post("/api/internal/history/ingest",async c=>{
  const parsed=upload.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:"invalid_history_payload"},400);
  const {company,filing,observations}=parsed.data;
  if(observations.some(o=>o.filingId!==filing.filingKey || o.filedAt!==filing.filedAt)) return c.json({error:"filing_identity_mismatch"},400);
  const validation=reconcileFinancialHistory(observations);
  if(validation.flags.length || validation.points.length!==observations.length) return c.json({error:"invalid_or_conflicting_observations",flags:validation.flags},422);
  const store=createHistoryStore(process.env.DATABASE_URL!);
  try {
   const issuer=await store.saveCompany(company);
   const source=await store.saveFiling({...filing,companyId:issuer.id});
   await store.replaceObservations(source.id,observations);
   return c.json({companyId:issuer.id,filingId:source.id,count:observations.length});
  } catch(e) {console.error("[history] ingestion failed",e instanceof Error?e.name:"unknown");return c.json({error:"history_store_unavailable"},503);}
  finally {await store.close();}
 });
 app.get("/api/internal/history/company/:id",async c=>{
  const id=Number(c.req.param("id"));
  if(!Number.isSafeInteger(id)||id<1) return c.json({error:"invalid_company_id"},400);
  const store=createHistoryStore(process.env.DATABASE_URL!);
  try {
   const result=await store.getHistory(id);
   return c.json({companyId:id,reconciliation:result,annualHistory:buildAnnualHistory(result.points.flatMap(x=>x.candidates)).history});
  } catch(e) {console.error("[history] retrieval failed",e instanceof Error?e.name:"unknown");return c.json({error:"history_store_unavailable"},503);}
  finally {await store.close();}
 });
}
