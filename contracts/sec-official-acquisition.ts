import {createHash} from "node:crypto";
import {verifyBulkMember} from "./sec-bulk-import";
import {secProofUrl} from "./sec-peer-proof";

/**
 * A single transparent, SEC-compliant GET from a genuinely authorized network.
 * Do not rotate IPs, tunnel a denied request, or retry 403/429. The SEC may
 * still block the caller; this function deliberately fails closed.
 */
export type OfficialSecReceipt={
 schema:"filinglens.sec_official_acquisition.v1";
 cik:string;url:string;retrievedAt:string;retrievedDay:string;
 sourceFileSha256:string;normalizedPayloadSha256:string;
 bytes:number;issuer:string;
 origin:"direct_official_sec_http";
};
const contactPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function secContactUserAgent(contact:string){
 if(!contactPattern.test(contact)||contact.length>160||/[\r\n]/.test(contact))
  throw new Error("SEC requires a genuine operator contact email for fair-access requests");
 return `FilingLens-Official-SEC-Importer/1.0 (${contact}; https://github.com/Santos123-Sys/FilingLens)`;
}
export async function acquireOfficialSecCompanyFacts(cik:string,contact:string,
 request:typeof fetch=fetch,now:()=>Date=()=>new Date()):Promise<{body:Buffer;receipt:OfficialSecReceipt}>{
 if(!/^\d{10}$/.test(cik))throw new Error("invalid SEC CIK");
 const url=secProofUrl(cik);
 const response=await request(url,{
  method:"GET",headers:{"User-Agent":secContactUserAgent(contact),"Accept":"application/json"},
  redirect:"error",signal:AbortSignal.timeout(15_000),
 });
 if(!response.ok)throw new Error(`Official SEC returned HTTP ${response.status}; stop and contact SEC support if access is denied`);
 if(response.url!==url || !response.headers.get("content-type")?.toLowerCase().includes("json"))
  throw new Error("SEC acquisition origin or response content type mismatch");
 const size=Number(response.headers.get("content-length")??"0");
 if(!Number.isFinite(size)||size>12_000_000)throw new Error("SEC CompanyFacts response too large");
 if(!response.body)throw new Error("SEC JSON response has no body");
 const reader=response.body.getReader();
 const chunks:Uint8Array[]=[];let count=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(value){count+=value.byteLength;
    if(count>12_000_000)throw new Error("SEC CompanyFacts response exceeds 12 MB");
    chunks.push(value);}
  }
 }finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks);
 // Only the raw original response bytes are retained; no transformed extract,
 // fabricated accession or model-generated XBRL data may be imported.
 const verified=verifyBulkMember(cik,bytes);
 const parsed=JSON.parse(bytes.toString("utf8")) as {entityName:string};
 const clock=now();
 if(Number.isNaN(clock.getTime()))throw new Error("invalid acquisition clock");
 const retrievedAt=clock.toISOString();
 return {body:bytes,receipt:{
  schema:"filinglens.sec_official_acquisition.v1",cik,url,retrievedAt,
  retrievedDay:retrievedAt.slice(0,10),
  sourceFileSha256:createHash("sha256").update(bytes).digest("hex"),
  normalizedPayloadSha256:verified.payloadSha256,bytes:bytes.length,
  issuer:parsed.entityName,origin:"direct_official_sec_http",
 }};
}
export function validateSecReceipt(cik:string,bytes:Buffer,receipt:unknown):OfficialSecReceipt{
 if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))
  throw new Error("invalid SEC acquisition receipt");
 const r=receipt as OfficialSecReceipt;
 if(r.schema!=="filinglens.sec_official_acquisition.v1"||
    r.origin!=="direct_official_sec_http"||r.cik!==cik||
    r.url!==secProofUrl(cik)||r.bytes!==bytes.length||
    !/^20\d\d-\d\d-\d\d$/.test(r.retrievedDay)||
    Number.isNaN(Date.parse(r.retrievedAt))||r.retrievedAt.slice(0,10)!==r.retrievedDay||
    r.sourceFileSha256!==createHash("sha256").update(bytes).digest("hex"))
   throw new Error("SEC acquisition receipt does not match unmodified JSON");
 const verified=verifyBulkMember(cik,bytes);
 if(r.normalizedPayloadSha256!==verified.payloadSha256 ||
    r.issuer!==(JSON.parse(bytes.toString("utf8")) as {entityName:string}).entityName)
   throw new Error("SEC acquisition receipt issuer or canonical SHA mismatch");
 // The receipt records operator provenance; a checksum is not a signature.
 return r;
}
