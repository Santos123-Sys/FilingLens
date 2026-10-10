import {createHash} from "node:crypto";
import mysql from "mysql2/promise";
import {secProofUrl} from "../contracts/sec-peer-proof";
import type {SecCompanyFacts} from "../contracts/sec-peer-proof";

/** SEC bulk archive is downloaded by an authorized operator and imported offline.
 * The SEC origin is attested by the operator, not independently fetched by the
 * Railway service. No untrusted URL is ever fetched by this code. */
export const SEC_BULK_URL="https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip";
const defaultMaxAge=14;
type CachedFacts={facts:SecCompanyFacts;retrievedDay:string;sha256:string;source:"operator_attested_sec_bulk"|"operator_attested_sec_json"};
export async function cachedSecCompanyFacts(cik:string,dbUrl=process.env.DATABASE_URL,options:{maxAgeDays?:number}={}):Promise<CachedFacts|null>{
 if(!/^\d{10}$/.test(cik)||!dbUrl)return null;
 const maxAge=options.maxAgeDays??defaultMaxAge;
 if(!Number.isInteger(maxAge)||maxAge<1||maxAge>730)return null;
 const pool=mysql.createPool({uri:dbUrl,connectionLimit:1,connectTimeout:3000});
 try{
  const [rows]=await pool.query(
    "SELECT retrieved_day,source_url,archive_sha256,payload_sha256,payload_json FROM sec_companyfacts_snapshots WHERE cik=? LIMIT 1",
    [cik]
  );
  const row=(rows as Array<{retrieved_day:string;source_url:string;archive_sha256:string;payload_sha256:string;payload_json:string}>)[0];
  if(!row||![SEC_BULK_URL,secProofUrl(cik)].includes(row.source_url)||
    !/^[a-f0-9]{64}$/.test(row.archive_sha256)||
    !/^[a-f0-9]{64}$/.test(row.payload_sha256))return null;
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(row.retrieved_day))return null;
  const age=(Date.now()-Date.parse(row.retrieved_day+"T00:00:00Z"))/86400000;
  if(!Number.isFinite(age)||age<0||age>maxAge)return null;
  if(row.payload_json.length>12_000_000)return null;
  const sha=createHash("sha256").update(row.payload_json).digest("hex");
  if(sha!==row.payload_sha256)return null;
  const facts=JSON.parse(row.payload_json) as SecCompanyFacts;
  if(!Number.isSafeInteger(facts.cik)||String(facts.cik).padStart(10,"0")!==cik||
    !facts.entityName||typeof facts.facts!=="object"||!facts.facts)return null;
  return {facts,retrievedDay:row.retrieved_day,sha256:sha,
    source:row.source_url===SEC_BULK_URL?"operator_attested_sec_bulk":"operator_attested_sec_json"};
 }catch(e){
  console.warn("[sec-bulk-cache] cache unavailable",e instanceof Error?e.name:"unknown");
  return null;
 }finally{await pool.end();}
}
