import {describe,it,expect,vi} from "vitest";
import {acquireOfficialSecCompanyFacts,secContactUserAgent,validateSecReceipt} from "./sec-official-acquisition";
const cik="0000320193";
const official={
 cik:320193,entityName:"Apple Inc.",facts:{"us-gaap":{Revenues:{units:{USD:[{
  accn:"0000320193-25-000079",form:"10-K",fp:"FY",fy:2025,
  start:"2024-09-29",end:"2025-09-27",val:416161000000,
 }]}}}},
};
const bytes=JSON.stringify(official);
const url="https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json";
const reply=(body=bytes,headers={"Content-Type":"application/json"})=>{
 const res=new Response(body,{status:200,headers});
 Object.defineProperty(res,"url",{value:url});
 return res;
};
describe("SEC acquisition compliance and provenance",()=>{
 it("makes one exact-host GET and retains original raw bytes with source receipt",async()=>{
  const mock=vi.fn(async()=>reply()) as unknown as typeof fetch;
  const r=await acquireOfficialSecCompanyFacts(cik,"operator@organization.example",mock,
   ()=>new Date("2026-10-09T12:20:30.000Z"));
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock).toHaveBeenCalledWith(url,expect.objectContaining({redirect:"error",method:"GET",
   headers:expect.objectContaining({"Accept":"application/json"})}));
  expect(r.body.toString("utf8")).toBe(bytes);
  expect(r.receipt.origin).toBe("direct_official_sec_http");
  expect(r.receipt.retrievedDay).toBe("2026-10-09");
  expect(validateSecReceipt(cik,r.body,r.receipt)).toEqual(r.receipt);
 });
 it("does not accept fake contact, URL redirection or non-JSON",async()=>{
  expect(()=>secContactUserAgent("anonymous")).toThrow();
  expect(()=>secContactUserAgent("operator@example.com\r\nheader: spoof")).toThrow();
  const redirect=vi.fn(async()=>new Response(bytes,{status:200,headers:{"Content-Type":"application/json"}}));
  await expect(acquireOfficialSecCompanyFacts(cik,"operator@example.com",redirect as typeof fetch))
   .rejects.toThrow(/origin/);
  await expect(acquireOfficialSecCompanyFacts(cik,"operator@example.com",
   (async()=>new Response("<html>blocked</html>",{status:200,headers:{"Content-Type":"text/html"}})) as typeof fetch))
   .rejects.toThrow(/origin/);
 });
 it("fails on HTTP 403 without retry and on transformed fixture format",async()=>{
  const f=vi.fn(async()=>new Response("denied",{status:403,headers:{"Content-Type":"text/html"}}));
  await expect(acquireOfficialSecCompanyFacts(cik,"operator@example.com",f as typeof fetch))
   .rejects.toThrow(/HTTP 403/);
  expect(f).toHaveBeenCalledTimes(1);
  await expect(acquireOfficialSecCompanyFacts(cik,"operator@example.com",
   (async()=>reply(JSON.stringify({metadata:{cik},sample_facts:[]}))) as typeof fetch))
   .rejects.toThrow();
 });
 it("rejects truncated, mutated and wrong issuer receipts",async()=>{
  const fetcher=vi.fn(async()=>reply()) as unknown as typeof fetch;
  const r=await acquireOfficialSecCompanyFacts(cik,"operator@example.com",fetcher);
  expect(()=>validateSecReceipt(cik,Buffer.from(bytes+" "),r.receipt)).toThrow();
  expect(()=>validateSecReceipt("0000789019",r.body,r.receipt)).toThrow();
  expect(()=>validateSecReceipt(cik,r.body,{...r.receipt,sourceFileSha256:"0".repeat(64)})).toThrow();
 });
});
