import {describe,it,expect} from "vitest";
import {scenarioDcfLedger} from "./scenario-dcf-ledger";
import type {ValuationAssumption} from "./analysis";
const rows=()=>{
 const ids=["dcf.capex_pct_revenue",
  ...Array.from({length:5},(_,i)=>`dcf.revenue_growth_y${i+1}`),
  ...Array.from({length:5},(_,i)=>`dcf.ebit_margin_y${i+1}`),"dcf.terminal_growth"];
 return ids.map(id=>({id,method:"dcf",category:"forecast",label:id,proposed_value:7,final_value:7,
  confidence:"medium",impact:"high",status:"accepted",rationale:"base"})) as ValuationAssumption[];
};
const input={name:"bull" as const,probabilityPercent:25,revenueGrowthPercent:10,ebitMarginPercent:20,capexPercentRevenue:5};
describe("scenario DCF ledger",()=>{
 it("adjusts all 5 years and capex without changing accepted base ledger",()=>{
  const base=rows(),copy=scenarioDcfLedger(base,input);
  expect(copy.filter(x=>x.id.startsWith("dcf.revenue_growth_y")).every(x=>x.final_value===10)).toBe(true);
  expect(copy.filter(x=>x.id.startsWith("dcf.ebit_margin_y")).every(x=>x.final_value===20)).toBe(true);
  expect(copy.find(x=>x.id==="dcf.capex_pct_revenue")?.final_value).toBe(5);
  expect(copy.find(x=>x.id==="dcf.terminal_growth")?.final_value).toBe(7);
  expect(base.every(x=>x.final_value===7)).toBe(true);
 });
 it("refuses unapproved assumptions or rejected required drivers",()=>{
  const pending=rows();pending[0].status="proposed";
  expect(()=>scenarioDcfLedger(pending,input)).toThrow();
  const rejected=rows();rejected[1].status="rejected";
  expect(()=>scenarioDcfLedger(rejected,input)).toThrow();
 });
 it("requires all 5-year assumption rows",()=>{
  expect(()=>scenarioDcfLedger(rows().filter(x=>x.id!=="dcf.ebit_margin_y5"),input)).toThrow();
 });
});
