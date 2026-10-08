import type { MarketResult } from "./analysis";

type Segment = MarketResult["market"]["segments"][number];
export type SegmentPeriod = { label: string; year: number; quarter: number | null; key: string };
export type SegmentFlag = {
 code: "NO_EXACT_FILING_EVIDENCE" | "PERIOD_ALIGNMENT" | "DUPLICATE_PERIOD" |
       "DUPLICATE_SEGMENT" | "NEGATIVE_REVENUE" | "UNVERIFIED_UNIT" | "MIX_NOT_COMPARABLE";
 segment: string;
 detail: string;
};
export type SegmentObservation = {
 period: string;
 revenue: number;
 earnings: number | null;
 marginPercent: number | null;
 yoyRevenuePercent: number | null;
 shareOfReportedSegmentsPercent: number | null;
};
export type SegmentEconomics = {
 name: string;
 unit: string | null;
 currency: string | null;
 source: NonNullable<Segment["source"]>;
 observations: SegmentObservation[];
};
export type SegmentIntelligence = {
 segments: SegmentEconomics[];
 flags: SegmentFlag[];
 mixPeriod: string | null;
 mixBasis: "sum_of_disclosed_segments_not_consolidated_sales";
};

export function parseSegmentPeriod(value: string): SegmentPeriod | null {
 const raw=value.trim();
 const annual=/^(?:FY\s*)?(20\d{2})$/i.exec(raw);
 const qYear=/^(?:FY\s*)?(20\d{2})\s*[- ]?\s*Q([1-4])$/i.exec(raw);
 const qFirst=/^Q([1-4])\s+?(20\d{2})$/i.exec(raw);
 if(annual){const year=Number(annual[1]);return {label:raw,year,quarter:null,key:`FY:${year}`};}
 if(qYear){const year=Number(qYear[1]),quarter=Number(qYear[2]);return {label:raw,year,quarter,key:`Q:${year}:${quarter}`};}
 if(qFirst){const year=Number(qFirst[2]),quarter=Number(qFirst[1]);return {label:raw,year,quarter,key:`Q:${year}:${quarter}`};}
 return null; // YTD/LTM dates must not be silently treated as annual/quarterly.
}

function safeMargin(earnings:number|null,revenue:number):number|null {
 if(earnings===null || revenue<=0)return null;
 const result=earnings/revenue*100;
 return Number.isFinite(result)?Number(result.toFixed(2)):null;
}
function safeGrowth(current:number,previous:number):number|null {
 if(current<0 || previous<=0)return null;
 const result=(current-previous)/previous*100;
 return Number.isFinite(result)?Number(result.toFixed(2)):null;
}
/**
 * Source-gated analysis of disclosed segment figures. Never assumes segment
 * totals equal consolidated revenue. Units must be explicitly present and
 * identical for mix percentages.
 */
