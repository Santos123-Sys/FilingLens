/** Acquire each bounded watchlist issuer and import it through signed GitHub OIDC. */
import {mkdir,readFile} from "node:fs/promises";
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
 const imported=[];
 for(const issuer of plan.issuers){
  const directory=join(outputRoot,"sec-edgar-filings",issuer.ticker,"COMPANYFACTS",`CIK${issuer.cik}`);
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=join(directory,"companyfacts.json");
  const acquired=await acquire(issuer.cik,file,contact);
  const result=await push(file,acquired.receiptFile,issuer.cik,endpoint);
  imported.push({ticker:issuer.ticker,cik:issuer.cik,retrievedDay:result.retrievedDay,
   payloadSha256:result.payloadSha256,readbackVerified:result.readbackVerified});
 }
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
