import mysql from "mysql2/promise";
import { fetchValueDriverMarketSnapshot, normalizeTicker, type LiveMarketSnapshot } from "./value-driver-provider";

export type WatchSignal = {
 symbol:string; observedAt:string; type:"quote_price_change"|"consensus_revenue_revision";
 magnitudePct:number; previous:number; current:number; thresholdPct:number;
 fiscalPeriodEnd:string|null; source:string; status:"review";
};
export const MONITOR_QUOTE_MOVE_PCT=5;
export const MONITOR_CONSENSUS_REVISION_PCT=3;
export function parseWatchlist(value:string|undefined):string[]{
 return [...new Set((value??"").split(",").map(x=>normalizeTicker(x)).filter((x):x is string=>!!x))].slice(0,12);
}
export function compareMarketSnapshots(previous:LiveMarketSnapshot|null,current:LiveMarketSnapshot):WatchSignal[]{
 if(!previous)return [];
 const signals:WatchSignal[]=[];
 const quote0=previous.quote,quote1=current.quote;
 if(quote0&&quote1&&quote0.observedAt!==quote1.observedAt&&quote0.currency===quote1.currency){
   const magnitudePct=(quote1.price/quote0.price-1)*100;
   if(Math.abs(magnitudePct)>=MONITOR_QUOTE_MOVE_PCT)signals.push({
     symbol:current.symbol,observedAt:quote1.observedAt,type:"quote_price_change",
     magnitudePct,previous:quote0.price,current:quote1.price,thresholdPct:MONITOR_QUOTE_MOVE_PCT,
     fiscalPeriodEnd:null,source:quote1.source,status:"review",
   });
 }
 for(const row of current.consensus){
   const old=previous.consensus.find(x=>x.periodEnd===row.periodEnd);
   if(!old||old.revenueAvgBn===null||row.revenueAvgBn===null||old.revenueAvgBn<=0)continue;
   const magnitudePct=(row.revenueAvgBn/old.revenueAvgBn-1)*100;
   if(Math.abs(magnitudePct)>=MONITOR_CONSENSUS_REVISION_PCT)signals.push({
     symbol:current.symbol,observedAt:current.consensusAsOf??current.retrievedAt,
     type:"consensus_revenue_revision",magnitudePct,previous:old.revenueAvgBn,
     current:row.revenueAvgBn,thresholdPct:MONITOR_CONSENSUS_REVISION_PCT,
     fiscalPeriodEnd:row.periodEnd,source:current.consensusSource??"",
     status:"review",
   });
 }
 return signals;
}
const CREATE_SNAPSHOTS=`CREATE TABLE IF NOT EXISTS value_driver_market_snapshots (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 symbol VARCHAR(20) NOT NULL,
 quote_observed_at DATETIME(3) NULL,
 captured_at DATETIME(3) NOT NULL,
 payload_json MEDIUMTEXT NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 UNIQUE KEY uq_vdi_snapshot_hash (symbol,payload_hash),
 INDEX ix_vdi_snapshot_time (symbol,captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const CREATE_SIGNALS=`CREATE TABLE IF NOT EXISTS value_driver_watch_signals (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 symbol VARCHAR(20) NOT NULL,
 signal_key CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 payload_json TEXT NOT NULL,
 UNIQUE KEY uq_vdi_signal (symbol,signal_key),
 INDEX ix_vdi_signal_time (symbol,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
type SQLConnection=Awaited<ReturnType<typeof mysql.createConnection>>;
export async function ensureWatchTables(db:SQLConnection):Promise<void>{
 await db.query(CREATE_SNAPSHOTS);await db.query(CREATE_SIGNALS);
}
async function digest(text:string):Promise<string>{
 const crypto=await import("node:crypto");
 return crypto.createHash("sha256").update(text).digest("hex");
}
function dateSql(date:string):string{return new Date(date).toISOString().slice(0,23).replace("T"," ");}
export function marketFingerprint(s:LiveMarketSnapshot):string{
 // Provider fetch time is *not* a market movement. No duplicate observations on unchanged polls.
 const quote=s.quote?{symbol:s.symbol,observedAt:s.quote.observedAt,price:s.quote.price,cap:s.quote.marketCapBn}:null;
 const estimates=s.consensus.map(x=>({periodEnd:x.periodEnd,revenueAvgBn:x.revenueAvgBn,ebitAvgBn:x.ebitAvgBn,epsAvg:x.epsAvg}));
 return JSON.stringify({quote,estimates});
}
export async function collectMonitoredMarketData(options:{
 db:SQLConnection;symbols:string[]; fetchSnapshot:(symbol:string)=>Promise<LiveMarketSnapshot>;now?:Date;
}):Promise<{attempted:number;stored:number;alertCount:number;errors:Array<{symbol:string;error:string}>}>{
 const {db,fetchSnapshot}=options,now=options.now??new Date();
 await ensureWatchTables(db);
 let stored=0,alertCount=0;
 const errors:Array<{symbol:string;error:string}>=[];
 for(const symbol of [...new Set(options.symbols)].slice(0,12)){
   if(normalizeTicker(symbol)!==symbol){errors.push({symbol,error:"invalid_symbol"});continue;}
   try{
     const current=await fetchSnapshot(symbol);
     if(current.status==="unavailable") {errors.push({symbol,error:"provider_unavailable"});continue;}
     const [records]=await db.query("SELECT payload_json FROM value_driver_market_snapshots WHERE symbol=? ORDER BY id DESC LIMIT 1",[symbol]);
     let previous:LiveMarketSnapshot|null=null;
     const record=(records as Array<{payload_json:string}>)[0];
     if(record){try{previous=JSON.parse(record.payload_json) as LiveMarketSnapshot;}catch{previous=null;}}
     const footprint=await digest(marketFingerprint(current));
     if(previous && await digest(marketFingerprint(previous))===footprint)continue;
     await db.beginTransaction();
     try{
       await db.query("INSERT IGNORE INTO value_driver_market_snapshots (symbol,quote_observed_at,captured_at,payload_json,payload_hash) VALUES (?,?,?,?,?)",[
         symbol,current.quote?dateSql(current.quote.observedAt):null,dateSql(now.toISOString()),
         JSON.stringify(current),footprint,
       ]);
       // Only emit after the snapshot insert; stable hash deduplicates retries.
       const signals=compareMarketSnapshots(previous,current);
       for(const signal of signals){
         const key=await digest(JSON.stringify([signal.type,signal.symbol,signal.observedAt,signal.fiscalPeriodEnd,signal.previous,signal.current]));
         await db.query("INSERT IGNORE INTO value_driver_watch_signals (symbol,signal_key,created_at,payload_json) VALUES (?,?,?,?)",[
           symbol,key,dateSql(now.toISOString()),JSON.stringify(signal),
         ]);
       }
       await db.commit();
       stored++;alertCount+=signals.length;
     }catch(error){await db.rollback();throw error;}
   }catch(error){
     errors.push({symbol,error:error instanceof Error&&"code" in error ? String((error as {code?:string}).code) : "storage_or_provider_unavailable"});
   }
 }
 return {attempted:options.symbols.length,stored,alertCount,errors};
}
export async function runScheduledMarketWatch(env:NodeJS.ProcessEnv=process.env):Promise<{
 enabled:boolean;attempted:number;stored:number;alertCount:number;errors:Array<{symbol:string;error:string}>;
}>{
 const symbols=parseWatchlist(env.FILINGLENS_MONITOR_SYMBOLS);
 if(!env.FMP_API_KEY||!env.DATABASE_URL||!symbols.length)
   return {enabled:false,attempted:0,stored:0,alertCount:0,errors:[]};
 const db=await mysql.createConnection(env.DATABASE_URL);
 try{
   const result=await collectMonitoredMarketData({db,symbols,
     fetchSnapshot:symbol=>fetchValueDriverMarketSnapshot(symbol,{apiKey:env.FMP_API_KEY!})});
   return {enabled:true,...result};
 }finally{await db.end();}
}
export async function readWatchHistory(symbol:string,dsn:string):Promise<{
 snapshots:LiveMarketSnapshot[];signals:WatchSignal[];
}>{
 const db=await mysql.createConnection(dsn);
 try{
   const [sr]=await db.query("SELECT payload_json FROM value_driver_market_snapshots WHERE symbol=? ORDER BY id DESC LIMIT 12",[symbol]);
   const [wr]=await db.query("SELECT payload_json FROM value_driver_watch_signals WHERE symbol=? ORDER BY id DESC LIMIT 30",[symbol]);
   return {snapshots:(sr as Array<{payload_json:string}>).map(x=>JSON.parse(x.payload_json) as LiveMarketSnapshot),
     signals:(wr as Array<{payload_json:string}>).map(x=>JSON.parse(x.payload_json) as WatchSignal)};
 }finally{await db.end();}
}
