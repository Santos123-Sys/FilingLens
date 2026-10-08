import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { companies, regulatorySnapshots } from "../db/schema";
import type { RegulatoryDataSnapshot, RegulatoryDataMetric } from "../contracts/regulatory-data";

const keys=new Set(["revenue","grossProfit","ebit","netIncome","operatingCashFlow","capex","totalAssets","totalLiabilities","totalEquity","totalDebt","cash"]);
export function officialSource(url:string,jurisdiction:"us"|"br"):boolean {
 try {
  const u=new URL(url);
  return u.protocol==="https:" && (jurisdiction==="us"? (u.hostname==="sec.gov" || u.hostname.endsWith(".sec.gov")) :
    (u.hostname==="dados.cvm.gov.br" || u.hostname==="www.gov.br" || u.hostname==="sistemas.cvm.gov.br"));
 }catch{return false;}
}
export function normalizedPublicMetric(metric:RegulatoryDataMetric,jurisdiction:"us"|"br") {
 const source=metric.source;
 if(metric.statementType!=="annual" || !keys.has(metric.key) ||
   !["verified","single_source"].includes(metric.status) ||
   !Number.isInteger(metric.fiscalYear) || (metric.fiscalYear??0)<2000 || (metric.fiscalYear??0)>2200 ||
   typeof metric.value!=="number" || !Number.isFinite(metric.value) || !source?.url ||
   !officialSource(source.url,jurisdiction)) return null;
 return {key:metric.key,year:metric.fiscalYear!,value:metric.value,unit:metric.unit??null,
  period:metric.period??null,status:metric.status,source:{
   provider:source.provider,url:source.url,form:source.form??null,period:source.period??null,
   retrievedAt:source.retrievedAt??null,
  }};
}
export function preparePublicSnapshot(snapshot:RegulatoryDataSnapshot,registryId:string) {
 if(!["complete","partial"].includes(snapshot.status) || !["sec_edgar","cvm_open_data"].includes(snapshot.provider))return null;
 const normalized=registryId.replace(/\D/g,"");
 if(snapshot.jurisdiction==="us"?!/^\d{6,10}$/.test(normalized):!/^[0-9]{14}$/.test(normalized))return null;
 if(snapshot.resolvedIdentifier && snapshot.resolvedIdentifier.replace(/\D/g,"").replace(/^0+/,"") !== normalized.replace(/^0+/,""))return null;
 const metrics=snapshot.metrics.map(m=>normalizedPublicMetric(m,snapshot.jurisdiction)).filter(m=>m!==null)
  .sort((a,b)=>a.key.localeCompare(b.key)||a.year-b.year||a.source.url.localeCompare(b.source.url));
 if(!metrics.length)return null;
 const payload={jurisdiction:snapshot.jurisdiction,registryId:normalized,provider:snapshot.provider,metrics};
 return {payload,hash:createHash("sha256").update(JSON.stringify(payload)).digest("hex")};
}
/** Best-effort public official snapshot archival: not a blocking analysis dependency. */
export async function persistPublicRegulatorySnapshot(snapshot:RegulatoryDataSnapshot,registryId:string):Promise<boolean> {
 if(!process.env.DATABASE_URL)return false;
 const prepared=preparePublicSnapshot(snapshot,registryId);
 if(!prepared)return false;
 const pool=mysql.createPool({uri:process.env.DATABASE_URL,connectionLimit:2});
 const db=drizzle(pool);
 try{
  const {jurisdiction,registryId:verified,provider}=prepared.payload;
  await db.insert(companies).values({jurisdiction,registryId:verified,legalName:`${jurisdiction.toUpperCase()} issuer ${verified}`})
   .onDuplicateKeyUpdate({set:{registryId:verified}});
  const [company]=await db.select({id:companies.id}).from(companies)
   .where(and(eq(companies.jurisdiction,jurisdiction),eq(companies.registryId,verified))).limit(1);
  if(!company)return false;
  const today=new Date().toISOString().slice(0,10);
  const payloadJson=JSON.stringify(prepared.payload);
  if(payloadJson.length>60000)return false;
  await db.insert(regulatorySnapshots).values({
   companyId:company.id,provider,snapshotDay:today,snapshotHash:prepared.hash,payloadJson,
  }).onDuplicateKeyUpdate({set:{snapshotDay:today}});
  return true;
 }finally{await pool.end();}
}
export async function readPublicRegulatorySnapshots(jurisdiction:"us"|"br",registryId:string) {
 if(!process.env.DATABASE_URL)return [];
 const normalized=registryId.replace(/\D/g,"");
 if(jurisdiction==="us"?!/^\d{6,10}$/.test(normalized):!/^[0-9]{14}$/.test(normalized))return [];
 const pool=mysql.createPool({uri:process.env.DATABASE_URL,connectionLimit:2});
 const db=drizzle(pool);
 try{
  const [company]=await db.select({id:companies.id}).from(companies)
   .where(and(eq(companies.jurisdiction,jurisdiction),eq(companies.registryId,normalized))).limit(1);
  if(!company)return [];
  const snapshots=await db.select({snapshotDay:regulatorySnapshots.snapshotDay,snapshotHash:regulatorySnapshots.snapshotHash,payloadJson:regulatorySnapshots.payloadJson})
   .from(regulatorySnapshots).where(eq(regulatorySnapshots.companyId,company.id)).orderBy(desc(regulatorySnapshots.snapshotDay)).limit(10);
  return snapshots.map(r=>({snapshotDay:r.snapshotDay,snapshotHash:r.snapshotHash,...JSON.parse(r.payloadJson) as Record<string,unknown>}));
 }finally{await pool.end();}
}
