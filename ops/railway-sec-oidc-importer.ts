/**
 * Dedicated Railway Function entry: accepts only GitHub-issued OIDC tokens
 * from the maintainer-dispatched official SEC acquisition workflow on main.
 *
 * This is an isolated, privileged operational intake, never a public filing
 * upload or an SEC-network bypass. MySQL credentials must be supplied only
 * as Railway service variables. All SQL is parameterized and table-locked.
 *
 * Railway Function: deploy this exact file contents as its one-file Bun source.
 */
import {createHash} from "node:crypto";
import mysql from "mysql2/promise";

export const SEC_IMPORT_AUDIENCE="filinglens-sec-json-import-v1";
const REPO="Santos123-Sys/FilingLens";
const REPO_ID="1405671411";
const REF="refs/heads/main";
const WORKFLOW=`${REPO}/.github/workflows/sec-official-acquisition.yml@${REF}`;
const ISSUER="https://token.actions.githubusercontent.com";
const JWKS_URL=`${ISSUER}/.well-known/jwks`;
const MAX_JSON=12_000_000;
const MAX_ENVELOPE=17_000_000;
const canonicalSha=(s:Buffer|string)=>createHash("sha256").update(s).digest("hex");

type Claims={iss?:unknown;aud?:unknown;repository?:unknown;repository_id?:unknown;
 ref?:unknown;event_name?:unknown;workflow_ref?:unknown;exp?:unknown;
 iat?:unknown;nbf?:unknown;run_id?:unknown;};
type Receipt={schema?:unknown;cik?:unknown;url?:unknown;retrievedAt?:unknown;
 retrievedDay?:unknown;origin?:unknown;bytes?:unknown;sourceFileSha256?:unknown;
 normalizedPayloadSha256?:unknown;issuer?:unknown;};
