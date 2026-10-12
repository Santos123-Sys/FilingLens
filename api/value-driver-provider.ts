/**
 * External market facts for value-driver analysis, independent of filing extraction.
 * FMP credentials stay server-side. The returned source URL never carries the API key.
 * This adapter does not fabricate a consensus when the provider lacks coverage/access.
 */
export interface LiveQuote {
  symbol: string; currency: string; price: number; marketCapBn: number; sharesBn: number;
  sharesBasis: "derived_market_cap_divided_by_price";
  observedAt: string; retrievedAt: string; source: string;
  delayed: boolean; stale: boolean; ageMinutes: number;
}
export interface ConsensusYear {
  periodEnd: string;
  revenueAvgBn: number | null; revenueLowBn: number | null; revenueHighBn: number | null;
  ebitAvgBn: number | null; ebitLowBn: number | null; ebitHighBn: number | null;
  epsAvg: number | null; epsLow: number | null; epsHigh: number | null;
  analystCountRevenue: number | null; analystCountEps: number | null;
}
export interface LiveMarketSnapshot {
  symbol: string; provider: "financialmodelingprep"; retrievedAt: string;
  quote: LiveQuote | null; consensus: ConsensusYear[];
  consensusSource: string | null;
  consensusAsOf: string | null; // retrieval timestamp, NOT a provider-issued forecast update date
  quoteError: string | null; consensusError: string | null;
  status: "ready" | "partial" | "unavailable";
  guardrails: string[];
}
export function normalizeTicker(value: string): string | null {
  const s=value.toUpperCase().trim();
  return /^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,5})?$/.test(s) ? s : null;
}
export class MarketProviderError extends Error {
  constructor(public readonly code:"not_configured"|"limited_access"|"rate_limited"|"unavailable"|"invalid_response",message?:string){
    super(message??code);this.name="MarketProviderError";
  }
}
const SOURCE="https://site.financialmodelingprep.com/developer/docs";
const endpoint=(path:string,symbol:string,extra:Record<string,string>={})=>{
 const u=new URL("https://financialmodelingprep.com/stable/"+path);
 u.searchParams.set("symbol",symbol);
 for(const [key,value] of Object.entries(extra))u.searchParams.set(key,value);
 return u;
};
type JsonFetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
const numberOrNull=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;
const positive=(v:unknown):number|null=>{const n=numberOrNull(v);return n!==null&&n>0?n:null;};
const billions=(v:unknown):number|null=>{const n=numberOrNull(v);return n!==null&&n>=0?n/1e9:null;};
const cleanCount=(v:unknown):number|null=>{const n=numberOrNull(v);return n!==null&&Number.isInteger(n)&&n>=1&&n<=5000?n:null;};
const iso=(date:Date)=>date.toISOString();
async function fetchFmp(path:string,symbol:string,apiKey:string,fetcher:JsonFetcher,extra:Record<string,string>={}):Promise<Record<string,unknown>> {
 const u=endpoint(path,symbol,extra);
 u.searchParams.set("apikey",apiKey);
 let response:Response;
 try{ response=await fetcher(u.toString(),{headers:{"Accept":"application/json"},
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(6500)});}
 catch{throw new MarketProviderError("unavailable");}
 if(response.status===401||response.status===402||response.status===403)throw new MarketProviderError("limited_access");
 if(response.status===429)throw new MarketProviderError("rate_limited");
 if(!response.ok)throw new MarketProviderError("unavailable");
 const raw=await response.text().catch(()=>{throw new MarketProviderError("invalid_response");});
 if(raw.length>200000)throw new MarketProviderError("invalid_response");
 let decoded:unknown;
 try{decoded=JSON.parse(raw);}catch{throw new MarketProviderError("invalid_response");}
 if(!Array.isArray(decoded)||!decoded.length||typeof decoded[0]!=="object"||decoded[0]===null)
   throw new MarketProviderError("invalid_response");
 return decoded[0] as Record<string,unknown>;
}
async function fetchFmpArray(path:string,symbol:string,apiKey:string,fetcher:JsonFetcher,extra:Record<string,string>):Promise<Record<string,unknown>[]> {
 const u=endpoint(path,symbol,extra);
 u.searchParams.set("apikey",apiKey);
 let response:Response;
 try{response=await fetcher(u.toString(),{headers:{"Accept":"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(6500)});}
 catch{throw new MarketProviderError("unavailable");}
 if([401,402,403].includes(response.status))throw new MarketProviderError("limited_access");
 if(response.status===429)throw new MarketProviderError("rate_limited");
 if(!response.ok)throw new MarketProviderError("unavailable");
 const raw=await response.text().catch(()=>{throw new MarketProviderError("invalid_response");});
 if(raw.length>250000)throw new MarketProviderError("invalid_response");
 let rows:unknown;
 try{rows=JSON.parse(raw);}catch{throw new MarketProviderError("invalid_response");}
 if(!Array.isArray(rows))throw new MarketProviderError("invalid_response");
 return rows.filter((r):r is Record<string,unknown>=>typeof r==="object"&&r!==null).slice(0,10);
}
export function normalizeQuote(quote:Record<string,unknown>,profile:Record<string,unknown>,symbol:string,now:Date):LiveQuote {
 if(quote.symbol!==symbol||profile.symbol!==symbol)throw new MarketProviderError("invalid_response");
 const price=positive(quote.price),cap=positive(quote.marketCap),timestamp=numberOrNull(quote.timestamp);
 const currency=typeof profile.currency==="string"?profile.currency.trim().toUpperCase():"";
 if(!price||!cap||!timestamp||!/^[A-Z]{3}$/.test(currency))throw new MarketProviderError("invalid_response");
 // Timestamp is Unix seconds. Reject future quotes and old data (>35 days).
 const time=new Date(timestamp*1000),ageMinutes=(now.getTime()-time.getTime())/60000;
 if(!Number.isFinite(time.getTime())||ageMinutes< -5 ||ageMinutes>35*24*60)throw new MarketProviderError("invalid_response");
 const shares=cap/price/1e9;
 if(shares<=0||shares>2000)throw new MarketProviderError("invalid_response");
 return {
   symbol,currency,price,marketCapBn:cap/1e9,sharesBn:shares,
   sharesBasis:"derived_market_cap_divided_by_price",observedAt:iso(time),
   retrievedAt:iso(now),
   source:SOURCE+"/stable/quote",delayed:true,
   stale:ageMinutes>3*24*60,ageMinutes:Math.max(0,Math.round(ageMinutes)),
 };
}
export function normalizeConsensus(rows:Record<string,unknown>[],symbol:string,now:Date):ConsensusYear[] {
 const output:ConsensusYear[]=[];
 // Period dates identify the forecasted fiscal year, NOT when analysts last revised estimates.
 const floorYear=now.getUTCFullYear()-1;
 for(const r of rows){
   if(r.symbol!==symbol||typeof r.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))continue;
   const year=Number(r.date.slice(0,4));
   if(year<floorYear||year>now.getUTCFullYear()+7)continue;
   const record:ConsensusYear={
     periodEnd:r.date,
     revenueAvgBn:billions(r.revenueAvg),revenueLowBn:billions(r.revenueLow),revenueHighBn:billions(r.revenueHigh),
     ebitAvgBn:billions(r.ebitAvg),ebitLowBn:billions(r.ebitLow),ebitHighBn:billions(r.ebitHigh),
     epsAvg:numberOrNull(r.epsAvg),epsLow:numberOrNull(r.epsLow),epsHigh:numberOrNull(r.epsHigh),
     analystCountRevenue:cleanCount(r.numAnalystsRevenue),analystCountEps:cleanCount(r.numAnalystsEps),
   };
   if(record.revenueAvgBn===null&&record.ebitAvgBn===null&&record.epsAvg===null)continue;
   if(record.revenueLowBn!==null&&record.revenueHighBn!==null&&record.revenueLowBn>record.revenueHighBn)continue;
   if(record.revenueAvgBn!==null&&record.revenueLowBn!==null&&record.revenueHighBn!==null&&
     (record.revenueAvgBn<record.revenueLowBn||record.revenueAvgBn>record.revenueHighBn))continue;
   output.push(record);
 }
 return output.sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd)).slice(0,5);
}
export async function fetchValueDriverMarketSnapshot(symbolInput:string,options?:{
  apiKey?:string;fetcher?:JsonFetcher;now?:Date;
}):Promise<LiveMarketSnapshot>{
 const symbol=normalizeTicker(symbolInput);
 if(!symbol)throw new MarketProviderError("invalid_response","invalid_symbol");
 const key=options?.apiKey??process.env.FMP_API_KEY??"";
 if(!key)throw new MarketProviderError("not_configured");
 const now=options?.now??new Date(),fetcher=options?.fetcher??fetch;
 const [quoteResult,profileResult,consensusResult]=await Promise.allSettled([
   fetchFmp("quote",symbol,key,fetcher),
   fetchFmp("profile",symbol,key,fetcher),
   fetchFmpArray("analyst-estimates",symbol,key,fetcher,{period:"annual",page:"0",limit:"6"}),
 ]);
 let quote:LiveQuote|null=null,consensus:ConsensusYear[]=[];
 let quoteError:string|null=null,consensusError:string|null=null;
 if(quoteResult.status==="fulfilled"&&profileResult.status==="fulfilled"){
   try{quote=normalizeQuote(quoteResult.value,profileResult.value,symbol,now);}
   catch(e){quoteError=e instanceof MarketProviderError?e.code:"invalid_response";}
 }else{
   const err=quoteResult.status==="rejected"?quoteResult.reason:profileResult.status==="rejected"?profileResult.reason:null;
   quoteError=err instanceof MarketProviderError?err.code:"unavailable";
 }
 if(consensusResult.status==="fulfilled"){
   consensus=normalizeConsensus(consensusResult.value,symbol,now);
   if(!consensus.length)consensusError="no_covered_estimates";
 }else{
   const e=consensusResult.reason;consensusError=e instanceof MarketProviderError?e.code:"unavailable";
 }
 return {
   symbol,provider:"financialmodelingprep",retrievedAt:iso(now),quote,consensus,
   consensusSource:consensus.length?SOURCE+"/stable/financial-estimates":null,
   consensusAsOf:consensus.length?iso(now):null,
   quoteError,consensusError,
   status:quote&&consensus.length?"ready":quote||consensus.length?"partial":"unavailable",
   guardrails:[
     "FMP access and data redistribution rights depend on the subscribed plan.",
     "Quote timestamp may be delayed; retrievedAt is NOT the market observation time.",
     "Forecast periodEnd is the fiscal forecast period, not the consensus revision date.",
     "Shares outstanding are inferred from price and market cap, not independently sourced share counts.",
     "Currency is sourced from the issuer profile; do not combine different share classes or currencies.",
   ],
 };
}