export function buildSegmentIntelligence(market:MarketResult["market"]):SegmentIntelligence {
 const flags:SegmentFlag[]=[];
 const segments:SegmentEconomics[]=[];
 const seenNames=new Set<string>();
 const parsedBySegment=new Map<string,Map<string,{period:SegmentPeriod;observation:SegmentObservation}>>();
 for(const item of market.segments){
  const name=item.name.trim();
  if(!name)continue;
  const key=name.toLocaleLowerCase("en");
  if(seenNames.has(key)){flags.push({code:"DUPLICATE_SEGMENT",segment:name,detail:"Duplicate reported segment label"});continue;}
  seenNames.add(key);
  if(item.sourceType!=="filing" || !item.source?.section.trim() || !item.source?.quote?.trim()){
   flags.push({code:"NO_EXACT_FILING_EVIDENCE",segment:name,detail:"An exact filing excerpt is required"});
   continue;
  }
  if(!item.periods?.length || item.revenue.length!==item.periods.length ||
    (item.earnings!==null && item.earnings.length!==item.periods.length)){
   flags.push({code:"PERIOD_ALIGNMENT",segment:name,detail:"Revenue/earnings and disclosed period labels do not align"});
   continue;
  }
  const periods=item.periods.map(parseSegmentPeriod);
  if(periods.some(p=>p===null)){
   flags.push({code:"PERIOD_ALIGNMENT",segment:name,detail:"Ambiguous FY, quarterly, YTD or LTM period"});
   continue;
  }
  const ids=periods.map(p=>p!.key);
  if(new Set(ids).size!==ids.length){
   flags.push({code:"DUPLICATE_PERIOD",segment:name,detail:"Repeated fiscal period; cannot select a unique value"});
   continue;
  }
  if(item.revenue.some(n=>!Number.isFinite(n)) ||
     (item.earnings??[]).some(n=>!Number.isFinite(n))){
   flags.push({code:"PERIOD_ALIGNMENT",segment:name,detail:"Non-finite segment values"});continue;
  }
  const unit=item.unit?.trim()||null;
  const currency=item.currency?.trim().toUpperCase()||null;
  if(!unit || !currency)flags.push({code:"UNVERIFIED_UNIT",segment:name,detail:"Mix cannot be calculated without source-disclosed unit and currency"});
  const byPeriod=new Map<string,{period:SegmentPeriod;observation:SegmentObservation}>();
  periods.forEach((period,index)=>{
   const revenue=item.revenue[index];
   const earnings=item.earnings?.[index]??null;
   const observation:SegmentObservation={period:period!.label,revenue,earnings,
    marginPercent:safeMargin(earnings,revenue),yoyRevenuePercent:null,shareOfReportedSegmentsPercent:null};
   byPeriod.set(period!.key,{period:period!,observation});
   if(revenue<0)flags.push({code:"NEGATIVE_REVENUE",segment:name,detail:`Negative revenue in ${period!.label}; no positive-denominator ratio`});
  });
  for(const {period,observation} of byPeriod.values()){
   const before=byPeriod.get(period.quarter===null?`FY:${period.year-1}`:`Q:${period.year-1}:${period.quarter}`);
   if(before)observation.yoyRevenuePercent=safeGrowth(observation.revenue,before.observation.revenue);
  }
  const observations=[...byPeriod.values()].sort((a,b)=>a.period.year-b.period.year ||
    ((a.period.quarter??5)-(b.period.quarter??5))).map(x=>x.observation);
  segments.push({name,unit,currency,source:item.source,observations});
  parsedBySegment.set(name,byPeriod);
 }
 let mixPeriod:string|null=null;
 if(segments.length>=2){
  const first=segments[0],units=segments.every(s=>s.unit!==null && s.unit===first.unit && s.currency!==null && s.currency===first.currency);
  const common=[...parsedBySegment.get(first.name)!.keys()].filter(k=>
   segments.every(s=>parsedBySegment.get(s.name)!.has(k)));
  const latest=common.sort((a,b)=>{
   const ap=parsedBySegment.get(first.name)!.get(a)!.period,bp=parsedBySegment.get(first.name)!.get(b)!.period;
   return bp.year-ap.year || ((bp.quarter??5)-(ap.quarter??5));
  })[0];
  if(units && latest){
   const entries=segments.map(s=>parsedBySegment.get(s.name)!.get(latest)!.observation);
   const total=entries.reduce((sum,s)=>sum+s.revenue,0);
   if(total>0 && entries.every(x=>x.revenue>=0)){
    mixPeriod=entries[0].period;
    entries.forEach(item=>item.shareOfReportedSegmentsPercent=Number((item.revenue/total*100).toFixed(2)));
   }
  }
  if(!mixPeriod)flags.push({code:"MIX_NOT_COMPARABLE",segment:"all",detail:"No same-period, same-unit, positive disclosed segment revenue set"});
 }
 return {segments,flags,mixPeriod,mixBasis:"sum_of_disclosed_segments_not_consolidated_sales"};
}
