import { describe, expect, it } from "vitest";
import { fetchValueDriverMarketSnapshot, normalizeConsensus, normalizeQuote, normalizeTicker, MarketProviderError } from "./value-driver-provider";
const instant=new Date("2026-10-12T16:00:00.000Z");
const timestamp=Math.floor(instant.getTime()/1000)-60;
const quote={symbol:"AAPL",price:336.64,marketCap:4912000000000,timestamp};
const profile={symbol:"AAPL",currency:"USD"};
const estimates=[{symbol:"AAPL",date:"2026-09-26",revenueAvg:477850000000,revenueLow:450000000000,revenueHigh:510000000000,ebitAvg:156400000000,epsAvg:8.83,numAnalystsRevenue:40,numAnalystsEps:36}];
function mockFetch(data:Record<string,unknown>, status=200):typeof fetch {
 return (async (input:string|URL) => {
   const url=new URL(String(input));
   const path=url.pathname.split("/").at(-1);
   const response=path==="quote"?data.quote:path==="profile"?data.profile:data.estimates;
   return new Response(JSON.stringify(response),{status,headers:{"content-type":"application/json"}});
 }) as typeof fetch;
}
describe("licensed external quote and consensus adapter",()=>{
 it("rejects URL/SSRF-like tickers and restricts symbol syntax",()=>{
   expect(normalizeTicker("aapl")).toBe("AAPL");
   expect(normalizeTicker("petr4.sa")).toBe("PETR4.SA");
   expect(normalizeTicker("https://evil.example")).toBeNull();
   expect(normalizeTicker("AAPL?apikey=evil")).toBeNull();
   expect(normalizeTicker("../env")).toBeNull();
 });
 it("normalizes provider quote, capitalized shares, UTC source age and low/high estimate bounds",async()=>{
   const x=await fetchValueDriverMarketSnapshot("AAPL",{
     apiKey:"sample-test-secret",now:instant,
     fetcher:mockFetch({quote:[quote],profile:[profile],estimates}),
   });
   expect(x.status).toBe("ready");
   expect(x.quote?.price).toBe(336.64);
   expect(x.quote?.sharesBn).toBeCloseTo(4912/336.64,5);
   expect(x.quote?.ageMinutes).toBe(1);
   expect(x.quote?.currency).toBe("USD");
   expect(x.quote?.sharesBasis).toBe("derived_market_cap_divided_by_price");
   expect(x.consensus[0].revenueAvgBn).toBeCloseTo(477.85);
   expect(x.consensus[0].analystCountRevenue).toBe(40);
   expect(x.consensusAsOf).toBe(instant.toISOString());
   expect(JSON.stringify(x)).not.toContain("sample-test-secret");
 });
 it("keeps a partial quote when consensus coverage is unavailable",async()=>{
   const x=await fetchValueDriverMarketSnapshot("AAPL",{
     apiKey:"a-test-key",now:instant,fetcher:mockFetch({quote:[quote],profile:[profile],estimates:[]}),
   });
   expect(x.status).toBe("partial");
   expect(x.quote?.price).toBe(336.64);
   expect(x.consensus).toEqual([]);
   expect(x.consensusError).toBe("no_covered_estimates");
 });
 it("prevents stale/future quotes and mismatched issuer symbols",()=>{
   expect(()=>normalizeQuote({...quote,timestamp:timestamp-40*86400},profile,"AAPL",instant)).toThrow();
   expect(()=>normalizeQuote({...quote,timestamp:timestamp+2*86400},profile,"AAPL",instant)).toThrow();
   expect(()=>normalizeQuote(quote,profile,"MSFT",instant)).toThrow();
 });
 it("does not accept forecast records dated implausibly far out or wrong issuer",()=>{
   const rows=normalizeConsensus([...estimates,{...estimates,symbol:"MSFT"},{...estimates,date:"2090-01-01"}],"AAPL",instant);
   expect(rows).toHaveLength(1);
 });
 it("returns explicit credential error, not a fabricated result",async()=>{
   await expect(fetchValueDriverMarketSnapshot("AAPL",{apiKey:"",now:instant})).rejects.toMatchObject({code:"not_configured"});
   expect(new MarketProviderError("limited_access").code).toBe("limited_access");
 });
 it("never calls a URL provided in the symbol",async()=>{
   await expect(fetchValueDriverMarketSnapshot("http://private-bridge",{apiKey:"fake",fetcher:mockFetch({quote:[quote]})})).rejects.toThrow();
 });
});
