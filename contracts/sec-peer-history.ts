import type {MarketResult} from "./analysis";
import type {SecCompanyFacts} from "./sec-peer-proof";
import {SEC_METRIC_TAGS, secProofUrl} from "./sec-peer-proof";
import type {BenchmarkMetric} from "./peer-financial-benchmark";
type Peer = NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"][number];
export type OfficialHistoryFact=NonNullable<Peer["officialHistory"]>[number];
export type HistoricalGrowth={peer:string;metric:BenchmarkMetric;fromYear:number;toYear:number;
 growthPercent:number;periodEnd:string;currency:OfficialHistoryFact["currency"];source:OfficialHistoryFact["source"]};
export type MatchedCohort={year:number;periodEnd:string;metric:BenchmarkMetric;
 currency:OfficialHistoryFact["currency"];facts:Array<{peer:string;valueMillions:number;source:OfficialHistoryFact["source"]}>};
const normalize=(s:string)=>s.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9 ]+/g," ")
 .replace(/\b(?:inc|incorporated|corporation|corp|limited|ltd|plc|company|co)\b/g,"")
 .replace(/\s+/g," ").trim();
const annual=(start:string,end:string)=>{
 const days=(Date.parse(end)-Date.parse(start))/86400000;
 return Number.isFinite(days)&&days>=330&&days<=400;
};
const date=(value:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(value)&&
 !Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const keys:[BenchmarkMetric,string[]][]=[
 ["revenue",SEC_METRIC_TAGS.revenue??[]],
 ["netIncome",SEC_METRIC_TAGS.netIncome??[]],
 ["operatingIncome",SEC_METRIC_TAGS.operatingIncome??[]],
 ["grossProfit",SEC_METRIC_TAGS.grossProfit??[]],
];
/**
 * Pull FY data from the exact regulator response already fetched during
 * identification. No model-authored value is admitted. Conflicting tags or
 * restatements for the same fiscal-year-end are excluded entirely.
 */
export function collectSecHistoricalFacts(peer:string,cik:string,sec:SecCompanyFacts|null):OfficialHistoryFact[]{
 if(!sec||!/^[0-9]{10}$/.test(cik)||
   String(sec.cik??"").padStart(10,"0")!==cik||!sec.entityName||
   normalize(peer)!==normalize(sec.entityName))return [];
 const rows:OfficialHistoryFact[]=[];
 for(const [metric,tags] of keys){
  const byPeriod=new Map<string,Array<{millions:number;accession:string;tag:string}>>();
  for(const tag of tags){
   const facts=sec.facts?.["us-gaap"]?.[tag]?.units?.USD??[];
   for(const fact of facts){
    if(!Number.isFinite(fact.val)||!fact.start||!fact.end||!date(fact.start)||!date(fact.end)||
      !annual(fact.start,fact.end)||fact.form!=="10-K"||fact.fp!=="FY"||
      !Number.isSafeInteger(fact.fy)||fact.fy!==Number(fact.end.slice(0,4))||
      !fact.accn||!/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(fact.accn))continue;
    const year=Number(fact.end.slice(0,4));
    const key=`${year}|${fact.end}`;
    const list=byPeriod.get(key)??[];
    list.push({millions:fact.val!/1_000_000,accession:fact.accn,tag});
    byPeriod.set(key,list);
   }
  }
  for(const [period,values] of byPeriod){
   const [rawYear,periodEnd]=period.split("|");
   const year=Number(rawYear);
   const ordered=values.sort((a,b)=>a.accession.localeCompare(b.accession));
   const value=ordered[0]?.millions;
   if(value===undefined||values.some(x=>Math.abs(x.millions-value)>Math.max(0.001,Math.abs(value)*0.000001)))continue;
   const accession=ordered[0].accession;
   rows.push({metric,year,periodEnd,amountMillions:value,currency:"USD",
    accountingBasis:"us_gaap",filingAccession:accession,
    source:{kind:"citation",section:`SEC CompanyFacts — ${metric}; accession ${accession}`,
     publisher:"SEC EDGAR",url:secProofUrl(cik),sourceForm:"10-K",item:periodEnd}});
  }
 }
 const allYears=[...new Set(rows.map(x=>x.year))].sort((a,b)=>b-a).slice(0,5);
 return rows.filter(x=>allYears.includes(x.year)).sort((a,b)=>b.year-a.year||
  a.metric.localeCompare(b.metric)).slice(0,20);
}
export function secHistoricalPeerCohorts(peers:Peer[]):{
 growth:HistoricalGrowth[];matched:MatchedCohort[];dataPoints:number;
}{
 const facts=peers.flatMap(p=>(p.officialHistory??[]).map(x=>({peer:p.name,fact:x})));
 const growth:HistoricalGrowth[]=[];
 for(const {peer,fact} of facts){
  if(fact.year<=2000)continue;
  const prev=facts.find(x=>x.peer===peer&&x.fact.metric===fact.metric
   &&x.fact.year===fact.year-1&&x.fact.amountMillions>0
   &&x.fact.currency===fact.currency && x.fact.accountingBasis===fact.accountingBasis
   &&Math.abs(Date.parse(fact.periodEnd)-Date.parse(x.fact.periodEnd))/86400000>=350
   &&Math.abs(Date.parse(fact.periodEnd)-Date.parse(x.fact.periodEnd))/86400000<=380);
  if(!prev)continue;
  const percent=(fact.amountMillions/prev.fact.amountMillions-1)*100;
  if(Number.isFinite(percent))growth.push({peer,metric:fact.metric,fromYear:prev.fact.year,toYear:fact.year,
   growthPercent:Number(percent.toFixed(2)),periodEnd:fact.periodEnd,currency:fact.currency,source:fact.source});
 }
 const buckets=new Map<string,typeof facts>();
 for(const item of facts){
  const x=item.fact,key=[x.year,x.periodEnd,x.metric,x.currency,x.accountingBasis].join("|");
  buckets.set(key,[...(buckets.get(key)??[]),item]);
 }
 const matched:MatchedCohort[]=[];
 for(const values of buckets.values()){
  const distinct=new Set(values.map(x=>x.peer.toLowerCase()));
  if(distinct.size<2||distinct.size!==values.length)continue;
  const first=values[0].fact;
  matched.push({year:first.year,periodEnd:first.periodEnd,metric:first.metric,currency:first.currency,
   facts:values.map(v=>({peer:v.peer,valueMillions:v.fact.amountMillions,source:v.fact.source}))});
 }
 return {growth:growth.sort((a,b)=>b.toYear-a.toYear),matched,dataPoints:facts.length};
}
