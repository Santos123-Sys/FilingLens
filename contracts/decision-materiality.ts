import type {EvidenceReference,FilingAnalysis,ValuationAssumption} from "./analysis";
import type {FilingDelta} from "./filing-change-intelligence";

export type MaterialitySensitivity={
 driver:"wacc"|"terminal_growth"; deltaPerOnePercentagePoint:number;
 unit:string; method:"local_central_difference"; base:number;
};
export type DecisionReviewItem={
 id:string; kind:"filing_discrepancy"|"assumption_evidence"|"missing_data";
 title:string; detail:string; source:EvidenceReference|null;
 priority:"review_source"|"investigate"|"coverage";
};
export type DecisionMateriality={
 valuationStatus:"ready"|"no_approved_dcf"|"inconsistent_grid";
 sensitivities:MaterialitySensitivity[];
 reviewQueue:DecisionReviewItem[];
 diagnostics:string[];
};
const num=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const evidence=(v:EvidenceReference|null|undefined):v is EvidenceReference=>
 !!v && typeof v.section==="string" && !!v.section.trim() &&
 ((v.kind==="excerpt" && !!v.quote?.trim()) ||
  (v.kind==="citation" && /^https:\/\//.test(v.url??"")));
const assumptionEvidence=(row:ValuationAssumption)=>evidence(row.source);
const nearly=(a:number,b:number)=>Math.abs(a-b)<=Math.max(0.05,Math.abs(b)*0.005);
function dcfSensitivities(data:FilingAnalysis):{
 status:DecisionMateriality["valuationStatus"];rows:MaterialitySensitivity[];note?:string;
}{
 const dcf=data.valuation?.dcf;
 if(!dcf || dcf.status!=="complete")return {status:"no_approved_dcf",rows:[]};
 const w=dcf.sensitivity.wacc,g=dcf.sensitivity.terminal_growth,
  grid=dcf.sensitivity.values;
 const base=dcf.figures.implied_per_share.value,
  baseW=dcf.figures.wacc.value,baseG=dcf.figures.terminal_growth.value;
 if(!num(base)||!num(baseW)||!num(baseG)||w.length!==5||g.length!==5||
    grid.length!==5||grid.some(r=>r.length!==5)||
    !w.every(num)||!g.every(num)||
    w.some((v,i)=>i>0&&v<=w[i-1])||
    g.some((v,i)=>i>0&&v<=g[i-1])||
    !nearly(w[2],baseW)||!nearly(g[2],baseG)||
    !num(grid[2][2])||!nearly(grid[2][2],base))
  return {status:"inconsistent_grid",rows:[],
   note:"DCF center, source assumptions or sensitivity axes do not reconcile; numerical ranking suppressed."};
 const pairs=[
  {driver:"wacc" as const,lo:grid[1][2],hi:grid[3][2],span:w[3]-w[1]},
  {driver:"terminal_growth" as const,lo:grid[2][1],hi:grid[2][3],span:g[3]-g[1]},
 ];
 if(pairs.some(x=>!num(x.lo)||!num(x.hi)||!num(x.span)||x.span<=0))
  return {status:"inconsistent_grid",rows:[],
   note:"Required neighboring DCF scenarios are invalid; sensitivity ranking suppressed."};
 const rows=pairs.map(x=>({
  driver:x.driver,deltaPerOnePercentagePoint:Number(((x.hi!-x.lo!)/x.span).toFixed(4)),
  unit:dcf.figures.implied_per_share.unit,method:"local_central_difference" as const,
  base,
 })).sort((a,b)=>Math.abs(b.deltaPerOnePercentagePoint)-Math.abs(a.deltaPerOnePercentagePoint));
 return {status:"ready",rows};
}
/**
 * Phase 4 — decision-focused research triage, not investment advice.
 * Ranks only *quantified* DCF WACC/terminal-growth sensitivities.
 * Filing differences and missing citations remain review items, not verified facts.
 */
export function buildDecisionMateriality(data:FilingAnalysis,delta?:FilingDelta|null):DecisionMateriality{
 const result=dcfSensitivities(data);
 const queue:DecisionReviewItem[]=[];
 const diagnostics:string[]=[];
 if(result.status==="no_approved_dcf")
  diagnostics.push("No completed, user-approved DCF: valuation sensitivity is unavailable.");
 if(result.note)diagnostics.push(result.note);
 if(result.status==="ready")
  diagnostics.push("Sensitivity is a local central-difference estimate in per-share units per 1 percentage point; not a complete scenario rerun, investment recommendation or a forecast.");
 if(delta?.status==="ready"){
  for(const [i,change] of delta.changes.slice(0,12).entries()){
   const source=change.evidence.current;
   queue.push({id:`filing-${i}`,kind:"filing_discrepancy",
    priority:change.status==="missing_source"?"review_source":"investigate",
    title:`${change.metric} — ${change.period}`,
    detail:`Previously extracted ${change.previous}; currently extracted ${change.current}. Same-period discrepancy; verify original filings before any restatement claim.`,
    source:evidence(source)?source:null});
  }
  if(delta.exclusions.length)diagnostics.push(...delta.exclusions.slice(0,4));
 }
 for(const row of data.valuation?.assumptions.dcf??[]){
  if(row.status==="rejected")continue;
  if(row.status==="proposed"){
   queue.push({id:`pending-${row.id}`,kind:"assumption_evidence",priority:"review_source",
    title:row.label,detail:"Assumption has not been explicitly approved; DCF results cannot be attributed to it.",
    source:evidence(row.source)?row.source:null});
  }else if(!assumptionEvidence(row)){
   queue.push({id:`uncited-${row.id}`,kind:"assumption_evidence",priority:"review_source",
    title:row.label,detail:"Analyst-approved assumption has no filing excerpt or valid external source reference. Approval is not independent corroboration.",
    source:null});
  }
 }
 for(const [i,entry] of data.missingData.slice(0,8).entries()){
  if(!entry.trim())continue;
  queue.push({id:`missing-${i}`,kind:"missing_data",priority:"coverage",
   title:entry.slice(0,180),detail:"Unresolved data-coverage item in the validated analysis.",
   source:null});
 }
 const order={review_source:0,investigate:1,coverage:2};
 queue.sort((a,b)=>order[a.priority]-order[b.priority]);
 return {valuationStatus:result.status,sensitivities:result.rows,
  reviewQueue:queue.slice(0,30),diagnostics};
}
