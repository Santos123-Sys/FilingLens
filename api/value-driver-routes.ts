import type { Hono } from "hono";
import { fetchValueDriverMarketSnapshot, normalizeTicker, type LiveMarketSnapshot } from "./value-driver-provider";
import { parseWatchlist, readWatchHistory } from "./value-driver-monitor";

type CacheItem={at:number,payload:LiveMarketSnapshot};
const snapshotCache=new Map<string,CacheItem>();
const inflight=new Map<string,Promise<LiveMarketSnapshot>>();
const TTL_MS=90_000;
function publicEnabled():boolean {
 // The provider's license may not permit a public web dashboard. Explicit opt-in required.
 return process.env.FMP_PUBLIC_DISPLAY_ALLOWED==="true" && !!process.env.FMP_API_KEY;
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
     liveDataConfigured:publicEnabled(),provider:"financialmodelingprep",
     marketDataLicenseRequired:true,
     monitorConfigured:!!process.env.DATABASE_URL&&!!process.env.FMP_API_KEY&&
       parseWatchlist(process.env.FILINGLENS_MONITOR_SYMBOLS).length>0,
     monitoredSymbols:parseWatchlist(process.env.FILINGLENS_MONITOR_SYMBOLS),
     interval:"hourly_if_railway_cron_enabled",
     message:publicEnabled()?"Live provider configured; observations may be delayed."
       :"No licensed market-data access configured. Historical snapshots remain explicitly dated.",
   });
 });
 app.get("/api/value-drivers/live/:ticker",async c=>{
   c.header("Cache-Control","no-store");
   if(!publicEnabled())return c.json({error:"licensed_provider_not_configured"},503);
   const symbol=normalizeTicker(c.req.param("ticker"));
   if(!symbol)return c.json({error:"invalid_symbol"},400);
   // Configurable provider supports BR and US only when the provider serves the ticker.
   const expectedCurrency=c.req.query("currency");
   if(expectedCurrency&&expectedCurrency!=="USD"&&expectedCurrency!=="BRL")
     return c.json({error:"invalid_currency"},400);
   try{
     const cached=snapshotCache.get(symbol);
     let snapshot:LiveMarketSnapshot;
     if(cached && clock()-cached.at<TTL_MS)snapshot=cached.payload;
     else{
       let promise=inflight.get(symbol);
       if(!promise){
         if(snapshotCache.size>32)snapshotCache.clear();
         promise=getMarket(symbol);
         inflight.set(symbol,promise);
       }
       try{snapshot=await promise;}finally{if(inflight.get(symbol)===promise)inflight.delete(symbol);}
       // Cache only successful results. Do not cache provider errors or permission failures.
       if(snapshot.status!=="unavailable")snapshotCache.set(symbol,{at:clock(),payload:snapshot});
     }
     if(expectedCurrency&&snapshot.quote&&snapshot.quote.currency!==expectedCurrency)
       return c.json({error:"market_filing_currency_mismatch",reportedCurrency:snapshot.quote.currency},409);
     if(snapshot.status==="unavailable")return c.json({error:"provider_unavailable",quoteError:snapshot.quoteError,consensusError:snapshot.consensusError},503);
     return c.json(snapshot);
   }catch(error){
     const code=typeof error==="object"&&error!==null&&"code" in error?String((error as {code?:string}).code):"provider_unavailable";
     return c.json({error:code},code==="rate_limited"?429:503);
   }
 });
 app.get("/api/value-drivers/watch/:ticker",async c=>{
   c.header("Cache-Control","no-store");
   if(!publicEnabled())return c.json({error:"licensed_provider_not_configured"},503);
   const symbol=normalizeTicker(c.req.param("ticker"));
   if(!symbol)return c.json({error:"invalid_symbol"},400);
   // Only explicitly configured public-market tickers; no user portfolio or private filings.
   if(!parseWatchlist(process.env.FILINGLENS_MONITOR_SYMBOLS).includes(symbol))
     return c.json({error:"symbol_not_monitored"},404);
   if(!process.env.DATABASE_URL)return c.json({error:"monitor_database_unavailable"},503);
   try{
     const data=await (options?.readHistory??readWatchHistory)(symbol,process.env.DATABASE_URL);
     return c.json({symbol,...data,sourceType:"public_market_data",liveNotifications:false});
   }catch{
     return c.json({error:"monitor_history_unavailable"},503);
   }
 });
}
