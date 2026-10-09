import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it,vi} from "vitest";
import {runScheduledCompanyFacts} from "./run-scheduled-sec-companyfacts";

describe("scheduled SEC CompanyFacts acquisition",()=>{
 it("processes the bounded watchlist serially into ticker folders",async()=>{
  const root=await mkdtemp(join(tmpdir(),"filinglens-sec-"));
  try{
   const watchlist=join(root,"watchlist.json");
   await writeFile(watchlist,JSON.stringify({schema:"filinglens.sec_edgar_watchlist.v1",
    lookbackDays:3,limitPerForm:1,issuers:[
     {ticker:"AAPL",cik:"0000320193",forms:["10-K"]},
     {ticker:"MSFT",cik:"0000789019",forms:["10-Q"]},
    ]}));
   const acquired:string[]=[];
   const acquire=vi.fn(async(cik:string,file:string)=>{
    acquired.push(cik);await writeFile(file,"official-json");
    await writeFile(file+".sec-receipt.json","{}");
    return {file,receiptFile:file+".sec-receipt.json",cik,bytes:13,retrievedDay:"2026-10-09",sourceFileSha256:"a",sourceUrl:"https://data.sec.gov"};
   });
   const push=vi.fn(async(file:string,_receipt:string,cik:string)=>({
    cik,retrievedDay:"2026-10-09",payloadSha256:"b".repeat(64),readbackVerified:true,file,
   }));
   const result=await runScheduledCompanyFacts(watchlist,root,"operator@example.org",
    "https://example.up.railway.app/v1/sec/import",acquire,push as never);
   expect(acquired).toEqual(["0000320193","0000789019"]);
   expect(result).toHaveLength(2);
   expect(await readFile(join(root,"sec-edgar-filings/AAPL/COMPANYFACTS/CIK0000320193/companyfacts.json"),"utf8")).toBe("official-json");
   expect(push).toHaveBeenCalledTimes(2);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
