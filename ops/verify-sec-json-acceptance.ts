/**
 * Exact-accession acceptance over a fresh original SEC JSON before DB import.
 * This is an offline numerical proof only. The final production gate additionally
 * requires a successfully imported and readable Railway MySQL record.
 */
import {readFile,stat} from "node:fs/promises";
import {verifyBulkMember} from "../contracts/sec-bulk-import";
import {evaluateSecAcceptance} from "../contracts/sec-acceptance";
import {validateSecReceipt} from "../contracts/sec-official-acquisition";
import type {SecCompanyFacts} from "../contracts/sec-peer-proof";

async function main(){
 const args=process.argv.slice(2),values:Record<string,string>={};
 const allowed=new Set(["file","receipt","cik","peer","filing-url","metric",
  "fy","period-end","basis","currency","amount-millions"]);
 for(let i=0;i<args.length;i+=2){
  const flag=args[i],value=args[i+1];
  if(!flag?.startsWith("--")||!allowed.has(flag.slice(2))||!value||
   value.startsWith("--")||flag.slice(2) in values)throw new Error("invalid input");
  values[flag.slice(2)]=value;
 }
 if(allowed.size!==Object.keys(values).length ||
  !/^\d{10}$/.test(values.cik))throw new Error("All SEC offline acceptance arguments are required");
 const length=(await stat(values.file)).size;
 if(length<100||length>12_000_000)throw new Error("invalid SEC file size");
 const body=await readFile(values.file);
 verifyBulkMember(values.cik,body);
 const receipt=JSON.parse(await readFile(values.receipt,"utf8")) as unknown;
 const validated=validateSecReceipt(values.cik,body,receipt);
 const proof=evaluateSecAcceptance({
  cik:values.cik,peerName:values.peer,filingUrl:values["filing-url"],
  metric:values.metric,fiscalYear:Number(values.fy),
  periodEnd:values["period-end"],basis:values.basis as "US GAAP"|"IFRS",
  currency:values.currency as "USD"|"EUR"|"GBP"|"CHF",
  amountMillions:Number(values["amount-millions"]),
 },JSON.parse(body.toString("utf8")) as SecCompanyFacts);
 console.log(JSON.stringify({sourceUrl:validated.url,sourceFileSha256:validated.sourceFileSha256,
  retrievedDay:validated.retrievedDay,acceptance:proof}));
 if(!proof.passed)process.exitCode=1;
}
main().catch(e=>{
 console.error("OFFLINE_SEC_ACCEPTANCE_FAILED",e instanceof Error?e.message:"unknown");
 process.exitCode=1;
});
