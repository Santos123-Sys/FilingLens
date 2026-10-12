import type { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { fetchValueDriverMarketSnapshot, normalizeTicker, type LiveMarketSnapshot } from "./value-driver-provider";
import { parseWatchlist, readWatchHistory } from "./value-driver-monitor";

type CacheItem={at:number,payload:LiveMarketSnapshot};
const snapshotCache=new Map<string,CacheItem>();
const inflight=new Map<string,Promise<LiveMarketSnapshot>>();
// Unofficial Yahoo endpoints are not appropriate for 90-second polling.
const TTL_MS=20*60_000;
function enabled():boolean {
 return process.env.YAHOO_PERSONAL_USE_ENABLED==="true";
}
function privateToken():string {
 return process.env.FILINGLENS_VALUATION_READ_API_TOKEN??"";
}
export function yahooAuthorized(header:string|undefined,token=privateToken()):boolean {
 const received=header?.startsWith("Bearer ")?header.slice(7):"";
 const x=Buffer.from(received??""),y=Buffer.from(token);
 return y.length>=32&&x.length===y.length&&timingSafeEqual(x,y);
}
export function registerValueDriverRoutes(app:Hono,options?:{
 getMarket?:(symbol:string)=>Promise<LiveMarketSnapshot>;
 readHistory?:(symbol:string,dsn:string)=>ReturnType<typeof readWatchHistory>;
 clock?:()=>number;
}):void {
 const getMarket=options?.getMarket??fetchValueDriverMarketSnapshot;
 const clock=options?.clock??Date.now;
 app.get("/api/value-drivers/status",c=>{
  c.header("Cache-Control","no-store");
  return c.json({
   provider:"yahoo_finance_unofficial",privateOnly:true,
   accessConfigured:enabled()&&privateToken().length>=32,
   authorizationRequired:true,quoteBasis:"unadjusted_daily_close",
   monitoredSymbols:[], // Never disclose the watchlist to unauthenticated visitors.
   interval:"daily_if_railway_cron_enabled",
   message:"Personal-use research feed. Enter the private valuation access token.",
  });
 });
 app.use("/api/value-drivers/*",async(c,next)=>{
  if(c.req.path==="/api/value-drivers/status")return next();
  c.header("Cache-Control","no-store");
  if(!enabled()||privateToken().length<32)return c.json({error:"personal_research_feed_not_configured"},503);
  const site=c.req.header("Sec-Fetch-Site");
  if(site && !["same-origin","none"].includes(site))return c.json({error:"cross_origin_denied"},403);
  if(!yahooAuthorized(c.req.header("Authorization")))return c.json({error:"private_token_required"},401);
  await next();
 });
 app.get("/api/value-drivers/live/:ticker",async c=>{
  const symbol=normalizeTicker(c.req.param("ticker"));
  if(!symbol)return c.json({error:"invalid_symbol"},400);
  const expectedCurrency=c.req.query("currency");
  if(expectedCurrency&&expectedCurrency!=="USD"&&expectedCurrency!=="BRL")
   return c.json({error:"invalid_currency"},400);
  try {
   const cached=snapshotCache.get(symbol);
   let snapshot:LiveMarketSnapshot;
   if(cached && clock()-cached.at<TTL_MS)snapshot=cached.payload;
   else{
    let promise=inflight.get(symbol);
    if(!promise){
     if(snapshotCache.size>32)snapshotCache.clear();
     promise=getMarket(symbol);inflight.set(symbol,promise);
    }
    try{snapshot=await promise;}finally{if(inflight.get(symbol)===promise)inflight.delete(symbol);}
    if(snapshot.status!=="unavailable")snapshotCache.set(symbol,{at:clock(),payload:snapshot});
   }
   if(expectedCurrency&&snapshot.quote&&snapshot.quote.currency!==expectedCurrency)
    return c.json({error:"market_filing_currency_mismatch",reportedCurrency:snapshot.quote.currency},409);
   if(snapshot.status==="unavailable")
    return c.json({error:"provider_unavailable",quoteError:snapshot.quoteError,consensusError:snapshot.consensusError},503);
   return c.json(snapshot);
  }catch(error){
   const code=typeof error==="object"&&error!==null&&"code" in error?String((error as {code?:string}).code):"provider_unavailable";
   return c.json({error:code},code==="rate_limited"?429:503);
  }
 });
 app.get("/api/value-drivers/watch/:ticker",async c=>{
  const symbol=normalizeTicker(c.req.param("ticker"));
  if(!symbol)return c.json({error:"invalid_symbol"},400);
  if(!parseWatchlist(process.env.FILINGLENS_MONITOR_SYMBOLS).includes(symbol))
   return c.json({error:"symbol_not_monitored"},404);
  if(!process.env.DATABASE_URL)return c.json({error:"monitor_database_unavailable"},503);
  try{
   const data=await (options?.readHistory??readWatchHistory)(symbol,process.env.DATABASE_URL);
   return c.json({symbol,...data,sourceType:"personal_research_market_data",liveNotifications:false});
  }catch{return c.json({error:"monitor_history_unavailable"},503);}
 });
}
