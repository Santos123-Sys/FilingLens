/**
 * Real-data production acceptance (read-only): requires a fresh, hash-checked
 * operator-imported SEC CompanyFacts record in Railway MySQL.
 * No live SEC HTTP request, fabricated number or DB mutation.
 *
 * DATABASE_URL="<restricted app DB URL>" npx tsx ops/verify-sec-acceptance.ts \\
 *  --cik 0000320193 --peer "Apple Inc." \\
 *  --filing-url "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/annual.htm" \\
 *  --metric Revenue --fy 2025 --period-end 2025-09-27 \\
 *  --basis "US GAAP" --currency USD --amount-millions 416161
 * The filing URL and amount are operator-provided and MUST be verified against
 * the actual relevant as-filed SEC accession, not copied blindly from this example.
 */
import {cachedSecCompanyFacts} from "../api/sec-bulk-cache";
import {evaluateSecAcceptance} from "../contracts/sec-acceptance";

async function main(){
 const args=process.argv.slice(2);
 const keys=new Set(["cik","peer","filing-url","metric","fy","period-end","basis","currency","amount-millions"]);
 const params:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){
  const option=args[i];
  if(!option?.startsWith("--")||!keys.has(option.slice(2))||
   !args[i+1]||args[i+1].startsWith("--")||option.slice(2) in params)
    throw new Error("Invalid, duplicated or missing SEC acceptance argument");
  params[option.slice(2)]=args[i+1];
 }
 if(keys.size!==Object.keys(params).length)throw new Error("Missing SEC acceptance arguments");
 const source=await cachedSecCompanyFacts(params.cik);
 if(!source)throw new Error("No fresh, hash-verified official SEC bulk import for this CIK");
 const result=evaluateSecAcceptance({
  cik:params.cik,peerName:params.peer,filingUrl:params["filing-url"],metric:params.metric,
  fiscalYear:Number(params.fy),periodEnd:params["period-end"],
  basis:params.basis as "US GAAP"|"IFRS",
  currency:params.currency as "USD"|"EUR"|"GBP"|"CHF",
  amountMillions:Number(params["amount-millions"]),
 },source.facts);
 console.log(JSON.stringify({ ...result,sourceMode:source.source,
  archiveRetrievedDay:source.retrievedDay,payloadSha256:source.sha256 }));
 if(!result.passed)process.exitCode=1;
}
main().catch(e=>{console.error("SEC_ACCEPTANCE_BLOCKED",e instanceof Error?e.message:"unknown");process.exitCode=1;});
