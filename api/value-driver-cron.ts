import { runScheduledMarketWatch } from "./value-driver-monitor";

/** One bounded hourly Railway Cron invocation. No runtime timer and no private filing data. */
async function main(){
  const result=await runScheduledMarketWatch();
  // Never print provider API keys, DSNs, or raw vendor responses.
  console.info("[value-driver-cron]",JSON.stringify({
    enabled:result.enabled,attempted:result.attempted,stored:result.stored,
    materialSignals:result.alertCount,unavailableSymbols:result.errors.map(x=>x.symbol),
  }));
  // A partial outage is visible as a failed cron execution; no stale price is relabeled live.
  if(result.enabled && result.errors.length===result.attempted)process.exitCode=1;
}
main().catch(error=>{
 console.error("[value-driver-cron] job failed",error instanceof Error?error.name:"unknown");
 process.exitCode=1;
});
