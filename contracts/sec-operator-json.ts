import {createHash} from "node:crypto";
import {secProofUrl} from "./sec-peer-proof";
import {verifyBulkMember} from "./sec-bulk-import";

/**
 * Operator-attested SEC CompanyFacts JSON input from the exact official
 * CompanyFacts URL. The program does not fetch SEC data, so it cannot
 * bypass or retry an SEC access denial.
 */
export function prepareSecOperatorJson(cik:string,contents:Buffer,retrievedDay:string,now=Date.now()){
 const ms=Date.parse(retrievedDay+"T00:00:00Z");
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(retrievedDay)||
   !Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==retrievedDay||
   !Number.isFinite(now)||(now-ms)/86400000<0||(now-ms)/86400000>14)
  throw new Error("sec_operator_json_invalid_or_stale_retrieval_day");
 const {payloadJson,payloadSha256}=verifyBulkMember(cik,contents);
 const sourceUrl=secProofUrl(cik);
 return {
  cik,retrievedDay,sourceUrl,payloadJson,payloadSha256,
  sourceFileSha256:createHash("sha256").update(contents).digest("hex"),
  sourceMode:"operator_attested_sec_json" as const,
 };
}
