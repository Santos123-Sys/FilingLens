import {describe,it,expect} from "vitest";
import {collectSecHistoricalFacts,secHistoricalPeerCohorts} from "./sec-peer-history";
import type {SecCompanyFacts} from "./sec-peer-proof";
import type {MarketResult} from "./analysis";
const a={form:"10-K",fp:"FY",accn:"0000320193-25-000079"};
const data=(v2024=100000000,v2025=120000000):SecCompanyFacts=>({
 cik:320193,entityName:"APPLE INC.",facts:{"us-gaap":{
  RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[
   {...a,fy:2024,start:"2024-01-01",end:"2024-12-31",val:v2024},
   {...a,fy:2025,start:"2025-01-01",end:"2025-12-31",val:v2025},
  ]}},
  NetIncomeLoss:{units:{USD:[{...a,fy:2025,start:"2025-01-01",end:"2025-12-31",val:18000000}]}},
 }}
});
describe("SEC multi-year historical peer cohorts",()=>{
 it("extracts only official annual observations with declared SEC accession",()=>{
  const facts=collectSecHistoricalFacts("Apple Inc.","0000320193",data());
  expect(facts).toHaveLength(3);
  expect(facts.find(x=>x.metric==="revenue"&&x.year===2025)?.amountMillions).toBe(120);
  expect(facts.every(x=>x.source.url?.startsWith("https://data.sec.gov/api/xbrl/companyfacts/"))).toBe(true);
 });
 it("rejects wrong identity or CIK before loading historical records",()=>{
  expect(collectSecHistoricalFacts("Not Apple Inc.","0000320193",data())).toHaveLength(0);
  expect(collectSecHistoricalFacts("Apple Inc.","0000000001",data())).toHaveLength(0);
 });
 it("omits conflicting regulator tag/restatement amounts rather than choosing a number",()=>{
  const d=data();
  d.facts!["us-gaap"].Revenues={units:{USD:[{...a,fy:2025,start:"2025-01-01",end:"2025-12-31",val:110000000}]}};
  const facts=collectSecHistoricalFacts("Apple Inc.","0000320193",d);
  expect(facts.some(x=>x.metric==="revenue"&&x.year===2025)).toBe(false);
 });
 it("does not count interim 10-Q values as annual",()=>{
  const d=data();
  d.facts!["us-gaap"].NetIncomeLoss={units:{USD:[
   {...a,form:"10-Q",fy:2025,start:"2025-10-01",end:"2025-12-31",val:123}] }};
  expect(collectSecHistoricalFacts("Apple Inc.","0000320193",d).some(x=>x.metric==="netIncome")).toBe(false);
 });
 it("computes within-peer FY growth only from comparable 12-month source periods",()=>{
  const history=collectSecHistoricalFacts("Apple Inc.","0000320193",data());
  const peers=[{name:"Apple Inc.",officialHistory:history}] as unknown as
   NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"];
  const cohorts=secHistoricalPeerCohorts(peers);
  expect(cohorts.growth.find(x=>x.metric==="revenue")?.growthPercent).toBe(20);
 });
 it("does not compare peers with different fiscal year-ends",()=>{
  const h=collectSecHistoricalFacts("Apple Inc.","0000320193",data());
  const other=h.map(x=>({...x,periodEnd:x.periodEnd.replace("-12-31","-09-30")}));
  const peers=[{name:"A",officialHistory:h},{name:"B",officialHistory:other}] as unknown as
   NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"];
  expect(secHistoricalPeerCohorts(peers).matched).toHaveLength(0);
  const same=[{name:"A",officialHistory:h},{name:"B",officialHistory:h} ] as unknown as
   NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"];
  expect(secHistoricalPeerCohorts(same).matched.length).toBeGreaterThan(0);
 });
});
