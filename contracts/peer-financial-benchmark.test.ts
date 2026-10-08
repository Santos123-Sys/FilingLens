import {describe,expect,it} from "vitest";
import type {FilingAnalysis, EvidenceReference} from "./analysis";
import {buildPeerFinancialBenchmarks} from "./peer-financial-benchmark";
const source=(url="https://www.sec.gov/Archives/edgar/data/1/filing"):EvidenceReference=>
 ({section:"FY audited financial statements",kind:"citation",url});
const point=(label:string,value:string,period="FY2025",context="consolidated US GAAP; period end 2025-12-31",url?:string)=>
 ({label,value,period,context,source:source(url)});
const fixture=(points:ReturnType<typeof point>[],overrides:Record<string,unknown>={}):FilingAnalysis=>({
 jurisdiction:"us",
 company:{name:"Issuer",periodEnd:"2025-12-31"},
 financials:{unit:"USD millions",years:["FY2025"],revenue:[200],netIncome:[30],
  accountingBasis:"us_gaap",statementScope:"consolidated"},
 market:{competitiveAnalysis:{peerProfiles:[{name:"Peer A",dataPoints:points}]}}
 ,...overrides
} as unknown as FilingAnalysis);
describe("peer financial benchmark",()=>{
 it("normalizes scale, source and aligned issuer comparison",()=>{
  const r=buildPeerFinancialBenchmarks(fixture([point("Revenue","USD 0.3 billions"),point("Net income","USD 45 millions")]));
  expect(r.facts.map(x=>x.millions)).toEqual([300,45]);
  expect(r.margins[0].marginPercent).toBe(15);
  expect(r.comparisons.find(x=>x.metric==="revenue")?.differencePercent).toBe(50);
 });
 it("refuses mismatched periods, currencies and accounting frameworks",()=>{
  const a=buildPeerFinancialBenchmarks(fixture([point("Revenue","USD 300 millions","FY2024","consolidated US GAAP; period end 2024-12-31")]));
  expect(a.comparisons).toHaveLength(0);
  const b=buildPeerFinancialBenchmarks(fixture([point("Revenue","BRL 300 millions")]));
  expect(b.facts).toHaveLength(1);
  expect(b.comparisons).toHaveLength(0);
  const c=buildPeerFinancialBenchmarks(fixture([point("Revenue","USD 300 millions","FY2025","consolidated IFRS; period end 2025-12-31")]));
  expect(c.comparisons).toHaveLength(0);
 });
 it("rejects quarterly, LTM and YTD as FY facts",()=>{
  const r=buildPeerFinancialBenchmarks(fixture([
   point("Revenue","USD 300 millions","Q1 2025"),
   point("Revenue","USD 300 millions","LTM 2025"),
   point("Revenue","USD 300 millions","YTD 2025"),
  ]));
  expect(r.facts).toHaveLength(0);
 });
 it("rejects unsupported locale values and uncited facts",()=>{
  const r=buildPeerFinancialBenchmarks(fixture([
   point("Revenue","USD 1.234,56 millions"),
   point("Revenue","USD 300 millions","FY2025","consolidated US GAAP; period end 2025-12-31","http://example.com/fake"),
  ]));
  expect(r.facts).toHaveLength(0);
 });
 it("rejects unknown consolidation and missing fiscal period end",()=>{
  const r=buildPeerFinancialBenchmarks(fixture([
   point("Revenue","USD 300 millions","FY2025","US GAAP"),
   point("Revenue","USD 300 millions","FY2025","consolidated US GAAP"),
  ]));
  expect(r.facts).toHaveLength(0);
 });
 it("rejects duplicate figures rather than choosing whichever appears first",()=>{
  const r=buildPeerFinancialBenchmarks(fixture([
   point("Revenue","USD 300 millions"),point("Revenue","USD 450 millions")]));
  expect(r.facts).toHaveLength(0);
  expect(r.flags.some(f=>f.code==="DUPLICATE_FACT")).toBe(true);
 });
 it("excludes peer-vs-issuer comparisons with unknown issuer reporting basis",()=>{
  const d=fixture([point("Revenue","USD 300 millions")]);
  d.financials.accountingBasis="unknown";
  expect(buildPeerFinancialBenchmarks(d).comparisons).toHaveLength(0);
 });
 it("retains negative net income while computing negative net margins",()=>{
  const r=buildPeerFinancialBenchmarks(fixture([
   point("Revenue","USD 300 millions"),point("Net income","USD -30 millions")]));
  expect(r.margins[0].marginPercent).toBe(-10);
 });
 it("refuses year-end mismatch even for the same fiscal-year label",()=>{
  const r=buildPeerFinancialBenchmarks(fixture([
   point("Revenue","USD 300 millions","FY2025","consolidated US GAAP; period end 2025-09-30")]));
  expect(r.facts).toHaveLength(1);
  expect(r.comparisons).toHaveLength(0);
 });
});
