import {describe,expect,it} from "vitest";
import {buildDecisionMateriality} from "./decision-materiality";
import type {FilingAnalysis, DcfValuationResult} from "./analysis";
import type {FilingDelta} from "./filing-change-intelligence";
const fig=(value:number,unit="USD/share")=>({value,unit,assumption_ids:[]});
const dcf=():DcfValuationResult=>({
 method:"dcf",status:"complete",projections:[],
 figures:{wacc:fig(10,"%"),terminal_growth:fig(2,"%"),terminal_value:fig(100),
  enterprise_value:fig(200),equity_value:fig(150),implied_per_share:fig(50)},
 sensitivity:{wacc:[9,9.5,10,10.5,11],terminal_growth:[1.5,1.75,2,2.25,2.5],
  values:Array.from({length:5},(_,i)=>Array.from({length:5},(_,j)=>
   50-(i-2)*5+(j-2)*2))},
 scenarios:{bull:fig(70),base:fig(50),bear:fig(30)},notes:[],
});
const data=()=>({
 valuation:{dcf:dcf(),assumptions:{dcf:[
  {id:"dcf.wacc",label:"WACC",method:"dcf",status:"accepted",
   source:null,confidence:"low",impact:"high",proposed_value:10,
   category:"cost",rationale:"Analyst input"},
  {id:"dcf.terminal_growth",label:"Terminal growth",method:"dcf",status:"edited",
   source:{kind:"citation",section:"Source",url:"https://example.com/report"},
   confidence:"medium",impact:"high",proposed_value:2,category:"terminal",rationale:"Input"},
 ]}},
 missingData:["Net debt disclosure unavailable"],
}) as unknown as FilingAnalysis;
const delta={
 status:"ready",changes:[{metric:"revenue",period:"FY2024",previous:100,current:105,
  difference:5,percentChange:5,status:"missing_source",
  evidence:{previous:null,current:null}}],
 exclusions:[],
} as unknown as FilingDelta;
describe("Phase 4 decision materiality",()=>{
 it("ranks local DCF WACC and terminal growth from a center-validated grid",()=>{
  const r=buildDecisionMateriality(data());
  expect(r.valuationStatus).toBe("ready");
  expect(r.sensitivities.map(x=>x.driver)).toEqual(["wacc","terminal_growth"]);
  expect(r.sensitivities.map(x=>x.deltaPerOnePercentagePoint)).toEqual([-10,8]);
  expect(r.sensitivities[0].method).toBe("local_central_difference");
 });
 it("fails closed on grid center mismatch",()=>{
  const x=data();x.valuation!.dcf!.sensitivity.values[2][2]=999;
  const r=buildDecisionMateriality(x);
  expect(r.valuationStatus).toBe("inconsistent_grid");
  expect(r.sensitivities).toEqual([]);
 });
 it("fails closed on nonmonotonic axes and null neighboring grid cells",()=>{
  const x=data();x.valuation!.dcf!.sensitivity.wacc[3]=9;
  expect(buildDecisionMateriality(x).valuationStatus).toBe("inconsistent_grid");
  const y=data();y.valuation!.dcf!.sensitivity.values[1][2]=null;
  expect(buildDecisionMateriality(y).valuationStatus).toBe("inconsistent_grid");
 });
 it("does not manufacture valuation sensitivities without approved DCF",()=>{
  const x=data();delete x.valuation!.dcf;
  const r=buildDecisionMateriality(x);
  expect(r.valuationStatus).toBe("no_approved_dcf");
  expect(r.sensitivities).toEqual([]);
 });
 it("prioritizes uncited filing differences and assumptions ahead of missing data",()=>{
  const r=buildDecisionMateriality(data(),delta);
  expect(r.reviewQueue.map(x=>x.kind)).toEqual([
   "filing_discrepancy","assumption_evidence","missing_data"]);
  expect(r.reviewQueue[0].priority).toBe("review_source");
  expect(r.reviewQueue[1].title).toBe("WACC");
  expect(r.reviewQueue.some(x=>x.title==="Terminal growth")).toBe(false);
 });
 it("does not label any discrepancy as a confirmed restatement",()=>{
  const r=buildDecisionMateriality(data(),delta);
  expect(r.reviewQueue[0].detail).toContain("verify original filings");
  expect(r.reviewQueue.every(x=>!x.detail.includes("confirmed restatement"))).toBe(true);
 });
});
