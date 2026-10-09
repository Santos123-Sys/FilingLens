import { describe,expect,it } from "vitest";
import {compareFilingAnalyses} from "./filing-change-intelligence";
const source = {kind:"excerpt",section:"Consolidated statements",quote:"Revenue was reported as shown."};
const fixture = (filedAt:string,years:string[],revenue:number[]) => ({
 schemaVersion:"2.0",jurisdiction:"us",
 company:{name:"Apple Inc.",ticker:"AAPL",exchange:"NASDAQ",periodEnd:years.at(-1),filedAt},
 metadata:{cik:"0000320193",fiscalYearEnd:"09-27"},
 financials:{unit:"USD millions",accountingBasis:"us_gaap",statementScope:"consolidated",
  years,revenue,netIncome:revenue.map(x=>x/5),
  evidence:years.map((period,i)=>({metric:"revenue",period,source:{...source,quote:`Revenue ${revenue[i]}`}}))},
 risks:[{title:"Competition",category:"market",severity:3,summary:"Competition."}],
});
describe("Phase 3 filing-to-filing change intelligence",()=>{
 it("flags only overlapping same-FY figures and separates new periods",()=>{
  const previous=fixture("2025-01-01",["FY2023","FY2024"],[100,120]);
  const current=fixture("2026-01-01",["FY2024","FY2025"],[122,140]);
  const report=compareFilingAnalyses(previous,current);
  expect(report.status).toBe("ready");
  expect(report.addedPeriods).toEqual(["FY2025"]);
  expect(report.removedPeriods).toEqual(["FY2023"]);
  expect(report.changes.filter(x=>x.metric==="revenue")).toMatchObject([{
   period:"FY2024",previous:120,current:122,status:"review_with_two_sources",
  }]);
  expect(report.changes.some(x=>x.period==="FY2025")).toBe(false);
 });
 it("rejects another CIK even if issuer name matches",()=>{
  const p=fixture("2025-01-01",["FY2024"],[100]);
  const c=fixture("2026-01-01",["FY2024"],[105]);
  c.metadata.cik="0000789019";
  expect(compareFilingAnalyses(p,c).status).toBe("identity_mismatch");
 });
 it("rejects reversed or absent filing dates",()=>{
  const p=fixture("2025-01-01",["FY2024"],[100]);
  const c=fixture("2024-01-01",["FY2024"],[105]);
  expect(compareFilingAnalyses(p,c).status).toBe("incomparable");
  c.company.filedAt="not-a-date";
  expect(compareFilingAnalyses(p,c).status).toBe("incomparable");
 });
 it("excludes currency, scale, accounting standard, scope and fiscal year end mismatches",()=>{
  const p=fixture("2025-01-01",["FY2024"],[100]);
  const c=fixture("2026-01-01",["FY2024"],[105]);
  for(const modify of [
   (x:typeof c)=>{x.financials.unit="USD thousands";},
   (x:typeof c)=>{x.financials.accountingBasis="ifrs";},
   (x:typeof c)=>{x.financials.statementScope="standalone";},
   (x:typeof c)=>{x.metadata.fiscalYearEnd="12-31";},
  ]) {
   const changed=structuredClone(c);modify(changed);
   const report=compareFilingAnalyses(p,changed);
   expect(report.status).toBe("ready");
   expect(report.changes).toEqual([]);
   expect(report.exclusions.length).toBeGreaterThan(0);
  }
 });
 it("does not invent percentage growth from a zero base",()=>{
  const p=fixture("2025-01-01",["FY2024"],[0]);
  const c=fixture("2026-01-01",["FY2024"],[5]);
  expect(compareFilingAnalyses(p,c).changes.find(x=>x.metric==="revenue")?.percentChange).toBeNull();
 });
 it("treats missing evidence as a review flag rather than corroboration",()=>{
  const p=fixture("2025-01-01",["FY2024"],[100]);
  const c=fixture("2026-01-01",["FY2024"],[110]);
  c.financials.evidence=[];
  expect(compareFilingAnalyses(p,c).changes.find(x=>x.metric==="revenue")?.status).toBe("missing_source");
 });
 it("compares risk titles as wording only",()=>{
  const p=fixture("2025-01-01",["FY2024"],[100]);
  const c=fixture("2026-01-01",["FY2024"],[100]);
  c.risks[0].title="Supply chain concentration";
  const report=compareFilingAnalyses(p,c);
  expect(report.addedRiskTitles).toEqual(["Supply chain concentration"]);
  expect(report.removedRiskTitles).toEqual(["Competition"]);
  expect(report.notes.join(" ")).toContain("wording");
 });
 it("rejects non-FilingLens JSON and duplicate fiscal period labels",()=>{
  expect(compareFilingAnalyses({schemaVersion:"1.0"},{}).status).toBe("invalid_input");
  const p=fixture("2025-01-01",["FY2024","2024"],[100,101]);
  const c=fixture("2026-01-01",["FY2024"],[105]);
  const report=compareFilingAnalyses(p,c);
  expect(report.changes.filter(x=>x.metric==="revenue")).toEqual([]);
  expect(report.exclusions.some(x=>x.includes("revenue"))).toBe(true);
 });
});
