/**
 * Direct, single-request download from the official SEC CompanyFacts API,
 * executable only from an authorized, SEC-compliant network.
 *
 * SEC_CONTACT_EMAIL="real@organization.com" npx --yes tsx \
 *  ops/acquire-sec-companyfacts.ts --cik 0000320193 \
 *  --output /secure/CIK0000320193.json
 *
 * Never use IP rotation, a proxy to bypass 403, or model-generated data.
 */
import {writeFile,unlink} from "node:fs/promises";
import {acquireOfficialSecCompanyFacts} from "../contracts/sec-official-acquisition";

export async function acquireToDisk(cik:string,output:string,contact:string){
 if(!output||output.endsWith("/")||output.includes("\u0000"))
  throw new Error("a valid output file path is required");
 const {body,receipt}=await acquireOfficialSecCompanyFacts(cik,contact);
 const receiptPath=output+".sec-receipt.json";
 await writeFile(output,body,{flag:"wx",mode:0o600});
 try{await writeFile(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});}
 catch(error){await unlink(output).catch(()=>{});throw error;}
 return {file:output,receiptFile:receiptPath,cik,bytes:receipt.bytes,
  retrievedDay:receipt.retrievedDay,sourceFileSha256:receipt.sourceFileSha256,
  sourceUrl:receipt.url};
}
async function main(){
 const args=process.argv.slice(2);
 const parsed:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){
  const flag=args[i],value=args[i+1];
  if(!["--cik","--output"].includes(flag)||!value||flag.slice(2) in parsed||
   value.startsWith("--"))throw new Error("usage: --cik CIK########## --output PATH");
  parsed[flag.slice(2)]=value;
 }
 if(Object.keys(parsed).length!==2||!process.env.SEC_CONTACT_EMAIL)
  throw new Error("CIK, output and operator-provided SEC_CONTACT_EMAIL environment variable are required");
 console.log(JSON.stringify(await acquireToDisk(parsed.cik,parsed.output,process.env.SEC_CONTACT_EMAIL)));
}
main().catch(e=>{
 console.error("OFFICIAL_SEC_DOWNLOAD_UNAVAILABLE",e instanceof Error?e.message:"unknown");
 process.exitCode=1;
});
