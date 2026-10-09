import {describe,expect,it} from "vitest";
import {parseSecEdgarWatchlist} from "./sec-edgar-watchlist";

const valid=()=>({schema:"filinglens.sec_edgar_watchlist.v1",lookbackDays:10,
 limitPerForm:2,issuers:[{ticker:"AAPL",cik:"0000320193",forms:["10-K","10-Q","8-K"]}]});

describe("SEC EDGAR scheduled watchlist",()=>{
 it("accepts a small, explicit issuer and form cohort",()=>{
  expect(parseSecEdgarWatchlist(valid()).issuers[0]).toEqual({
   ticker:"AAPL",cik:"0000320193",forms:["10-K","10-Q","8-K"],
  });
 });
 it("rejects broad, duplicated, malformed or unsupported acquisition plans",()=>{
  expect(()=>parseSecEdgarWatchlist({...valid(),lookbackDays:365})).toThrow();
  expect(()=>parseSecEdgarWatchlist({...valid(),limitPerForm:100})).toThrow();
  expect(()=>parseSecEdgarWatchlist({...valid(),issuers:[...valid().issuers,...valid().issuers]})).toThrow(/duplicate/);
  expect(()=>parseSecEdgarWatchlist({...valid(),issuers:[{...valid().issuers[0],forms:["10-K","13F-HR"]}]})).toThrow();
  expect(()=>parseSecEdgarWatchlist({...valid(),issuers:[{...valid().issuers[0],ticker:"../../etc"}]})).toThrow();
 });
});
