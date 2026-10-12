import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { registerValueDriverRoutes, yahooAuthorized } from "./value-driver-routes";
import type { LiveMarketSnapshot } from "./value-driver-provider";

const token="r".repeat(48);
const sample:LiveMarketSnapshot={
 symbol:"AAAT",provider:"yahoo_finance_unofficial",retrievedAt:"2026-10-12T16:00:00Z",
 quote:{symbol:"AAAT",currency:"USD",price:100,marketCapBn:100,sharesBn:1,
  sharesBasis:"derived_market_cap_divided_by_price",observedAt:"2026-10-09T00:00:00.000Z",
  retrievedAt:"2026-10-12T16:00:00Z",source:"https://finance.yahoo.com/quote/AAAT/history/",
  delayed:true,stale:false,ageMinutes:5200,tradingDate:"2026-10-09",priceBasis:"unadjusted_daily_close"},
 consensus:[{periodEnd:"FY2027",revenueAvgBn:50,revenueLowBn:48,revenueHighBn:52,
  ebitAvgBn:null,ebitLowBn:null,ebitHighBn:null,epsAvg:2,epsLow:1.8,epsHigh:2.3,
  analystCountRevenue:10,analystCountEps:10}],
 consensusSource:"https://finance.yahoo.com/quote/AAAT/analysis/",consensusAsOf:"2026-10-12T16:00:00Z",
 quoteError:null,consensusError:null,status:"ready",guardrails:[],
};
const originals={
 enabled:process.env.YAHOO_PERSONAL_USE_ENABLED,
 token:process.env.FILINGLENS_VALUATION_READ_API_TOKEN,
};
beforeEach(()=>{
 process.env.YAHOO_PERSONAL_USE_ENABLED="true";
 process.env.FILINGLENS_VALUATION_READ_API_TOKEN=token;
});
afterEach(()=>{
 if(originals.enabled===undefined)delete process.env.YAHOO_PERSONAL_USE_ENABLED;else process.env.YAHOO_PERSONAL_USE_ENABLED=originals.enabled;
 if(originals.token===undefined)delete process.env.FILINGLENS_VALUATION_READ_API_TOKEN;else process.env.FILINGLENS_VALUATION_READ_API_TOKEN=originals.token;
});
describe("private personal-use market routes",()=>{
 it("fails closed without a configured token",async()=>{
  const market=vi.fn(async()=>sample);
  const app=new Hono();registerValueDriverRoutes(app,{getMarket:market});
  const response=await app.request("/api/value-drivers/live/AAAT");
  expect(response.status).toBe(401);
  expect(market).not.toHaveBeenCalled();
  expect(yahooAuthorized("Bearer wrong")).toBe(false);
  expect(yahooAuthorized("Bearer "+token)).toBe(true);
 });
 it("prevents unauthenticated watchlist enumeration",async()=>{
  const app=new Hono();registerValueDriverRoutes(app);
  const response=await app.request("/api/value-drivers/status");
  const body=await response.json() as Record<string,unknown>;
  expect(body.monitoredSymbols).toEqual([]);
  expect(body.privateOnly).toBe(true);
  expect((await app.request("/api/value-drivers/watch/AAAT")).status).toBe(401);
 });
 it("allows a private quote with same-origin bearer access only",async()=>{
  const market=vi.fn(async()=>sample);
  const app=new Hono();registerValueDriverRoutes(app,{getMarket:market});
  const headers={Authorization:"Bearer "+token,"Sec-Fetch-Site":"same-origin"};
  const ok=await app.request("/api/value-drivers/live/AAAT?currency=USD",{headers});
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as Record<string,unknown>).provider).toBe("yahoo_finance_unofficial");
  expect(market).toHaveBeenCalledTimes(1);
  const wrong=await app.request("/api/value-drivers/live/AAAT?currency=BRL",{headers});
  expect(wrong.status).toBe(409);
  const cross=await app.request("/api/value-drivers/live/AAAT",{headers:{...headers,"Sec-Fetch-Site":"cross-site"}});
  expect(cross.status).toBe(403);
 });
 it("fails closed when Yahoo personal use is not enabled",async()=>{
  delete process.env.YAHOO_PERSONAL_USE_ENABLED;
  const app=new Hono();registerValueDriverRoutes(app,{getMarket:async()=>sample});
  const res=await app.request("/api/value-drivers/live/AAAT",{headers:{Authorization:"Bearer "+token}});
  expect(res.status).toBe(503);
 });
});
