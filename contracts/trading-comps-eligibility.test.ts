import {describe,it,expect} from "vitest";
import {evaluateTradingPeer,commonQuoteDate} from "./trading-comps-eligibility";
import type {TradingPeerSnapshot} from "./trading-comps-eligibility";
const quote="https://market.example.com/a",source="https://issuer.example.com/report";
const base=():TradingPeerSnapshot=>({
 name:"Peer A",currency:"USD",basis:"us_gaap",consolidated:true,
 quotation_date:"2026-10-08",financial_period_end:"2025-12-31",debt_as_of:"2025-12-31",
 market_cap_millions:1000,net_debt_millions:200,ebitda_millions:100,
 revenue_millions:400,net_income_millions:50,
 quotation_source_url:quote,financial_source_url:source,
});
const ctx=()=>({peer:"Peer A",issuerPeriodEnd:"2025-12-31",currency:"USD",
 basis:"us_gaap",today:"2026-10-08",sourceUrls:new Set([quote,source])});
describe("trading comparables source and as-of gates",()=>{
 it("computes EV/EBITDA EV/Revenue and P/E from source components rather than trusting a claimed multiple",()=>{
  expect(evaluateTradingPeer(base(),"EV/EBITDA",ctx())?.multiple).toBe(12);
  expect(evaluateTradingPeer(base(),"EV/Revenue",ctx())?.multiple).toBe(3);
  expect(evaluateTradingPeer(base(),"P/E",ctx())?.multiple).toBe(20);
 });
 it("rejects missing catalog URLs, malformed HTTP source or changed identity",()=>{
  expect(evaluateTradingPeer(base(),"EV/EBITDA",{...ctx(),sourceUrls:new Set([quote])})).toBeNull();
  expect(evaluateTradingPeer({...base(),quotation_source_url:"http://market.example.com/a"},"EV/Revenue",ctx())).toBeNull();
  expect(evaluateTradingPeer({...base(),name:"Unrelated"},"P/E",ctx())).toBeNull();
 });
 it("rejects stale quote and mismatched FY or accounting and currency",()=>{
  expect(evaluateTradingPeer({...base(),quotation_date:"2026-09-01"},"EV/Revenue",ctx())).toBeNull();
  expect(evaluateTradingPeer({...base(),financial_period_end:"2024-12-31"},"P/E",ctx())).toBeNull();
  expect(evaluateTradingPeer({...base(),currency:"BRL"},"P/E",ctx())).toBeNull();
  expect(evaluateTradingPeer({...base(),basis:"ifrs"},"P/E",ctx())).toBeNull();
 });
 it("rejects debt with different as-of date or unknown EV denominator",()=>{
  expect(evaluateTradingPeer({...base(),debt_as_of:"2026-09-30"},"EV/EBITDA",ctx())).toBeNull();
  expect(evaluateTradingPeer({...base(),ebitda_millions:null},"EV/EBITDA",ctx())).toBeNull();
 });
 it("does not select a median using asynchronous peer quotation dates",()=>{
  const v=evaluateTradingPeer(base(),"P/E",ctx())!;
  expect(commonQuoteDate([v,{...v,name:"B",quotationDate:"2026-10-07"},{...v,name:"C"}])).toBeNull();
  expect(commonQuoteDate([v,{...v,name:"B"},{...v,name:"C"}])).toBe("2026-10-08");
 });
});
