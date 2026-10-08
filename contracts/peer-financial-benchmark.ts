import type { EvidenceReference, FilingAnalysis } from "./analysis";
import { evidenceUrl } from "./peer-evidence-audit";

export type BenchmarkMetric = "revenue" | "netIncome" | "operatingIncome" | "grossProfit";
type Basis = "us_gaap" | "ifrs" | "br_gaap";
type Currency = "USD" | "BRL";
type Scale = "thousands" | "millions" | "billions";
export type PeerFact = { peer:string; metric:BenchmarkMetric; year:number; periodEnd:string;
 currency:Currency; millions:number; basis:Basis; source:EvidenceReference; raw:string };
export type PeerMargin = { peer:string; year:number; marginPercent:number; currency:Currency;
 periodEnd:string; basis:Basis; sources:EvidenceReference[] };
export type PeerComparison = { peer:string; metric:"revenue"|"netIncome"; year:number; periodEnd:string;
 currency:Currency; issuerMillions:number; peerMillions:number; differencePercent:number|null; source:EvidenceReference };
export type PeerBenchmarkReport = { facts:PeerFact[]; margins:PeerMargin[]; comparisons:PeerComparison[];
 flags:Array<{peer:string;code:string;detail:string}> };
const yearOf=(s:string)=>{const m=/^FY\s*(20\d{2})$/i.exec(s.trim());return m?Number(m[1]):null;};
const basisOf=(s:string):Basis|null=>{
 const all=new Set([...s.matchAll(/\b(?:US[ -]?GAAP|BR[ -]?GAAP|IFRS)\b/gi)]
  .map(m=>m[0].toLowerCase().replace(/[ -]/g,"")));
 if(all.size!==1)return null;
 const v=[...all][0];return v==="usgaap"?"us_gaap":v==="brgaap"?"br_gaap":v==="ifrs"?"ifrs":null;
};
const scopeOf=(s:string)=>/\bconsolidated\b|\bconsolidado\b|\bconsolidadas\b/i.test(s)
 && !/\bstandalone\b|\bseparate financial\b|\bindividual\b/i.test(s);
