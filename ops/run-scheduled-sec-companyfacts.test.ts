import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it,vi} from "vitest";
import {runScheduledCompanyFacts} from "./run-scheduled-sec-companyfacts";
import {SecHttpError} from "../contracts/sec-official-acquisition";

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

it('preserves partial progress and a sanitized failure receipt without retrying',async()=>{
 const root=await mkdtemp(join(tmpdir(),'filinglens-sec-failure-'));
 try{
  const watchlist=join(root,'watchlist.json');
  await writeFile(watchlist,JSON.stringify({schema:'filinglens.sec_edgar_watchlist.v1',lookbackDays:3,limitPerForm:1,issuers:[
   {ticker:'AAPL',cik:'0000320193',forms:['10-K']},{ticker:'MSFT',cik:'0000789019',forms:['10-Q']},
  ]}));
  const acquire=vi.fn(async(cik:string,file:string)=>{
   if(cik==='0000789019')throw Error('HTTP 403 secret-contact@example.org');
   await writeFile(file,'public evidence');
   return {file,receiptFile:file+'.receipt',cik,bytes:15,retrievedDay:'2026-10-15',sourceFileSha256:'a',sourceUrl:'https://data.sec.gov'};
  });
  const push=vi.fn(async()=>({retrievedDay:'2026-10-15',payloadSha256:'b'.repeat(64),readbackVerified:true}));
  await expect(runScheduledCompanyFacts(watchlist,root,'secret-contact@example.org','https://example.test',acquire,push as never)).rejects.toThrow('HTTP 403');
  const receipt=await readFile(join(root,'sec-edgar-filings/acquisition-status.json'),'utf8');
  expect(JSON.parse(receipt)).toMatchObject({status:'partial',failedIssuer:'0000789019',phase:'acquire',plannedIssuers:2,imported:[{ticker:'AAPL',readbackVerified:true}]});
  expect(receipt).not.toContain('secret-contact');
  expect(acquire).toHaveBeenCalledTimes(2);expect(push).toHaveBeenCalledTimes(1);
  expect(await readFile(join(root,'sec-edgar-filings/AAPL/COMPANYFACTS/CIK0000320193/companyfacts.json'),'utf8')).toBe('public evidence');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('records a typed provider denial without leaking arbitrary error text or importing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sec-blocked-'));
 try{
  const file=join(root,'watchlist.json');
  await writeFile(file,JSON.stringify({schema:'filinglens.sec_edgar_watchlist.v1',lookbackDays:3,limitPerForm:1,
   issuers:[{ticker:'AAPL',cik:'0000320193',forms:['10-K']},{ticker:'MSFT',cik:'0000789019',forms:['10-Q']}]}));
  const acquire=vi.fn(async()=>{throw new SecHttpError(403);});const push=vi.fn();
  await expect(runScheduledCompanyFacts(file,root,'private@example.org','https://example.test',acquire,push as never)).rejects.toThrow('HTTP 403');
  const receipt=JSON.parse(await readFile(join(root,'sec-edgar-filings/acquisition-status.json'),'utf8'));
  expect(receipt).toMatchObject({status:'blocked',httpStatus:403,requiresAccessReview:true,imported:[]});
  expect(acquire).toHaveBeenCalledTimes(1);expect(push).not.toHaveBeenCalled();
 }finally{await rm(root,{recursive:true,force:true});}
});
