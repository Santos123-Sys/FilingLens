import {describe,it,expect} from "vitest";
import {verifyBulkMember,parseBulkCiks,OFFICIAL_COMPANYFACTS_ARCHIVE} from "./sec-bulk-import";
const raw={cik:320193,entityName:"APPLE INC.",facts:{"us-gaap":{
 RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{
  accn:"0000320193-25-000079",form:"10-K",fp:"FY",
  start:"2025-01-01",end:"2025-12-31",val:300000000,
 }]}}
}}};
describe("compliant SEC official bulk archive member parser",()=>{
 it("accepts only exact CIK and supported SEC GAAP taxonomies",()=>{
  const out=verifyBulkMember("0000320193",Buffer.from(JSON.stringify(raw)));
  expect(out.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(out.payloadJson).entityName).toBe("APPLE INC.");
  expect(OFFICIAL_COMPANYFACTS_ARCHIVE).toContain("sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip");
 });
 it("rejects wrong issuer and custom unsupported taxonomies",()=>{
  expect(()=>verifyBulkMember("0000320194",Buffer.from(JSON.stringify(raw)))).toThrow();
  const modified={...raw,facts:{custom:{}}};
  expect(()=>verifyBulkMember("0000320193",Buffer.from(JSON.stringify(modified)))).toThrow();
 });
 it("rejects malformed or oversize bulk members",()=>{
  expect(()=>verifyBulkMember("foo",Buffer.from(JSON.stringify(raw)))).toThrow();
  expect(()=>verifyBulkMember("0000320193",Buffer.alloc(12_000_001))).toThrow();
  expect(()=>verifyBulkMember("0000320193",Buffer.from("invalid".repeat(30)))).toThrow();
 });
});

describe("bounded multi-issuer SEC cohort import",()=>{
 it("accepts a single CIK and several explicit unique CIKs",()=>{
  expect(parseBulkCiks("0000320193")).toEqual(["0000320193"]);
  expect(parseBulkCiks(undefined,"0000320193,0000789019")).toEqual(["0000320193","0000789019"]);
 });
 it("fails closed on ambiguous input, duplicates, invalid identity and excessive batch",()=>{
  expect(()=>parseBulkCiks()).toThrow();
  expect(()=>parseBulkCiks("0000320193","0000789019")).toThrow();
  expect(()=>parseBulkCiks(undefined,"0000320193,0000320193")).toThrow();
  expect(()=>parseBulkCiks(undefined,"0000320193,foo")).toThrow();
  expect(()=>parseBulkCiks(undefined,Array.from({length:13},(_,i)=>String(i+1).padStart(10,"0")).join(","))).toThrow();
 });
});