export const metricOf=(s:string):BenchmarkMetric|null=>{
 const v=s.trim().toLowerCase().replace(/\s+/g," ");
 if(/^(?:total )?revenues?$|^net sales$|^net revenue$/.test(v))return "revenue";
 if(/^(net income|net profit)$/.test(v))return "netIncome";
 if(/^(operating income|operating profit|ebit)$/.test(v))return "operatingIncome";
 if(v==="gross profit")return "grossProfit";
 return null;
};
const factor=(s:Scale)=>s==="thousands"?0.001:s==="billions"?1000:1;
const unitOf=(s:string):{currency:Currency;scale:Scale}|null=>{
 const m=/^(USD|BRL)\s+(thousands|millions|billions)$/i.exec(s.trim());
 return m?{currency:m[1].toUpperCase() as Currency,scale:m[2].toLowerCase() as Scale}:null;
};
export const parseValue=(s:string):{currency:Currency;millions:number}|null=>{
 const m=/^(USD|BRL)\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,3})?)\s+(thousands?|millions?|billions?)$/i.exec(s.trim());
 if(!m)return null;
 const scale=m[3].toLowerCase().replace(/s$/,"")+"s";
 const value=Number(m[2].replaceAll(",",""))*factor(scale as Scale);
 return Number.isFinite(value)?{currency:m[1].toUpperCase() as Currency,millions:value}:null;
};
const dateValid=(s:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(s) &&
 !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
export const periodEndOf=(s:string):string|null=>{
 const match=[...s.matchAll(/\b(?:period\s*end(?:ed|ing)?|fiscal\s*year\s*end(?:ed|ing)?)\s*:?\s*(20\d{2}-\d{2}-\d{2})\b/gi)];
 const unique=new Set(match.map(x=>x[1]));
 if(unique.size!==1)return null;
 const date=[...unique][0];return dateValid(date)?date:null;
};
/** Facts are candidates linked to model-verified web citations, not independent audit confirmations. */
export function buildPeerFinancialBenchmarks(data:FilingAnalysis):PeerBenchmarkReport {
 const flags:PeerBenchmarkReport["flags"]=[];
 const rawFacts:PeerFact[]=[];
 for(const peer of data.market.competitiveAnalysis?.peerProfiles??[]){
  for(const point of peer.dataPoints??[]){
   const reject=(code:string,detail:string)=>flags.push({peer:peer.name,code,detail});
   const metric=metricOf(point.label);
   if(!metric){reject("UNRECOGNIZED_METRIC",point.label);continue;}
   const year=yearOf(point.period);
   if(year===null){reject("NON_ANNUAL_PERIOD",point.period);continue;}
   const amount=parseValue(point.value);
   if(!amount){reject("AMBIGUOUS_AMOUNT",point.value);continue;}
   const basis=basisOf(point.context);
   if(!basis||!scopeOf(point.context)){reject("UNVERIFIED_SCOPE_OR_ACCOUNTING_BASIS",`${metric} FY${year}`);continue;}
   const periodEnd=periodEndOf(point.context);
   if(!periodEnd||Number(periodEnd.slice(0,4))!==year){reject("MISSING_FISCAL_YEAR_END",`${metric} FY${year}`);continue;}
   if(!evidenceUrl(point.source)){reject("NO_HTTPS_SOURCE",`${metric} FY${year}`);continue;}
   if(point.primaryVerification?.status!=="verified"){
    reject("UNVERIFIED_PRIMARY_FIGURE",`${metric} FY${year}: ${point.primaryVerification?.status??"not_checked"}; excludes unsupported official numeric values`);
    continue;
   }
   rawFacts.push({peer:peer.name,metric,year,periodEnd,currency:amount.currency,
    millions:amount.millions,basis,source:point.source,raw:point.value});
  }
 }
 const count=new Map<string,number>();
 const key=(x:PeerFact)=>[x.peer.toLowerCase(),x.metric,x.year,x.periodEnd,x.basis].join("|");
 for(const x of rawFacts)count.set(key(x),(count.get(key(x))??0)+1);
 const facts=rawFacts.filter(x=>{if(count.get(key(x))===1)return true;
  flags.push({peer:x.peer,code:"DUPLICATE_FACT",detail:`${x.metric} FY${x.year} omitted`});return false;});
 const margins:PeerMargin[]=[];
 for(const revenue of facts.filter(x=>x.metric==="revenue"&&x.millions>0)){
  const income=facts.find(x=>x.peer===revenue.peer&&x.metric==="netIncome"
   &&x.year===revenue.year&&x.periodEnd===revenue.periodEnd
   &&x.basis===revenue.basis&&x.currency===revenue.currency);
  if(!income)continue;
  const ratio=income.millions/revenue.millions*100;
  if(Number.isFinite(ratio))margins.push({peer:revenue.peer,year:revenue.year,
   marginPercent:Number(ratio.toFixed(2)),currency:revenue.currency,
   periodEnd:revenue.periodEnd,basis:revenue.basis,sources:[revenue.source,income.source]});
 }
 const f=data.financials,unit=unitOf(f.unit),companyPeriod=data.company.periodEnd;
 const comparisons:PeerComparison[]=[];
 for(const point of facts){
  if(point.metric!=="revenue" && point.metric!=="netIncome")continue;
  if(!unit||!f.accountingBasis||f.accountingBasis==="unknown"||
    f.statementScope!=="consolidated"||unit.currency!==point.currency
    ||f.accountingBasis!==point.basis||companyPeriod!==point.periodEnd)continue;
  const indexes=f.years.map((y,i)=>yearOf(y)===point.year?i:-1).filter(i=>i>=0);
  if(indexes.length!==1)continue;
  const amount=f[point.metric][indexes[0]];
  if(typeof amount!=="number"||!Number.isFinite(amount))continue;
  const issuerMillions=amount*factor(unit.scale);
  const differencePercent=issuerMillions===0?null:Number(((point.millions/issuerMillions-1)*100).toFixed(2));
  comparisons.push({peer:point.peer,metric:point.metric,year:point.year,
   periodEnd:point.periodEnd,currency:point.currency,
   issuerMillions,peerMillions:point.millions,differencePercent,source:point.source});
 }
 if(facts.length && !comparisons.length)flags.push({peer:"all",code:"ISSUER_PEER_MISMATCH",
  detail:"Comparison requires the same fiscal end, GAAP/IFRS basis, consolidated scope, metric and currency."});
 return {facts,margins,comparisons,flags};
}
