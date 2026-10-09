import {describe,it,expect} from "vitest";
import {prepareSecOperatorJson} from "./sec-operator-json";
const frozen=Date.parse("2026-10-09T12:00:00Z");
const issuer={cik:320193,entityName:"APPLE INC.",facts:{"us-gaap":{
 RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{
  accn:"0000320193-25-000079",form:"10-K",fp:"FY",fy:2025,
  start:"2024-09-29",end:"2025-09-27",val:416161000000,
 }]}}
}}};
const bytes=Buffer.from(JSON.stringify(issuer));
describe("operator-attested SEC CompanyFacts individual JSON import",()=>{
 it("validates exact CIK and canonical SEC source URL and hashed bytes",()=>{
  const p=prepareSecOperatorJson("0000320193",bytes,"2026-10-09",frozen);
  expect(p.sourceMode).toBe("operator_attested_sec_json");
  expect(p.sourceUrl).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json");
  expect(p.sourceFileSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(p.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(p.payloadJson).cik).toBe(320193);
 });
 it("rejects wrong issuer, invalid JSON and unsupported taxonomy",()=>{
  expect(()=>prepareSecOperatorJson("0000789019",bytes,"2026-10-09",frozen)).toThrow();
  expect(()=>prepareSecOperatorJson("0000320193",Buffer.from("x".repeat(120)),"2026-10-09",frozen)).toThrow();
  const wrong=Buffer.from(JSON.stringify({...issuer,facts:{custom:{}}}));
  expect(()=>prepareSecOperatorJson("0000320193",wrong,"2026-10-09",frozen)).toThrow();
 });
 it("rejects malformed, impossible, stale or future retrieval dates",()=>{
  for(const day of ["2026-10-9","2026-02-30","2026-09-01","2026-10-10"]){
   expect(()=>prepareSecOperatorJson("0000320193",bytes,day,frozen)).toThrow();
  }
 });
 it("rejects oversize JSON files",()=>{
  expect(()=>prepareSecOperatorJson("0000320193",Buffer.alloc(12_000_001), "2026-10-09",frozen)).toThrow();
 });
});
