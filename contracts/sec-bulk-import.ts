import {createHash} from "node:crypto";
import type {SecCompanyFacts} from "./sec-peer-proof";
export const OFFICIAL_COMPANYFACTS_ARCHIVE="https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip";
export function verifyBulkMember(cik:string,contents:Buffer){
 if(!/^\d{10}$/.test(cik)||contents.byteLength<100||contents.byteLength>12_000_000)
  throw new Error("invalid_sec_member_length_or_cik");
 const payload=JSON.parse(contents.toString("utf8")) as SecCompanyFacts;
 if(!Number.isSafeInteger(payload.cik)||String(payload.cik).padStart(10,"0")!==cik||
  typeof payload.entityName!=="string"||!payload.entityName.trim()||
  !payload.facts||typeof payload.facts!=="object"||!Object.keys(payload.facts).some(x=>["us-gaap","ifrs-full"].includes(x)))
  throw new Error("sec_member_issuer_identity_or_taxonomy_mismatch");
 const payloadJson=JSON.stringify(payload);
 return {payloadJson,payloadSha256:createHash("sha256").update(payloadJson).digest("hex")};
}

/** Bound one operator import to a small, explicitly enumerated peer cohort. */
export function parseBulkCiks(single?:string,batch?:string):string[]{
 if(Boolean(single)===Boolean(batch))throw new Error("specify exactly one of --cik or --ciks");
 const raw=single?[single!]:batch!.split(",");
 if(raw.length<1||raw.length>12||raw.some(x=>!/^\d{10}$/.test(x))||
  new Set(raw).size!==raw.length)throw new Error("SEC import requires 1-12 distinct ten-digit CIKs");
 return raw;
}
