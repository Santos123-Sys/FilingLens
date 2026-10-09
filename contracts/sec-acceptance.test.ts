import {describe,it,expect} from "vitest";
import {evaluateSecAcceptance} from "./sec-acceptance";

const sourceUrl="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/annual.htm";
const input={
 cik:"0000320193",peerName:"Apple Inc.",filingUrl:sourceUrl,metric:"Revenue",
 fiscalYear:2025,periodEnd:"2025-09-27",basis:"US GAAP" as const,
 currency:"USD" as const,amountMillions:416161,
};
const syntheticFixture={cik:320193,entityName:"APPLE INC.",facts:{"us-gaap":{
 RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{
  accn:"0000320193-25-000079",form:"10-K",fp:"FY",fy:2025,
  start:"2024-09-29",end:"2025-09-27",val:416161000000,
 }]}}
}}};
describe("SEC post-import real-data acceptance gate (synthetic test fixture only)",()=>{
 it("matches same-accession amount and detects three adverse mutations",()=>{
  const out=evaluateSecAcceptance(input,syntheticFixture);
  expect(out.passed).toBe(true);
  expect(out.proof.status).toBe("verified");
  expect(out.negativeControls).toEqual({
   amount:"amount_mismatch",cik:"identity_mismatch",accession:"source_mismatch",
  });
 });
 it("rejects issuer mismatch or absent official taxonomy amounts",()=>{
  expect(evaluateSecAcceptance(input,{...syntheticFixture,cik:100}).passed).toBe(false);
  expect(evaluateSecAcceptance(input,{...syntheticFixture,facts:{"us-gaap":{}}}).passed).toBe(false);
 });
 it("rejects malformed or mismatched source identity up front",()=>{
  expect(()=>evaluateSecAcceptance({...input,filingUrl:"https://example.com/filing"},syntheticFixture)).toThrow();
  expect(()=>evaluateSecAcceptance({...input,cik:"0000789019"},syntheticFixture)).toThrow();
  expect(()=>evaluateSecAcceptance({...input,amountMillions:Number.NaN},syntheticFixture)).toThrow();
 });
 it("detects incorrect fiscal year amount even when the SEC record exists",()=>{
  expect(evaluateSecAcceptance({...input,amountMillions:999999},syntheticFixture).passed).toBe(false);
 });
});
