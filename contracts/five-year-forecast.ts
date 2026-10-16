import {z} from "zod";
import {isoDate} from "./forecast-evaluation";
import {availableYear, checkedVintages, consecutiveTraining, vintageSchema} from "./forecast-qualification";
import type {RevenueVintage} from "./forecast-qualification";

export const FIVE_YEAR_MODEL = "bounded-median-damped.v3" as const;
export const planningInputSchema = z.object({observations:vintageSchema.array().min(1).max(100),origin:isoDate}).strict();
const median = (values:number[]) => {
  const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
};

/** Fixed before fresh issuer scoring. Bounds constrain predictions, never actuals. */
export function fiveYearPath(values:number[]) {
  if(values.length<5 || values.some(v=>!Number.isFinite(v)||v<=0||v>1e12))
    throw Error("five_positive_annual_observations_required");
  const recent=values.slice(-6);
  const rawLogGrowth=median(recent.slice(1).map((value,i)=>Math.log(value)-Math.log(recent[i])));
  const boundedLogGrowth=Math.max(Math.log(.8),Math.min(Math.log(1.25),rawLogGrowth));
  let revenue=values.at(-1)!;
  const rows=Array.from({length:5},(_,i)=>{
    // These exact six-decimal drivers also seed the existing DCF calculation.
    const growthPercent=Number((Math.expm1(boundedLogGrowth*Math.pow(.8,i))*100).toFixed(6));
    revenue*=1+growthPercent/100;
    if(!Number.isFinite(revenue)||revenue<=0)throw Error("unsupported_nonfinite_or_nonpositive_path");
    return {horizon:i+1,growthPercent,revenue};
  });
  const rawPercent=Math.expm1(rawLogGrowth)*100;
  return {modelVersion:FIVE_YEAR_MODEL,rawMedianGrowthPercent:Number.isFinite(rawPercent)?rawPercent:null,
    boundedInitialGrowthPercent:Math.expm1(boundedLogGrowth)*100,
    boundsApplied:rawLogGrowth!==boundedLogGrowth,rows};
}

export type CalibrationCase={id:string;issuer:string;origin:string;horizon:number;targetYear:number;
  scale:number;prediction:number;currency:RevenueVintage["currency"];definition:string;trainingIds:string[];
  targetVintages:RevenueVintage[]};

/** Only the declared development issuers may supply calibration labels. */
export function buildDevelopmentCalibration(raw:RevenueVintage[],allowedIssuers:readonly string[]):CalibrationCase[] {
  const allowed=new Set(allowedIssuers);
  if(raw.some(r=>!allowed.has(r.issuer)))throw Error("held_out_issuer_in_calibration");
  const pool:CalibrationCase[]=[];
  for(const issuer of allowed){
    const subset=raw.filter(r=>r.issuer===issuer); if(!subset.length)continue;
    const rows=checkedVintages(subset);
    const first=Math.min(...rows.map(r=>r.fiscalYear))+5,last=Math.max(...rows.map(r=>r.fiscalYear))+1;
    for(let year=first;year<=last;year++){
      const origin=`${year}-07-01`,training=consecutiveTraining(rows,origin);
      if(training.length<5)continue;
      const base=training.at(-1)!,path=fiveYearPath(training.map(r=>r.value));
      for(const f of path.rows)pool.push({id:`${issuer}:${origin}:h${f.horizon}`,issuer,origin,horizon:f.horizon,
        targetYear:year+f.horizon-1,scale:base.value,prediction:f.revenue,currency:base.currency,
        definition:base.definition,trainingIds:training.map(r=>r.id),
        targetVintages:rows.filter(r=>r.fiscalYear===year+f.horizon-1)});
    }
  }
  return pool;
}

export function empiricalBand(pool:readonly CalibrationCase[],origin:string,horizon:number,prediction:number,base:number,currency:string){
  const known=currency!=="BRL"?[]:pool.filter(p=>p.origin<origin&&p.horizon===horizon&&p.currency==="BRL")
    .flatMap(p=>{
      const actual=availableYear(p.targetVintages,p.targetYear,origin);
      return actual&&actual.currency===p.currency&&actual.definition===p.definition
        ? [{id:p.id,issuer:p.issuer,error:Math.abs(p.prediction-actual.value)/p.scale,targetId:actual.id,publishedOn:actual.publishedOn}] : [];
    });
  const issuerCount=new Set(known.map(p=>p.issuer)).size;
  const rank=Math.ceil((known.length+1)*.8);
  const sorted=known.map(p=>p.error).sort((a,b)=>a-b);
  const q=known.length>=30&&issuerCount>=10&&rank<=known.length?sorted[rank-1]:null;
  const lower=q===null?null:Math.max(0,prediction-q*base),upper=q===null?null:prediction+q*base;
  const valid=q!==null&&Number.isFinite(q)&&Number.isFinite(lower)&&Number.isFinite(upper);
  return {status:currency!=="BRL"?"unsupported_calibration_universe":q===null?"insufficient_pre_origin_development_errors":valid?"empirical_not_guaranteed":"nonfinite_calibration_or_bounds",
    interval:valid?{lower:lower!,upper:upper!,nominalPercent:80 as const}:null,
    calibrationCount:known.length,calibrationIssuers:issuerCount,
    calibrationPool:`development-only:${origin}:h${horizon}`,
    calibrationIds:known.map(p=>p.id),sourceCutoff:origin};
}

/** Five coherent annual rows; no future labels or horizon-wise model switching. */
export function fiveYearPlan(raw:unknown,pool:readonly CalibrationCase[]=[]){
  const input=planningInputSchema.parse(raw),rows=checkedVintages(input.observations);
  if(!input.origin.endsWith("-07-01"))throw Error("July_1_calendar_origin_required");
  const training=consecutiveTraining(rows,input.origin),base=training.at(-1);
  const common={schemaVersion:"five-year-forecast.v3" as const,modelVersion:FIVE_YEAR_MODEL,issuer:rows[0].issuer,
    origin:input.origin,sourceCutoff:input.origin,trainingIds:training.map(r=>r.id),
    currency:base?.currency??null,baseYear:base?.fiscalYear??null,baseRevenue:base?.value??null,
    publicationStatus:"reviewed_scenario_only" as const,
    limitations:["A five-year planning horizon is not five-year accuracy proof.",
      "Historical CVM qualification is per horizon, not a guarantee for this issuer or future years.",
      "Bands use only earlier-filed development-issuer errors, not held-out outcomes; pooling need not be exchangeable.",
      "User-edited drivers, margins, cash flow, terminal assumptions, fair value and returns are unvalidated."]};
  if(training.length<5||!base)return {...common,status:"unavailable" as const,reason:"five_consecutive_available_positive_annuals_required",
    boundsApplied:false,rawMedianGrowthPercent:null,boundedInitialGrowthPercent:null,rows:[]};
  const path=fiveYearPath(training.map(r=>r.value));
  return {...common,status:"conditional_five_year_plan" as const,reason:null,
    boundsApplied:path.boundsApplied,rawMedianGrowthPercent:path.rawMedianGrowthPercent,boundedInitialGrowthPercent:path.boundedInitialGrowthPercent,
    rows:path.rows.map(f=>({...f,targetYear:Number(input.origin.slice(0,4))+f.horizon-1,
      band:empiricalBand(pool,input.origin,f.horizon,f.revenue,base.value,base.currency)}))};
}
export type FiveYearPlan=ReturnType<typeof fiveYearPlan>;
