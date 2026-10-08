import type { EvidenceReference, FilingAnalysis, DcfValuationResult } from "./analysis";

export type DriverName = "revenueGrowth" | "ebitMargin" | "capexIntensity";
export type DriverReference = { name: DriverName; period: string; valuePercent: number | null;
  source: EvidenceReference | null; status: "supported" | "missing_evidence" | "unavailable" };
export type DriverScenario = { name: "bear" | "base" | "bull"; probabilityPercent: number;
  revenueGrowthPercent: number; ebitMarginPercent: number; capexPercentRevenue: number };
export type ProjectedDriver = { scenario: DriverScenario["name"]; probabilityPercent: number;
  thirdYearRevenue: number; thirdYearEbit: number; thirdYearCapex: number;
  thirdYearEbitLessCapex: number; basePeriod: string };
export type DriverBridge = { status:"ready"|"missing_evidence"|"invalid_assumptions";
  historical: DriverReference[]; guidance: Array<{metric:string;period:string;range:string;source:EvidenceReference}>;
  peerOutlooks: Array<{peer:string;stance:string;summary:string;source:EvidenceReference}>;
  scenarios:ProjectedDriver[]; sensitivity:Array<{name:DriverName;deltaOnePoint:number}>;
  dcfLink:{status:"validated_dcf"|"not_validated";perShareBase:number|null;waccGrid:number[];
    terminalGrowthGrid:number[]}|null; flags:string[] };
const yearOf=(s:string)=>/^(?:FY\s*)?(20\d{2})$/.exec(s.trim())?.[1]??null;
const validEvidence=(s:EvidenceReference|undefined|null)=>Boolean(s && s.section.trim() &&
 (s.kind==="excerpt" && s.quote?.trim() || s.url?.startsWith("https://")));
