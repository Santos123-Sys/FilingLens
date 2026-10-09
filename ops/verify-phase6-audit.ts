import {createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {buildAuditPayload,type AuditBundle,type AuditPayload} from "../contracts/analysis-assurance";

/**
 * SHA-256 detects accidental bundle modification. It is NOT a digital
 * signature or proof that referenced regulatory/market data is genuine.
 */
export function auditPayloadSha256(payload:AuditPayload):string{
 return createHash("sha256").update(JSON.stringify(payload),"utf8").digest("hex");
}
export function verifyAuditBundle(input:unknown):{
 valid:true;issuer:string;reviewReadiness:string;officialRegulatoryAcceptance:string;
}{
 if(!input||typeof input!=="object"||Array.isArray(input))
  throw new Error("invalid_audit_object");
 const result=input as AuditBundle;
 if(result.schema!=="filinglens.audit_bundle.v1" ||
  typeof result.sha256!=="string"||!/^[a-f0-9]{64}$/.test(result.sha256) ||
  !result.analysis||!result.dossier?.analyst||!result.assurance)
  throw new Error("invalid_audit_schema");
 const {sha256,...payload}=result;
 if(auditPayloadSha256(payload)!==sha256)
  throw new Error("audit_bundle_checksum_mismatch");
 const recomputed=buildAuditPayload(payload.analysis,payload.dossier.analyst,payload.delta,
  payload.createdAt);
 // Guard even against an accidentally recomputed digest over altered
 // user-visible assurance fields. Not a hostile re-authoring defense.
 if(JSON.stringify(recomputed)!==JSON.stringify(payload))
  throw new Error("audit_bundle_recomputation_mismatch");
 return {valid:true,issuer:recomputed.dossier.issuer.name,
  reviewReadiness:recomputed.assurance.reviewReadiness,
  officialRegulatoryAcceptance:recomputed.assurance.officialRegulatoryAcceptance};
}
async function main(){
 const file=process.argv[2];
 if(process.argv.length!==3||!file)throw new Error("usage: npx tsx ops/verify-phase6-audit.ts <audit-bundle.json>");
 const bytes=(await stat(file)).size;
 if(bytes<100||bytes>10_000_000)throw new Error("invalid_audit_bundle_length");
 const payload=JSON.parse(await readFile(file,"utf8")) as unknown;
 console.log(JSON.stringify(verifyAuditBundle(payload)));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(e=>{
  console.error("PHASE6_AUDIT_INVALID",e instanceof Error?e.message:"unknown");
  process.exitCode=1;
 });
}