type Envelope={cik?:unknown;receipt?:unknown;officialJsonBase64?:unknown;};
const isRecord=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);
const parseJson=(raw:string):unknown=>JSON.parse(raw) as unknown;
const officialUrl=(cik:string)=>`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

export function assertAuthorizedClaims(c:Claims,now=Date.now()){
 const epoch=Math.floor(now/1000);
 if(c.iss!==ISSUER||c.aud!==SEC_IMPORT_AUDIENCE||c.repository!==REPO||
  String(c.repository_id)!==REPO_ID||c.ref!==REF||
  c.event_name!=="workflow_dispatch"||c.workflow_ref!==WORKFLOW||
  typeof c.exp!=="number"||!Number.isInteger(c.exp)||
  typeof c.iat!=="number"||!Number.isInteger(c.iat)||
  typeof c.nbf!=="number"||!Number.isInteger(c.nbf)||
  !/^\\d{6,}$/.test(String(c.run_id??""))||
  Number(c.iat)>epoch+60||Number(c.nbf)>epoch+60||
  Number(c.exp)<=epoch||Number(c.exp)>epoch+1800||
  Number(c.iat)<epoch-1800)
  throw new Error("untrusted_github_oidc_claims");
}
async function limitedJsonResponse(url:string,request:typeof fetch=fetch){
 const res=await request(url,{redirect:"error",signal:AbortSignal.timeout(7000),
  headers:{Accept:"application/json"}});
 if(!res.ok||res.url!==url||!res.headers.get("content-type")?.includes("json"))
  throw new Error("github_oidc_keys_unavailable");
 const contents=await res.text();
 if(contents.length>250_000)throw new Error("github_oidc_keys_oversized");
 return parseJson(contents);
}
export async function verifyGitHubOidc(raw:string,request:typeof fetch=fetch,now=Date.now()){
 if(typeof raw!=="string"||raw.length<100||raw.length>12_000)
  throw new Error("invalid_github_oidc_token");
 const parts=raw.split(".");
 if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))
  throw new Error("invalid_github_oidc_token");
 const header=parseJson(Buffer.from(parts[0],"base64url").toString("utf8"));
 const payload=parseJson(Buffer.from(parts[1],"base64url").toString("utf8"));
 if(!isRecord(header)||!isRecord(payload)||header.alg!=="RS256"||
  typeof header.kid!=="string"||header.kid.length>128)
  throw new Error("unsupported_github_oidc_token");
 assertAuthorizedClaims(payload,now);
 const jwks=await limitedJsonResponse(JWKS_URL,request);
 if(!isRecord(jwks)||!Array.isArray(jwks.keys))
  throw new Error("invalid_github_oidc_jwks");
 const jwk=jwks.keys.find((k:unknown)=>isRecord(k)&&
  k.kid===header.kid && k.kty==="RSA" && k.use==="sig" && k.alg==="RS256");
 if(!jwk)throw new Error("github_oidc_key_not_found");
 const key=await crypto.subtle.importKey("jwk",jwk as JsonWebKey,
  {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
 const verified=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,
  Buffer.from(parts[2],"base64url"),
  new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
 if(!verified)throw new Error("invalid_github_oidc_signature");
 return {runId:String(payload.run_id)};
}
const dayValid=(date:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(date)&&
 !Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
export function validateOfficialUpload(envelope:Envelope,now=Date.now()){
 const cik=envelope.cik,raw=envelope.officialJsonBase64,receipt=envelope.receipt;
 if(typeof cik!=="string"||!/^\d{10}$/.test(cik)||
  typeof raw!=="string"||raw.length<100||raw.length>MAX_ENVELOPE||
  !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)||!isRecord(receipt))
  throw new Error("invalid_official_upload");
 const bytes=Buffer.from(raw,"base64");
 if(bytes.length<100||bytes.length>MAX_JSON)
  throw new Error("invalid_companyfacts_size");
 const sha=canonicalSha(bytes);
 const obj=parseJson(bytes.toString("utf8"));
 if(!isRecord(obj)||!Number.isSafeInteger(obj.cik)||
  String(obj.cik).padStart(10,"0")!==cik||
  typeof obj.entityName!=="string"||!obj.entityName.trim()||
  !isRecord(obj.facts)||!["us-gaap","ifrs-full"].some(k=>isRecord((obj.facts as Record<string,unknown>)[k])))
  throw new Error("companyfacts_identity_or_taxonomy_invalid");
 const canonical=JSON.stringify(obj),canonicalHash=canonicalSha(canonical);
 const receivedAt=receipt.retrievedAt,receivedDay=receipt.retrievedDay;
 if(receipt.schema!=="filinglens.sec_official_acquisition.v1"||
  receipt.origin!=="direct_official_sec_http"||receipt.cik!==cik||
  receipt.url!==officialUrl(cik)||receipt.sourceFileSha256!==sha||
  receipt.normalizedPayloadSha256!==canonicalHash||receipt.bytes!==bytes.length||
  receipt.issuer!==obj.entityName||typeof receivedAt!=="string"||
  typeof receivedDay!=="string"||!dayValid(receivedDay)||
  new Date(receivedAt).toISOString()!==receivedAt ||
  receivedAt.slice(0,10)!==receivedDay ||
  Date.parse(receivedAt)>now+60_000||now-Date.parse(receivedAt)>14*86400000)
  throw new Error("official_sec_receipt_mismatch_or_stale");
 return {cik,issuer:obj.entityName,sourceUrl:officialUrl(cik),retrievedDay:receivedDay,
  fileHash:sha,payloadHash:canonicalHash,canonical,facts:obj};
}
export function apple2025Proof(facts:Record<string,unknown>,cik:string){
 if(cik!=="0000320193")return {status:"not_evaluated" as const};
 const gaap=isRecord(facts.facts)?facts.facts["us-gaap"]:undefined;
 if(!isRecord(gaap))throw new Error("apple_sec_usgaap_missing");
 const tags=["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet"];
 const matches=(candidateCik:string,accession:string,amount:number)=>{
  if(candidateCik!==cik)return false;
  const candidates:number[]=[];
  for(const tag of tags){
   const concept=gaap[tag];
   const units=isRecord(concept)?concept.units:undefined;
   const arr=isRecord(units)?units.USD:undefined;
   if(!Array.isArray(arr))continue;
   for(const item of arr){
    if(!isRecord(item)||item.accn!==accession||
     item.form!=="10-K"||item.fp!=="FY"||
     item.start!=="2024-09-29"||item.end!=="2025-09-27")continue;
    if(typeof item.val!=="number"||!Number.isFinite(item.val))
     throw new Error("apple_sec_revenue_amount_invalid");
    candidates.push(item.val);
   }
  }
  return candidates.length>0&&candidates.every(v=>v===amount);
 };
 const expected="0000320193-25-000079",amount=416_161_000_000;
 const negativeControls={
  wrongAmountRejected:!matches(cik,expected,amount+1_000_000_000),
  wrongAccessionRejected:!matches(cik,"0000320193-25-000078",amount),
  wrongCikRejected:!matches("0000789019",expected,amount),
 };
 if(!matches(cik,expected,amount)||Object.values(negativeControls).some(v=>!v))
  throw new Error("apple_sec_fy2025_numeric_acceptance_failed");
 return {status:"verified" as const,filingAccession:expected,
  periodEnd:"2025-09-27",revenueUsd:amount,...negativeControls};
}
async function readLimited(req:Request){
 if(req.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")
  throw new Error("invalid_content_type");
 const length=Number(req.headers.get("content-length")??"0");
 if(!Number.isFinite(length)||length>MAX_ENVELOPE+150_000)
  throw new Error("request_too_large");
 if(!req.body)throw new Error("empty_body");
 const reader=req.body.getReader();const chunks:Uint8Array[]=[];let count=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;
  if(value){count+=value.byteLength;if(count>MAX_ENVELOPE+150_000)
   throw new Error("request_too_large");chunks.push(value);}}}
 finally{reader.releaseLock();}
 const parsed=parseJson(Buffer.concat(chunks).toString("utf8"));
 if(!isRecord(parsed))throw new Error("invalid_upload_envelope");
 return parsed;
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,
 headers:{"Content-Type":"application/json","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff"}});
async function fetchHandler(req:Request){
 const url=new URL(req.url);
 if(req.method==="GET"&&url.pathname==="/health"){
  if(!process.env.DATABASE_URL)return json({status:"unconfigured"},503);
  try{
   const db=await mysql.createConnection({uri:process.env.DATABASE_URL,connectTimeout:5000});
   try{await db.query("SELECT cik FROM sec_companyfacts_snapshots LIMIT 1");}
   finally{await db.end();}
   return json({status:"ready",database:"reachable"});
  }catch{return json({status:"database_unavailable"},503);}
 }
 // Contact address is stored privately in Railway, not in GitHub repository
 // source or Actions configuration. Only the signed maintainer-dispatched
 // workflow on main can request it.
 if(req.method==="GET"&&url.pathname==="/v1/sec/contact"){
  const authorization=req.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return json({error:"unauthorized"},401);
  try{await verifyGitHubOidc(authorization.slice(7));}
  catch{return json({error:"unauthorized"},401);}
  const contact=process.env.SEC_CONTACT_EMAIL;
  if(!contact||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact)||contact.length>160)
   return json({error:"contact_unconfigured"},503);
  return json({email:contact});
 }
 if(req.method!=="POST"||url.pathname!=="/v1/sec/import")
  return json({error:"not_found"},404);
 const auth=req.headers.get("authorization")??"";
 try{
  if(!auth.startsWith("Bearer "))throw new Error("unauthorized");
  const {runId}=await verifyGitHubOidc(auth.slice(7));
  const envelope=await readLimited(req);
  const check=validateOfficialUpload(envelope);
  const proof=apple2025Proof(check.facts,check.cik);
  const dbUrl=process.env.DATABASE_URL;
  if(!dbUrl)throw new Error("import_database_not_configured");
  const connection=await mysql.createConnection({uri:dbUrl,connectTimeout:5000});
  try{
   await connection.execute(`INSERT INTO sec_companyfacts_snapshots
    (cik,retrieved_day,archive_sha256,payload_sha256,source_url,payload_json)
    VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
    retrieved_day=VALUES(retrieved_day),archive_sha256=VALUES(archive_sha256),
    payload_sha256=VALUES(payload_sha256),source_url=VALUES(source_url),
    payload_json=VALUES(payload_json),imported_at=CURRENT_TIMESTAMP`,
    [check.cik,check.retrievedDay,check.fileHash,check.payloadHash,
     check.sourceUrl,check.canonical]);
   const [rows]=await connection.query("SELECT payload_sha256,source_url,retrieved_day FROM sec_companyfacts_snapshots WHERE cik=? LIMIT 1",[check.cik]);
   const row=(rows as Array<{payload_sha256:string;source_url:string;retrieved_day:string}>)[0];
   if(!row||row.payload_sha256!==check.payloadHash||row.source_url!==check.sourceUrl||
     row.retrieved_day!==check.retrievedDay)
    throw new Error("production_db_readback_failed");
  }finally{await connection.end();}
  return json({imported:true,cik:check.cik,issuer:check.issuer,
   sourceMode:"operator_attested_sec_json",origin:"github_oidc_workflow",
   githubRunId:runId,sourceFileSha256:check.fileHash,
   payloadSha256:check.payloadHash,retrievedDay:check.retrievedDay,
   readbackVerified:true,referenceProof:proof});
 }catch(error){
  const code=error instanceof Error?error.message:"unknown";
  if(["unauthorized","invalid_github_oidc_token","unsupported_github_oidc_token",
   "untrusted_github_oidc_claims","invalid_github_oidc_signature","github_oidc_key_not_found"].includes(code))
   return json({error:"unauthorized"},401);
  // Deny without logging data, authentication token, or MySQL credentials.
  if(code.includes("database")||code.includes("mysql"))
   return json({error:"database_unavailable"},503);
  return json({error:"ingest_rejected",reason:code.startsWith("apple_sec_")?
    "numeric_acceptance_failed":"invalid_or_unavailable_evidence"},422);
 }
}
export default {fetch:fetchHandler};