const num=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const latest=(years:string[],values:number[]|null|undefined):{year:string;index:number;value:number}|null=>{
 if(!values||values.length!==years.length)return null;
 const matches=years.map((name,index)=>({year:yearOf(name),index,value:values[index]}))
  .filter(x=>x.year!==null&&num(x.value)).sort((a,b)=>Number(b.year)-Number(a.year));
 if(!matches.length||matches.length>1&&matches[0].year===matches[1].year)return null;
 return {year:matches[0].year!,index:matches[0].index,value:matches[0].value};
};
const metricEvidence=(data:FilingAnalysis,metric:string,period:string):EvidenceReference|null=>{
 const match=data.financials.evidence?.find(x=>x.metric===metric && x.period===period)?.source;
 return validEvidence(match)?match!:null;
};
const finitePercent=(v:number,limit:number)=>num(v)&&Math.abs(v)<=limit;
export function buildValuationDriverBridge(
 data:FilingAnalysis,scenarioInputs:DriverScenario[],dcf?:DcfValuationResult
):DriverBridge {
 const f=data.financials,flags:string[]=[];
 const revenue=latest(f.years,f.revenue);
 const ebit=latest(f.years,f.ebit);
 const capex=latest(f.years,f.capex);
 const previous=revenue ? f.years.flatMap((year,index)=>{
  const fy=yearOf(year);
  return fy!==null && Number(fy)===Number(revenue.year)-1 && num(f.revenue[index]) ?
   [{period:year,index,value:f.revenue[index]}] : [];
 }):[];
 const growth=revenue&&previous.length===1&&previous[0].value>0
  ?(revenue.value/previous[0].value-1)*100:null;
 const revPeriod=revenue?f.years[revenue.index]:"";
 const ebitPeriod=ebit?f.years[ebit.index]:"";
 const capexPeriod=capex?f.years[capex.index]:"";
 const alignment=Boolean(revenue&&revenue.value>0&&ebit?.year===revenue.year&&capex?.year===revenue.year);
 const metrics:[
  {name:"revenueGrowth" as const,period:revPeriod,value:growth,evidence:revenue&&previous.length===1
   ?[metricEvidence(data,"revenue",revPeriod),metricEvidence(data,"revenue",previous[0].period)] : []},
  {name:"ebitMargin" as const,period:ebitPeriod,value:alignment&&ebit ?ebit.value/revenue!.value*100:null,
   evidence:alignment?[metricEvidence(data,"ebit",ebitPeriod),metricEvidence(data,"revenue",revPeriod)]:[]},
  {name:"capexIntensity" as const,period:capexPeriod,value:alignment&&capex&&capex.value>=0?capex.value/revenue!.value*100:null,
   evidence:alignment?[metricEvidence(data,"capex",capexPeriod),metricEvidence(data,"revenue",revPeriod)]:[]}
 ];
 const historical:DriverReference[]=metrics.map(x=>({
  name:x.name,period:x.period,valuePercent:x.value===null?null:Number(x.value.toFixed(2)),
  source:x.evidence[0]??null,
  status:x.value===null?"unavailable":x.evidence.length===2&&x.evidence.every(Boolean)?"supported":"missing_evidence"
 }));
 const guidance=(f.forwardGuidance??[]).filter(x=>validEvidence(x.source)).map(x=>({
  metric:x.metric,period:x.period,range:x.range,source:x.source
 }));
 const peerOutlooks=(data.market.competitiveAnalysis?.peerProfiles??[])
  .flatMap(p=>p.outlook&&validEvidence(p.outlook.source)?[{
   peer:p.name,stance:p.outlook.stance,summary:p.outlook.summary,source:p.outlook.source
  }]:[]);
 const dcfLink=dcf?.status==="complete"?{status:"validated_dcf" as const,
  perShareBase:dcf.figures.implied_per_share.value,
  waccGrid:dcf.sensitivity.wacc,
  terminalGrowthGrid:dcf.sensitivity.terminal_growth
 }:null;
 if(!alignment)flags.push("Missing matching positive FY revenue and nonnegative capex/EBIT values.");
 if(historical.some(x=>x.status!=="supported"))flags.push("Historical driver sources or aligned fiscal periods are incomplete.");
 if(scenarioInputs.length!==3||new Set(scenarioInputs.map(s=>s.name)).size!==3||
  scenarioInputs.some(s=>!Number.isInteger(s.probabilityPercent)||s.probabilityPercent<0||s.probabilityPercent>100||
   !finitePercent(s.revenueGrowthPercent,100)||s.revenueGrowthPercent<=-100||
   !finitePercent(s.ebitMarginPercent,100)||s.capexPercentRevenue<0||
   !finitePercent(s.capexPercentRevenue,100))||
  scenarioInputs.reduce((total,s)=>total+s.probabilityPercent,0)!==100){
  flags.push("Explicit bear/base/bull inputs and probabilities totaling 100% are required.");
  return {status:"invalid_assumptions",historical,guidance,peerOutlooks,
   scenarios:[],sensitivity:[],dcfLink,flags};
 }
 if(!revenue||!alignment||historical.some(x=>x.status!=="supported")){
  return {status:"missing_evidence",historical,guidance,peerOutlooks,
   scenarios:[],sensitivity:[],dcfLink,flags};
 }
 const calc=(s:DriverScenario)=>{
  const amount=revenue.value*Math.pow(1+s.revenueGrowthPercent/100,3);
  return {scenario:s.name,probabilityPercent:s.probabilityPercent,
   thirdYearRevenue:amount,thirdYearEbit:amount*s.ebitMarginPercent/100,
   thirdYearCapex:amount*s.capexPercentRevenue/100,
   thirdYearEbitLessCapex:amount*(s.ebitMarginPercent-s.capexPercentRevenue)/100,
   basePeriod:revPeriod};
 };
 const scenarios=scenarioInputs.map(calc);
 const base=scenarioInputs.find(x=>x.name==="base")!;
 const sensitivity:DriverBridge["sensitivity"]=[
  {name:"revenueGrowth",deltaOnePoint:calc({...base,revenueGrowthPercent:base.revenueGrowthPercent+1}).thirdYearEbitLessCapex
    -calc(base).thirdYearEbitLessCapex},
  {name:"ebitMargin",deltaOnePoint:calc({...base,ebitMarginPercent:base.ebitMarginPercent+1}).thirdYearEbitLessCapex
    -calc(base).thirdYearEbitLessCapex},
  {name:"capexIntensity",deltaOnePoint:calc({...base,capexPercentRevenue:base.capexPercentRevenue+1}).thirdYearEbitLessCapex
    -calc(base).thirdYearEbitLessCapex},
 ].sort((a,b)=>Math.abs(b.deltaOnePoint)-Math.abs(a.deltaOnePoint));
 return {status:"ready",historical,guidance,peerOutlooks,scenarios,sensitivity,dcfLink,flags};
}
