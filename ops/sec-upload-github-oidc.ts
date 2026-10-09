/**
 * Called only inside the maintainer-dispatched GitHub Actions workflow.
 * GitHub OIDC authenticates the run to the isolated Railway importer.
 * The official bytes are never committed to GitHub, and the importer does
 * not fetch a URL supplied by a caller.
 */
import {readFile,stat} from "node:fs/promises";
import {validateSecReceipt} from "../contracts/sec-official-acquisition";
import {SEC_IMPORT_AUDIENCE} from "./railway-sec-oidc-importer";

const env=(key:string)=>{
 const value=process.env[key];
 if(!value)throw new Error(`Missing ${key}`);
 return value;
};
const json=async(r:Response)=>{
 const t=await r.text();
 if(t.length>40_000)throw new Error("Response too large");
 return JSON.parse(t) as Record<string,unknown>;
};
export async function pushOfficialToRailway(file:string,receiptFile:string,cik:string,
 endpoint:string,request:typeof fetch=fetch){
 if(!/^\d{10}$/.test(cik))throw new Error("invalid_CIK");
 const uri=new URL(endpoint);
 if(uri.protocol!=="https:"||!uri.hostname.endsWith(".up.railway.app")||
  uri.username||uri.password||uri.search||uri.hash||
  uri.pathname!=="/v1/sec/import")throw new Error("not_an_approved_Railway_SEC_intake_URL");
 const s=await stat(file);
 if(s.size<100||s.size>12_000_000)throw new Error("official_JSON_size_invalid");
 const body=await readFile(file);
 const receipt=JSON.parse(await readFile(receiptFile,"utf8")) as unknown;
 validateSecReceipt(cik,body,receipt);
 const oidcUrl=new URL(env("ACTIONS_ID_TOKEN_REQUEST_URL"));
 if(oidcUrl.protocol!=="https:"||oidcUrl.hostname!=="pipelines.actions.githubusercontent.com")
  throw new Error("invalid_GitHub_actions_OIDC_token_endpoint");
 oidcUrl.searchParams.set("audience",SEC_IMPORT_AUDIENCE);
 const response=await request(oidcUrl.toString(),{
  headers:{"Authorization":`bearer ${env("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}`,
   "Accept":"application/json"},redirect:"error",signal:AbortSignal.timeout(15_000),
 });
 if(!response.ok)throw new Error("GitHub Actions OIDC token unavailable");
 const token=(await json(response)).value;
 if(typeof token!=="string"||token.length<100||token.length>12_000)
  throw new Error("invalid_GitHub_Actions_OIDC_token");
 const result=await request(uri.toString(),{
  method:"POST",headers:{"Authorization":`Bearer ${token}`,
   "Content-Type":"application/json","Accept":"application/json"},
  body:JSON.stringify({cik,receipt,officialJsonBase64:body.toString("base64")}),
  redirect:"error",signal:AbortSignal.timeout(35_000),
 });
 if(!result.ok)throw new Error(`Railway SEC intake rejected import with HTTP ${result.status}`);
 const resultJson=await json(result);
 const proof=resultJson.referenceProof;
 if(resultJson.imported!==true||resultJson.readbackVerified!==true||
  resultJson.cik!==cik||resultJson.payloadSha256!==(receipt as {normalizedPayloadSha256:string}).normalizedPayloadSha256||
  (cik==="0000320193"&&(!proof||typeof proof!=="object"||(proof as {status?:string}).status!=="verified")))
  throw new Error("Railway production source and accession acceptance missing");
 return resultJson;
}
async function main(){
 const cik=env("SEC_CIK");
 const url=env("SEC_IMPORT_URL");
 const file=`/tmp/sec-official/CIK${cik}.json`;
 const result=await pushOfficialToRailway(file,file+".sec-receipt.json",cik,url);
 console.log(JSON.stringify({imported:result.imported,readbackVerified:result.readbackVerified,
  sourceMode:result.sourceMode,cik:result.cik,retrievedDay:result.retrievedDay,
  payloadSha256:result.payloadSha256,referenceProof:result.referenceProof}));
}
if(process.argv[1]?.endsWith("sec-upload-github-oidc.ts"))main().catch(e=>{
 console.error("SEC_PRODUCTION_OIDC_IMPORT_UNAVAILABLE",e instanceof Error?e.message:"unknown");
 process.exitCode=1;
});
