import {describe,expect,it} from "vitest";
import type {FilingAnalysis} from "@contracts/analysis";
import {compareAnnualHistory} from "./HistoryWorkbench";
const analysis={
 jurisdiction:"us",
 financials:{
  unit:"USD millions",
  years:["FY2024","FY2025"],
  revenue:[100,125],
  netIncome:[10,12],
  annualHistory:{
   years:["FY2024","FY2025"],unit:"USD millions",provider:"sec_edgar",status:"partial",
   revenue:[100,140],grossProfit:[null,null],ebit:[null,null],netIncome:[10,12],
   operatingCashFlow:[null,null],capex:[null,null],totalAssets:[null,null],totalLiabilities:[null,null],
   totalEquity:[null,null],totalDebt:[null,null],cash:[null,null],sources:[]
  }
 }
} as unknown as FilingAnalysis;
describe("annual comparison",()=>{
 it("marks differing overlapping annual values as review flags",()=>{
  const rows=compareAnnualHistory(analysis);
  expect(rows.find(x=>x.year==="2025"&&x.metric==="revenue")?.discrepancy).toBe(true);
  expect(rows.find(x=>x.year==="2024"&&x.metric==="revenue")?.discrepancy).toBe(false);
 });
 it("preserves missing historical metrics instead of fabricating zero",()=>{
  const rows=compareAnnualHistory(analysis);
  expect(rows.find(x=>x.metric==="cash")?.missing).toBe(true);
 });
 it("never compares quarterly labels to annual years",()=>{
  const modified={...analysis,financials:{...analysis.financials,years:["Q1 2024","Q1 2025"]}};
  expect(compareAnnualHistory(modified).filter(x=>x.metric==="revenue").every(x=>x.filing===null)).toBe(true);
 });
 it("refuses comparisons across incompatible currency units",()=>{
  const modified={...analysis,financials:{...analysis.financials,unit:"BRL millions"}};
  expect(compareAnnualHistory(modified).filter(x=>x.metric==="revenue").every(x=>x.filing===null)).toBe(true);
 });
});
