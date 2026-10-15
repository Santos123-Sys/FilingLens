/** Acquire each bounded watchlist issuer and import it through signed GitHub OIDC. */
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {parseSecEdgarWatchlist} from "../contracts/sec-edgar-watchlist";
import {acquireToDisk} from "./acquire-sec-companyfacts";
import {pushOfficialToRailway} from "./sec-upload-github-oidc";

const env=(key:string)=>{
 const value=process.env[key];
 if(!value)throw new Error(`Missing ${key}`);
 return value;
};

export async function runScheduledCompanyFacts(
 watchlistFile:string,outputRoot:string,contact:string,endpoint:string,
 acquire=acquireToDisk,push=pushOfficialToRailway,
){
 const plan=parseSecEdgarWatchlist(JSON.parse(await readFile(watchlistFile,"utf8")) as unknown);
 const imported:{ticker:string;cik:string;retrievedDay:string;payloadSha256:string;readbackVerified:boolean}[]=[];
 const archive=join(outputRoot,"sec-edgar-filings");
 await mkdir(archive,{recursive:true,mode:0o700});
 const receipt=async(status:string,failedIssuer?:string,phase?:string)=>writeFile(
  join(archive,"acquisition-status.json"),JSON.stringify({schema:"filinglens.sec_acquisition_status.v1",
   status,recordedAt:new Date().toISOString(),plannedIssuers:plan.issuers.length,
   imported,failedIssuer,phase},null,2),{mode:0o600});
 await receipt("running");
 for(const issuer of plan.issuers){
  const directory=join(outputRoot,"sec-edgar-filings",issuer.ticker,"COMPANYFACTS",`CIK${issuer.cik}`);
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=join(directory,"companyfacts.json");
  let phase="acquire";
  try{
  const acquired=await acquire(issuer.cik,file,contact);
  phase="import";
  const result=await push(file,acquired.receiptFile,issuer.cik,endpoint);
  imported.push({ticker:issuer.ticker,cik:issuer.cik,retrievedDay:result.retrievedDay,
   payloadSha256:result.payloadSha256,readbackVerified:result.readbackVerified});
  await receipt("running");
  }catch(error){
   // Never archive arbitrary error messages: they can contain credentials or URLs.
   await receipt(imported.length?"partial":"failed",issuer.cik,phase);
   throw error;
  }
 }
 await receipt("complete");
 return imported;
}

async function main(){
 const results=await runScheduledCompanyFacts(
  "config/sec-edgar-watchlist.json","/tmp/sec-official",
  env("SEC_CONTACT_EMAIL"),env("SEC_IMPORT_URL"));
 console.log(JSON.stringify({scheduledImports:results.length,results}));
}
if(process.argv[1]?.endsWith("run-scheduled-sec-companyfacts.ts"))main().catch(error=>{
 console.error("SCHEDULED_SEC_ACQUISITION_UNAVAILABLE",error instanceof Error?error.message:"unknown");
 process.exitCode=1;
});
