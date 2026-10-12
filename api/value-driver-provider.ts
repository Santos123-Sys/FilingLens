/**
 * Personal-use Yahoo Finance adapter. Upstream library:
 * https://github.com/ranaroussi/yfinance (Apache-2.0)
 *
 * NEVER serve this feed publicly. Routes require a private bearer token.
 * Yahoo quotes are best-effort DAILY CLOSES, not executable real-time quotes.
 * Yahoo relative 0y/+1y forecasts are NOT vendor-dated analyst revisions.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface LiveQuote {
  symbol:string;currency:string;price:number;marketCapBn:number;sharesBn:number;
  sharesBasis:"derived_market_cap_divided_by_price";
  observedAt:string;retrievedAt:string;source:string;
  delayed:boolean;stale:boolean;ageMinutes:number;
  tradingDate?:string;priceBasis?:"unadjusted_daily_close";
}
export interface ConsensusYear {
  periodEnd:string;
  periodBasis?:"fiscal_year_inferred_from_last_reported_year"|"relative_yahoo_bucket";
  yahooBucket?:"0y"|"+1y";
  revenueAvgBn:number|null;revenueLowBn:number|null;revenueHighBn:number|null;
  ebitAvgBn:number|null;ebitLowBn:number|null;ebitHighBn:number|null;
  epsAvg:number|null;epsLow:number|null;epsHigh:number|null;
  analystCountRevenue:number|null;analystCountEps:number|null;
  epsTrend30dAgo?:number|null;epsRevisionsUp30d?:number|null;epsRevisionsDown30d?:number|null;
}
export interface LiveMarketSnapshot {
  symbol:string;provider:"yahoo_finance_unofficial";retrievedAt:string;
  quote:LiveQuote|null;consensus:ConsensusYear[];
  consensusSource:string|null;consensusAsOf:string|null;
  quoteError:string|null;consensusError:string|null;
  status:"ready"|"partial"|"unavailable";guardrails:string[];
}
export function normalizeTicker(value:string):string|null {
  const s=value.toUpperCase().trim();
  return /^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,5})?$/.test(s)?s:null;
}
export class MarketProviderError extends Error {
  readonly code:"not_configured"|"limited_access"|"rate_limited"|"unavailable"|"invalid_response";
  constructor(code:MarketProviderError["code"],message?:string){
    super(message??code);this.name="MarketProviderError";this.code=code;
  }
}
type RawRecord=Record<string,unknown>;
const finite=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;
const positive=(v:unknown):number|null=>{const n=finite(v);return n!==null&&n>0?n:null;};
const count=(v:unknown):number|null=>{
 const n=finite(v);return n!==null&&Number.isInteger(n)&&n>=0&&n<=5000?n:null;
};
const bn=(v:unknown):number|null=>{const n=finite(v);return n!==null&&n>=0?n/1e9:null;};
const iso=(d:Date)=>d.toISOString();
const quotePage=(symbol:string)=>"https://finance.yahoo.com/quote/"+encodeURIComponent(symbol)+"/history/";
const consensusPage=(symbol:string)=>"https://finance.yahoo.com/quote/"+encodeURIComponent(symbol)+"/analysis/";
const execFileAsync=promisify(execFile);
export async function runYfinanceBridge(symbol:string):Promise<unknown>{
 const interpreter=process.env.PYTHON_EXECUTABLE||"python3";
 try {
  const {stdout}=await execFileAsync(interpreter,["scripts/yfinance_bridge.py",symbol],{
   cwd:process.cwd(),timeout:30000,maxBuffer:180000,windowsHide:true,
   env:{...process.env,PYTHONUNBUFFERED:"1"},shell:false,
  });
  if(stdout.length>150000)throw new MarketProviderError("invalid_response");
  return JSON.parse(stdout);
 }catch(error){
  if(error instanceof MarketProviderError)throw error;
  throw new MarketProviderError("unavailable");
 }
}
export function normalizeQuote(raw:RawRecord,symbol:string,now:Date):LiveQuote{
 const price=positive(raw.price),cap=positive(raw.marketCap),currency=raw.currency;
 const day=raw.tradingDate,observedAt=raw.observedAt;
 if(!price||!cap||typeof currency!=="string"||!/^[A-Z]{3}$/.test(currency)||
    typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day)||
    observedAt!==day+"T00:00:00.000Z"||raw.priceBasis!=="unadjusted_daily_close")
   throw new MarketProviderError("invalid_response");
 const stamp=new Date(observedAt),age=(now.getTime()-stamp.getTime())/60000;
 if(!Number.isFinite(age)||age< -24*60||age>35*24*60)
   throw new MarketProviderError("invalid_response");
 const shares=cap/price/1e9;
 if(!Number.isFinite(shares)||shares<=0||shares>2000)
   throw new MarketProviderError("invalid_response");
 return {symbol,currency,price,marketCapBn:cap/1e9,sharesBn:shares,
  sharesBasis:"derived_market_cap_divided_by_price",
  observedAt:observedAt as string,tradingDate:day,priceBasis:"unadjusted_daily_close",
  retrievedAt:iso(now),source:quotePage(symbol),delayed:true,
  stale:age>7*24*60,ageMinutes:Math.max(0,Math.round(age))};
}
export function normalizeConsensus(rows:RawRecord[],now:Date):ConsensusYear[]{
 const out:ConsensusYear[]=[];
 for(const r of rows.slice(0,4)){
  const period=r.periodEnd,bucket=r.yahooBucket,basis=r.periodBasis;
  if(typeof period!=="string"||(!/^FY\d{4}$/.test(period)&&period!=="0y"&&period!=="+1y")||
     (bucket!=="0y"&&bucket!=="+1y")||
     (basis!=="fiscal_year_inferred_from_last_reported_year"&&basis!=="relative_yahoo_bucket"))continue;
  if(/^FY\d{4}$/.test(period)){
   const y=Number(period.slice(2));
   if(y<now.getUTCFullYear()-1||y>now.getUTCFullYear()+5)continue;
  }
  const item:ConsensusYear={
   periodEnd:period,periodBasis:basis,yahooBucket:bucket,
   revenueAvgBn:bn(r.revenueAvg),revenueLowBn:bn(r.revenueLow),revenueHighBn:bn(r.revenueHigh),
   // Yahoo does not provide annual EBIT consensus through yfinance.
   ebitAvgBn:null,ebitLowBn:null,ebitHighBn:null,
   epsAvg:finite(r.epsAvg),epsLow:finite(r.epsLow),epsHigh:finite(r.epsHigh),
   analystCountRevenue:count(r.numAnalystsRevenue),analystCountEps:count(r.numAnalystsEps),
   epsTrend30dAgo:finite(r.epsTrend30dAgo),
   epsRevisionsUp30d:count(r.epsRevisionsUp30d),
   epsRevisionsDown30d:count(r.epsRevisionsDown30d),
  };
  if(item.revenueAvgBn===null&&item.epsAvg===null)continue;
  if(item.revenueLowBn!==null&&item.revenueHighBn!==null&&item.revenueLowBn>item.revenueHighBn)continue;
  if(item.revenueAvgBn!==null&&item.revenueLowBn!==null&&item.revenueAvgBn<item.revenueLowBn)continue;
  if(item.revenueAvgBn!==null&&item.revenueHighBn!==null&&item.revenueAvgBn>item.revenueHighBn)continue;
  if(item.epsLow!==null&&item.epsHigh!==null&&item.epsLow>item.epsHigh)continue;
  out.push(item);
 }
 return out;
}
export async function fetchValueDriverMarketSnapshot(symbolInput:string,options?:{
  runner?:(symbol:string)=>Promise<unknown>;now?:Date;
}):Promise<LiveMarketSnapshot>{
 const symbol=normalizeTicker(symbolInput);
 if(!symbol)throw new MarketProviderError("invalid_response","invalid_symbol");
 const now=options?.now??new Date();
 let raw:unknown;
 try{raw=await (options?.runner??runYfinanceBridge)(symbol);}
 catch{throw new MarketProviderError("unavailable");}
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new MarketProviderError("invalid_response");
 const data=raw as RawRecord;
 if(data.symbol!==symbol)throw new MarketProviderError("invalid_response");
 const guarded=["Yahoo Finance via unofficial yfinance (Apache-2.0); personal research only, subject to Yahoo terms.",
  "Price is the last available UNADJUSTED daily close, never an executable real-time quote.",
  "Daily bar observedAt is midnight UTC on the TRADING DATE, not the timestamp of an individual trade.",
  "Market cap and daily close may have been updated at different times; derived shares are approximate.",
  "Yahoo 0y/+1y labels are relative fiscal-year buckets; inferred FY is not a verified period-end date.",
  "Consensus retrievedAt is NOT a provider-issued revision date; EBIT consensus is unavailable.",
  "Never mix share classes, listing currencies, adjusted closes or dividend-adjusted returns."];
 let quote:LiveQuote|null=null;
 let quoteError=typeof data.quoteError==="string"?data.quoteError:null;
 if(data.quote&&typeof data.quote==="object"&&!Array.isArray(data.quote)){
  try{quote=normalizeQuote(data.quote as RawRecord,symbol,now);}
  catch{quoteError="invalid_quote_response";}
 }
 let consensus:ConsensusYear[]=[];
 let consensusError=typeof data.consensusError==="string"?data.consensusError:null;
 if(Array.isArray(data.consensus)){
  consensus=normalizeConsensus(data.consensus.filter((x):x is RawRecord=>!!x&&typeof x==="object"&&!Array.isArray(x)),now);
  if(!consensus.length)consensusError=consensusError??"no_covered_estimates";
 }else consensusError=consensusError??"invalid_consensus_response";
 return {symbol,provider:"yahoo_finance_unofficial",retrievedAt:iso(now),quote,consensus,
  consensusSource:consensus.length?consensusPage(symbol):null,
  consensusAsOf:consensus.length?iso(now):null,
  quoteError,consensusError,status:quote&&consensus.length?"ready":quote||consensus.length?"partial":"unavailable",
  guardrails:guarded};
}
