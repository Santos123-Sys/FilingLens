import { describe, expect, it } from "vitest";
import type { MarketResult } from "./analysis";
import { buildSegmentIntelligence,parseSegmentPeriod } from "./segment-intelligence";
const source={section:"Segment note",kind:"excerpt" as const,quote:"Segment A and B revenue and operating income are shown in USD millions"};
const mk=(periods:string[],currency="USD",unit="millions"):MarketResult["market"]=>({
 industry:"",competitors:[],geographies:[],segments:[
  {name:"A",revenue:[100,120],earnings:[20,30],periods,unit,currency,sourceType:"filing",source},
  {name:"B",revenue:[50,80],earnings:[5,8],periods,unit,currency,sourceType:"filing",source},
 ]});
describe("Phase 2 segment economics",()=>{
 it("does not mix FY and quarterly periods",()=>{
  expect(parseSegmentPeriod("FY2025")?.key).toBe("FY:2025");
  expect(parseSegmentPeriod("Q2 2025")?.key).toBe("Q:2025:2");
  expect(parseSegmentPeriod("YTD 2025")).toBeNull();
  expect(parseSegmentPeriod("LTM 2025")).toBeNull();
 });
 it("calculates source-aligned YoY margins and explicitly denominated mix",()=>{
  const actual=buildSegmentIntelligence(mk(["FY2024","FY2025"]));
  expect(actual.segments[0].observations[1].yoyRevenuePercent).toBe(20);
  expect(actual.segments[0].observations[1].marginPercent).toBe(25);
  expect(actual.segments[0].observations[1].shareOfReportedSegmentsPercent).toBe(60);
  expect(actual.mixPeriod).toBe("FY2025");
 });
 it("does not calculate mix when units differ",()=>{
  const market=mk(["FY2024","FY2025"]);
  market.segments[1].unit="thousands";
  const actual=buildSegmentIntelligence(market);
  expect(actual.mixPeriod).toBeNull();
  expect(actual.flags.some(x=>x.code==="MIX_NOT_COMPARABLE")).toBe(true);
 });
 it("rejects periods with mismatched revenue or earnings lengths",()=>{
  const market=mk(["FY2024","FY2025"]);
  market.segments[0].earnings=[5];
  const actual=buildSegmentIntelligence(market);
  expect(actual.segments.map(s=>s.name)).toEqual(["B"]);
  expect(actual.flags.some(x=>x.code==="PERIOD_ALIGNMENT")).toBe(true);
 });
 it("rejects duplicate and non-annual period aliases",()=>{
  const market=mk(["FY2025","2025"]);
  const actual=buildSegmentIntelligence(market);
  expect(actual.segments).toHaveLength(0);
  expect(actual.flags.some(x=>x.code==="DUPLICATE_PERIOD")).toBe(true);
 });
 it("requires exact quoted filing evidence",()=>{
  const market=mk(["FY2024","FY2025"]);
  market.segments[0].source={section:"Note 3",quote:null};
  expect(buildSegmentIntelligence(market).segments).toHaveLength(1);
 });
 it("prevents YoY with a negative or zero denominator",()=>{
  const market=mk(["FY2024","FY2025"]);
  market.segments[0].revenue=[0,120];
  const actual=buildSegmentIntelligence(market);
  expect(actual.segments[0].observations[1].yoyRevenuePercent).toBeNull();
 });
 it("does not mistake aligned but differently defined quarterly periods as FY",()=>{
  const actual=buildSegmentIntelligence(mk(["Q2 2024","Q2 2025"]));
  expect(actual.segments[0].observations[1].yoyRevenuePercent).toBe(20);
  expect(actual.segments[0].observations[1].period).toBe("Q2 2025");
 });
});
