import { runDcf, validateValuationInputs, DEFAULT_DRIVER_SPECS, type DriverKey, type ValuationInputs } from "./value-driver-intelligence";

/** Explicitly assumed symmetric triangular ranges, NOT estimated return probabilities. */
export type Distribution = { key: DriverKey; halfWidthPp: number; basis: "analyst_scenario"; };
export type ProbabilisticRisk = {
  method: "seeded_triangular_monte_carlo";
  assumptionStatus: "scenario_conditional_not_calibrated";
  seed: number; accepted: number; rejected: number; attempts: number;
  correlationGrowthMargin: number;
  p10EvBn: number; p50EvBn: number; p90EvBn: number;
  p10EquityBn: number; p50EquityBn: number; p90EquityBn: number;
  probabilityBelowObservedEV: number | null;
  driverRiskPriority: Array<{ key: DriverKey; halfWidthPp: number; localImpactBn: number | null; scoreBn: number | null }>;
  histogram: Array<{ minimumEvBn: number; maximumEvBn: number; count: number }>;
};
export const DEFAULT_RISK_RANGES: Distribution[] = [
  { key: "growthPct", halfWidthPp: 4, basis: "analyst_scenario" },
  { key: "operatingMarginPct", halfWidthPp: 4, basis: "analyst_scenario" },
  { key: "cashTaxPct", halfWidthPp: 3, basis: "analyst_scenario" },
  { key: "reinvestmentPct", halfWidthPp: 10, basis: "analyst_scenario" },
  { key: "waccPct", halfWidthPp: 1.5, basis: "analyst_scenario" },
  { key: "terminalGrowthPct", halfWidthPp: 0.75, basis: "analyst_scenario" },
  { key: "terminalRoicPct", halfWidthPp: 7, basis: "analyst_scenario" },
];
const VALID_KEYS = new Set<DriverKey>(DEFAULT_DRIVER_SPECS.map(x => x.key));
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {state += 0x6D2B79F5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
function normal(random: () => number):number {
  return Math.sqrt(-2*Math.log(Math.max(1e-12,random()))) * Math.cos(2*Math.PI*random());
}
function normalCdf(x:number):number {
  // Abramowitz-Stegun rational approximation, maximum absolute error ≈ 7.5e-8.
  const ax=Math.abs(x), t=1/(1+0.2316419*ax), d=0.3989422804014327*Math.exp(-0.5*ax*ax);
  const q=d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x >= 0 ? 1-q : q;
}
function triangle(u:number):number {
  // Symmetric triangular quantile in [-1,1], mode at zero.
  return u < 0.5 ? Math.sqrt(2*u)-1 : 1-Math.sqrt(2*(1-u));
}
function quantile(sorted:number[],q:number):number {
  const x=q*(sorted.length-1),low=Math.floor(x),high=Math.ceil(x);
  return sorted[low]+(sorted[high]-sorted[low])*(x-low);
}
export function simulateValueDriverRisk(p:ValuationInputs, options?: {
  distributions?:Distribution[]; draws?:number; seed?:number;
  observedEnterpriseValueBn?:number|null; growthMarginCorrelation?:number;
}):ProbabilisticRisk {
  validateValuationInputs(p);
  const draws=options?.draws??1200,seed=options?.seed??18267;
  const corr=options?.growthMarginCorrelation??0;
  if(!Number.isInteger(draws)||draws<200||draws>5000||!Number.isSafeInteger(seed)||
    !Number.isFinite(corr)||Math.abs(corr)>0.85)throw Error("invalid_monte_carlo_parameters");
  const distributions=options?.distributions??DEFAULT_RISK_RANGES;
  const keys=new Set<string>();
  if(distributions.length<1||distributions.length>7)throw Error("invalid_distribution_count");
  for(const x of distributions){
    if(!VALID_KEYS.has(x.key)||keys.has(x.key)||x.basis!=="analyst_scenario"||
      !Number.isFinite(x.halfWidthPp)||x.halfWidthPp<0||x.halfWidthPp>30)throw Error("invalid_distribution");
    keys.add(x.key);
  }
  const obs=options?.observedEnterpriseValueBn??null;
  if(obs!==null&&(!Number.isFinite(obs)||obs<=0))throw Error("invalid_market_value");
  const random=rng(seed),values:number[]=[];
  let attempts=0,rejected=0;
  const maxAttempts=draws*8;
  while(values.length<draws&&attempts<maxAttempts){
    attempts++;
    const zGrowth=normal(random),zMargin=corr*zGrowth+Math.sqrt(1-corr*corr)*normal(random);
    const candidate={...p};
    for(const x of distributions){
      const z=x.key==="growthPct"?zGrowth:x.key==="operatingMarginPct"?zMargin:normal(random);
      candidate[x.key]=p[x.key]+triangle(normalCdf(z))*x.halfWidthPp;
    }
    try{
      const ev=runDcf(candidate).enterpriseValueBn;
      if(!Number.isFinite(ev)||ev<=0)throw Error("invalid_EV");
      values.push(ev);
    }catch{rejected++;}
  }
  if(values.length<draws)throw Error("invalid_sampling_space");
  values.sort((a,b)=>a-b);
  const min=values[0],max=values[values.length-1],bins=12,span=Math.max(1e-6,max-min);
  const histogram=Array.from({length:bins},(_,i)=>({
    minimumEvBn:min+i*span/bins,maximumEvBn:min+(i+1)*span/bins,count:0,
  }));
  for(const ev of values)histogram[Math.min(bins-1,Math.floor((ev-min)/span*bins))].count++;
  const localImpact=(key:DriverKey,halfWidthPp:number)=>{
    try{
      const down=runDcf({...p,[key]:p[key]-halfWidthPp}).enterpriseValueBn;
      const up=runDcf({...p,[key]:p[key]+halfWidthPp}).enterpriseValueBn;
      return (Math.abs(up-runDcf(p).enterpriseValueBn)+Math.abs(down-runDcf(p).enterpriseValueBn))/2;
    }catch{return null;}
  };
  const driverRiskPriority=distributions.map(x=>({
    key:x.key,halfWidthPp:x.halfWidthPp,localImpactBn:localImpact(x.key,x.halfWidthPp),
    scoreBn:localImpact(x.key,x.halfWidthPp),
  })).sort((a,b)=>(b.scoreBn??-1)-(a.scoreBn??-1));
  // Event probability conditional on user-provided uncertainty ranges; not an empirical market frequency.
  const countBelow=obs===null?null:values.filter(x=>x<obs).length/draws;
  return {
    method:"seeded_triangular_monte_carlo",assumptionStatus:"scenario_conditional_not_calibrated",
    seed,accepted:values.length,rejected,attempts,correlationGrowthMargin:corr,
    p10EvBn:quantile(values,0.1),p50EvBn:quantile(values,0.5),p90EvBn:quantile(values,0.9),
    p10EquityBn:quantile(values,0.1)-p.netDebtBn,
    p50EquityBn:quantile(values,0.5)-p.netDebtBn,
    p90EquityBn:quantile(values,0.9)-p.netDebtBn,
    probabilityBelowObservedEV:countBelow,driverRiskPriority,histogram,
  };
}
