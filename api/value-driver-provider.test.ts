import { describe, expect, it } from "vitest";
import { fetchValueDriverMarketSnapshot, normalizeConsensus, normalizeQuote, normalizeTicker, MarketProviderError } from "./value-driver-provider";
const instant=new Date("2026-10-12T16:00:00.000Z");
const quote={price:336.64,marketCap:4912000000000,currency:"USD",
 tradingDate:"2026-10-09",observedAt:"2026-10-09T00:00:00.000Z",priceBasis:"unadjusted_daily_close"};
const estimates=[
 {periodEnd:"FY2027",periodBasis:"fiscal_year_inferred_from_last_reported_year",yahooBucket:"0y",
  revenueAvg:477850000000,revenueLow:450000000000,revenueHigh:510000000000,
  epsAvg:8.83,epsLow:8,epsHigh:9.4,numAnalystsRevenue:40,numAnalystsEps:36,
  epsTrend30dAgo:8.3,epsRevisionsUp30d:12,epsRevisionsDown30d:2}
];
const payload=(q:unknown=quote,e:unknown=estimates)=>({symbol:"AAPL",quote:q,consensus:e,quoteError:null,consensusError:null,warnings:[]});
describe("Yahoo Finance personal research bridge and contract",()=>{
 it("rejects symbols that could cause subprocess injection",()=>{
  expect(normalizeTicker("aapl")).toBe("AAPL");
  expect(normalizeTicker("petr4.sa")).toBe("PETR4.SA");
  for(const s of ["https://evil.example","AAPL?apikey=x","../env","AAPL;rm -rf /","AAPL\\nMSFT"])
   expect(normalizeTicker(s)).toBeNull();
 });
 it("normalizes daily close, UTC trading day, unadjusted price and incomplete EBIT",async()=>{
  const x=await fetchValueDriverMarketSnapshot("AAPL",{now:instant,runner:async()=>payload()});
  expect(x.status).toBe("ready");
  expect(x.provider).toBe("yahoo_finance_unofficial");
  expect(x.quote?.price).toBe(336.64);
  expect(x.quote?.tradingDate).toBe("2026-10-09");
  expect(x.quote?.priceBasis).toBe("unadjusted_daily_close");
  expect(x.quote?.sharesBn).toBeCloseTo(4912/336.64,5);
  expect(x.quote?.currency).toBe("USD");
  expect(x.consensus[0].revenueAvgBn).toBeCloseTo(477.85);
  expect(x.consensus[0].ebitAvgBn).toBeNull();
  expect(x.consensus[0].epsTrend30dAgo).toBe(8.3);
  expect(x.consensus[0].epsRevisionsUp30d).toBe(12);
  expect(x.consensusAsOf).toBe(instant.toISOString());
  expect(x.guardrails.some(s=>s.includes("personal research"))).toBe(true);
 });
 it("preserves a partial daily quote when analysts have no coverage",async()=>{
  const x=await fetchValueDriverMarketSnapshot("AAPL",{
   now:instant,runner:async()=>({...payload(quote,[]),consensusError:"no_covered_estimates"}),
  });
  expect(x.status).toBe("partial");
  expect(x.quote?.price).toBe(336.64);
  expect(x.consensusError).toBe("no_covered_estimates");
 });
 it("rejects invalid, old and fabricated intraday timestamp labels",()=>{
  expect(()=>normalizeQuote({...quote,observedAt:"2026-10-09T19:00:00.000Z"},"AAPL",instant)).toThrow();
  expect(()=>normalizeQuote({...quote,tradingDate:"2026-07-01",observedAt:"2026-07-01T00:00:00.000Z"},"AAPL",instant)).toThrow();
  expect(()=>normalizeQuote({...quote,currency:"USD?apikey=secret"},"AAPL",instant)).toThrow();
 });
 it("rejects invalid revenue ranges and implausible fiscal labels",()=>{
  expect(normalizeConsensus([...estimates,{...estimates,periodEnd:"FY2099"}],instant)).toHaveLength(1);
  expect(normalizeConsensus([{...estimates,revenueLow:500000000000,revenueHigh:450000000000}],instant)).toHaveLength(0);
 });
 it("does not construct fallback forecasts for malformed upstream data",async()=>{
  await expect(fetchValueDriverMarketSnapshot("AAPL",{runner:async()=>({symbol:"MSFT"})})).rejects.toMatchObject({code:"invalid_response"});
  await expect(fetchValueDriverMarketSnapshot("AAPL",{runner:async()=>{throw new Error("429")}})).rejects.toMatchObject({code:"unavailable"});
  await expect(fetchValueDriverMarketSnapshot("bad;url",{runner:async()=>payload()})).rejects.toThrow();
  expect(new MarketProviderError("limited_access").code).toBe("limited_access");
 });
});
