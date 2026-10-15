import type {FinancialsResult} from '../contracts/analysis';

const normalized=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim();
export function hasCompleteMetricEvidence(financials:FinancialsResult['financials'],metrics:string[]):boolean{
 return financials.years.length>0&&metrics.length>0&&metrics.every(metric=>
  financials.years.every(period=>(financials.evidence??[]).some(row=>row.metric===metric&&row.period===period)));
}
/** Bind model citations before any downstream tool can assign evidence confidence.
 * Exact text existence does not establish entailment, units or column selection.
 */
export function bindFinancialEvidence(result:FinancialsResult,excerpt:string):FinancialsResult{
 const financials=result.financials;
 const source=normalized(excerpt);
 const periods=new Set(financials.years.map(normalized));
 let rejected=0;
 const evidence=(financials.evidence??[]).filter(row=>{
  const quote=normalized(row.source.quote??'');
  const series=Object.hasOwn(financials,row.metric)?financials[row.metric as keyof typeof financials]:null;
  const valid=Array.isArray(series)&&series.length>0&&series.every(value=>typeof value==='number')&&
   row.period!==null&&periods.has(normalized(row.period))&&quote.length>=10&&source.includes(quote);
  if(!valid)rejected++;
  return valid;
 });
 const flags=[...(financials.validationFlags??[])];
 if(rejected)flags.push({code:'FINANCIAL_EVIDENCE_REJECTED',severity:'warning',
  note:`${rejected} financial citation(s) removed: exact source text, canonical metric or period binding failed.`});
 const missing=Object.entries(financials).some(([metric,values])=>Array.isArray(values)&&values.length>0&&
  values.every(value=>typeof value==='number')&&financials.years.some(period=>!evidence.some(row=>row.metric===metric&&row.period===period)));
 if(missing)flags.push({code:'FINANCIAL_EVIDENCE_INCOMPLETE',severity:'warning',
  note:'Some extracted numeric series lack a bound source quote per period; values require human verification.'});
 return {financials:{...financials,evidence,validationFlags:flags.slice(0,100)}};
}
