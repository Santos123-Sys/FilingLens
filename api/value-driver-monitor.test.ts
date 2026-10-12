import { describe, expect, it } from "vitest";
import { compareMarketSnapshots, marketFingerprint, parseWatchlist } from "./value-driver-monitor";
import type { LiveMarketSnapshot } from "./value-driver-provider";
function snapshot(price:number,ts:string,revenue:number):LiveMarketSnapshot {
 return {symbol:"AAPL",provider:"yahoo_finance_unofficial",retrievedAt:ts,quote:{
  symbol:"AAPL",currency:"USD",price,marketCapBn:4900,sharesBn:14.5,sharesBasis:"derived_market_cap_divided_by_price",
  observedAt:ts,retrievedAt:ts,source:"https://finance.yahoo.com/quote/AAPL/history/",
  delayed:true,stale:false,ageMinutes:1,
 },consensus:[{periodEnd:"FY2027",revenueAvgBn:revenue,revenueLowBn:null,revenueHighBn:null,ebitAvgBn:null,ebitLowBn:null,ebitHighBn:null,epsAvg:null,epsLow:null,epsHigh:null,analystCountRevenue:null,analystCountEps:null}],
 consensusSource:"https://finance.yahoo.com/quote/AAPL/analysis/",
 consensusAsOf:ts,quoteError:null,consensusError:null,status:"ready",guardrails:[]};
}
describe("idempotent hourly value driver market monitoring",()=>{
 it("sanitizes watchlist and applies a bound",()=>{
  expect(parseWatchlist("aapl,MSFT,AAPL,../private,PETR4.SA")).toEqual(["AAPL","MSFT","PETR4.SA"]);
 });
 it("does not treat retrieval-time changes as market changes",()=>{
  const a=snapshot(300,"2026-10-12T12:00:00Z",500);
  const b={...a,retrievedAt:"2026-10-12T16:00:00Z",consensusAsOf:"2026-10-12T16:00:00Z"};
  expect(compareMarketSnapshots(a,b)).toHaveLength(0);
  expect(marketFingerprint(a)).toBe(marketFingerprint(b));
 });
 it("detects bounded price and consensus revision alerts but not minor noise",()=>{
  const a=snapshot(300,"2026-10-12T12:00:00Z",500);
  const b=snapshot(318,"2026-10-12T13:00:00Z",520);
  const signals=compareMarketSnapshots(a,b);
  expect(signals).toHaveLength(2);
  expect(signals.find(s=>s.type==="quote_price_change")!.magnitudePct).toBeCloseTo(6);
  expect(signals.find(s=>s.type==="consensus_revenue_revision")!.magnitudePct).toBeCloseTo(4);
  expect(compareMarketSnapshots(a,snapshot(301,"2026-10-12T13:00:00Z",501))).toHaveLength(0);
 });
 it("does not compare old FMP data against newly activated Yahoo observations",()=>{
  const a=snapshot(300,"2026-10-12T12:00:00Z",500);
  const b=snapshot(330,"2026-10-12T13:00:00Z",530);
  expect(compareMarketSnapshots({...a,provider:"financialmodelingprep"} as unknown as LiveMarketSnapshot,b)).toEqual([]);
 });
 it("cannot fabricate a comparator on the first monitoring run",()=>{
  expect(compareMarketSnapshots(null,snapshot(300,"2026-10-12T12:00:00Z",500))).toEqual([]);
 });
});
