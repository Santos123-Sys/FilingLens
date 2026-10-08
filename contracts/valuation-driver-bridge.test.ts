import {describe,it,expect} from "vitest";
import type {FilingAnalysis,DcfValuationResult} from "./analysis";
import {buildValuationDriverBridge} from "./valuation-driver-bridge";
import type {DriverScenario} from "./valuation-driver-bridge";
const quote=(metric:string,period:string)=>({metric,period,source:{section:"Audited statements",kind:"excerpt" as const,quote:"Financial line item from statements"}});
const fixture=()=>({
 financials:{unit:"USD millions",years:["FY2024","FY2025"],revenue:[100,120],
  ebit:[10,18],capex:[8,12],evidence:[
   quote("revenue","FY2024"),quote("revenue","FY2025"),
   quote("ebit","FY2025"),quote("capex","FY2025")]},
 market:{competitiveAnalysis:{peerProfiles:[{name:"Peer",outlook:{
  stance:"mixed",summary:"Cited peer outlook",source:{section:"Peer investor materials",kind:"citation",url:"https://investor.example.com/outlook"}
 }}]}},
} as unknown as FilingAnalysis);
const inputs:DriverScenario[]=[
 {name:"bear",probabilityPercent:25,revenueGrowthPercent:0,ebitMarginPercent:8,capexPercentRevenue:12},
 {name:"base",probabilityPercent:50,revenueGrowthPercent:10,ebitMarginPercent:15,capexPercentRevenue:10},
 {name:"bull",probabilityPercent:25,revenueGrowthPercent:20,ebitMarginPercent:22,capexPercentRevenue:8},
];
describe("Phase 2 valuation driver bridge",()=>{
 it("extracts source-supported FY growth, EBIT margin and capex intensity",()=>{
  const result=buildValuationDriverBridge(fixture(),inputs);
  expect(result.status).toBe("ready");
  expect(result.historical.map(x=>x.status)).toEqual(["supported","supported","supported"]);
  expect(result.historical.map(x=>x.valuePercent)).toEqual([20,15,10]);
 });
 it("does not fabricate scenarios from missing source citations",()=>{
  const d=fixture();d.financials.evidence=[];
  const r=buildValuationDriverBridge(d,inputs);
  expect(r.status).toBe("missing_evidence");
  expect(r.scenarios).toHaveLength(0);
 });
 it("never combines mismatched annual financial periods",()=>{
  const d=fixture();d.financials.capex=[12];
  const r=buildValuationDriverBridge(d,inputs);
  expect(r.status).toBe("missing_evidence");
 });
 it("requires explicit scenarios and exact probability total",()=>{
  const r=buildValuationDriverBridge(fixture(),inputs.map(x=>({...x,probabilityPercent:30})));
  expect(r.status).toBe("invalid_assumptions");
  expect(r.scenarios).toHaveLength(0);
 });
 it("calculates forward operating contribution, ranks sensitivity, without inventing EV",()=>{
  const r=buildValuationDriverBridge(fixture(),inputs);
  const base=r.scenarios.find(x=>x.scenario==="base")!;
  expect(base.thirdYearRevenue).toBeCloseTo(159.72,6);
  expect(base.thirdYearEbitLessCapex).toBeCloseTo(7.986,6);
  expect(r.sensitivity[0].name).toBe("ebitMargin");
  expect(r.dcfLink).toBeNull();
 });
 it("links only an actually completed DCF, not a fabricated valuation",()=>{
  const dcf={status:"complete",figures:{implied_per_share:{value:123}},
   sensitivity:{wacc:[8,9],terminal_growth:[2,3]}}
  as unknown as DcfValuationResult;
  const r=buildValuationDriverBridge(fixture(),inputs,dcf);
  expect(r.dcfLink?.status).toBe("validated_dcf");
  expect(r.dcfLink?.perShareBase).toBe(123);
 });
 it("keeps peer outlook separate from management guidance",()=>{
  const r=buildValuationDriverBridge(fixture(),inputs);
  expect(r.peerOutlooks).toHaveLength(1);
  expect(r.guidance).toHaveLength(0);
 });
});
