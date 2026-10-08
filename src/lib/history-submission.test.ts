import {describe,it,expect} from "vitest";
import {buildHistorySubmission} from "./history-submission";
import type {FilingAnalysis} from "@contracts/analysis";
const sample={
 jurisdiction:"us",
 company:{name:"Example",filingType:"10-K",periodEnd:"2025-12-31",filedAt:"2026-02-01",filingReference:"SEC-2025"},
 metadata:{cik:"0000123456",cnpj:null,filedAt:"2026-02-01"},
 financials:{unit:"USD millions",years:["2024","2025"],revenue:[100,150],netIncome:[10,18],evidence:[{metric:"revenue",period:"2025",source:{section:"Income statement"}}]},
} as unknown as FilingAnalysis;
describe("browser history filing mapping",()=>{
 it("limits ingestion to exact latest annual filing period",()=>{
  const result=buildHistorySubmission(sample);
  expect(result?.periods).toEqual([{label:"2025",endDate:"2025-12-31",fiscalYear:2025,periodKind:"FY"}]);
  expect(result?.financials.revenue).toEqual([150]);
  expect(result?.currency).toBe("USD");
 });
 it("does not infer quarterly as annual history",()=>{
  expect(buildHistorySubmission({...sample,company:{...sample.company,filingType:"10-Q"}})).toBeNull();
 });
 it("rejects mismatched fiscal labels",()=>{
  expect(buildHistorySubmission({...sample,company:{...sample.company,periodEnd:"2023-12-31"}})).toBeNull();
 });
 it("rejects unknown units and unsupported identity",()=>{
  expect(buildHistorySubmission({...sample,financials:{...sample.financials,unit:"units"}})).toBeNull();
  expect(buildHistorySubmission({...sample,metadata:{...sample.metadata,cik:null}})).toBeNull();
 });
});
