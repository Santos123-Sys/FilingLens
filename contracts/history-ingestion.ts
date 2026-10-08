import type { FinancialsResult, EvidenceReference } from "./analysis";
import type { FinancialObservation } from "./financial-history";
import { reconcileFinancialHistory } from "./financial-history";

type Financials = FinancialsResult["financials"];
export type FilingPeriod = { label: string; endDate: string; fiscalYear: number; periodKind: "FY" | "Q" | "YTD" | "LTM"; fiscalQuarter?: 1|2|3|4 };
export type IngestionIssue = { code: "INVALID_INPUT" | "NO_EVIDENCE" | "MISALIGNED_SERIES" | "NO_VALUES"; metric: string; period: string; detail: string };
export type IngestionResult = { observations: FinancialObservation[]; issues: IngestionIssue[] };
const FIELDS = ["revenue","grossProfit","ebit","ebitda","adjustedEbitda","incomeBeforeTax","incomeTaxExpense","reportedRoic","netIncome","eps","grossMargin","operatingMargin","operatingCashFlow","capex","freeCashFlow","dividends","buybacks","totalAssets","totalLiabilities","totalEquity","totalDebt","shortTermDebt","longTermDebt","cash","currentAssets","currentLiabilities","interestExpense","accountsReceivable","inventory","accountsPayable","costOfGoodsSold","goodwill"] as const;
type Field = typeof FIELDS[number];
/**
 * Ingestion is deliberately evidence-first. A filing's free-form year labels
 * do not identify a fiscal period end. Callers must provide validated period
 * metadata and filing ID; otherwise facts are omitted.
 *
 * Values use existing filing extraction units. No conversion or inference.
 * Null values are missing observations; they never become numeric zero.
 */
export function prepareFinancialObservations(input:{
 financials:Financials; periods:FilingPeriod[]; filingId:string; filedAt:string;
 currency:string; unit:string; sourceUrl?:string;
}):IngestionResult {
 const {financials,periods,filingId,filedAt,currency,unit,sourceUrl}=input;
 const issues:IngestionIssue[]=[];
 const observations:FinancialObservation[]=[];
 if(!filingId.trim() || !currency.trim() || !unit.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(filedAt)) {
   return {observations,issues:[{code:"INVALID_INPUT",metric:"*",period:"*",detail:"Verified filing identity, date, currency and units required"}]};
 }
 if(periods.length!==financials.years.length || periods.some((p,i)=>p.label!==financials.years[i])) {
   return {observations,issues:[{code:"MISALIGNED_SERIES",metric:"*",period:"*",detail:"Periods must match the existing financial years exactly and in order"}]};
 }
 const evidence = financials.evidence ?? [];
 for(const field of FIELDS) {
   const values = financials[field] as number[]|null|undefined;
   if(!values) continue;
   if(values.length!==periods.length) {
     issues.push({code:"MISALIGNED_SERIES",metric:field,period:"*",detail:"Numeric series length differs from period list"});
     continue;
   }
   for(let i=0;i<periods.length;i++) {
     const p=periods[i],value=values[i];
     if(!Number.isFinite(value)) {
       issues.push({code:"INVALID_INPUT",metric:field,period:p.label,detail:"Non-finite value omitted"});
       continue;
     }
     const source = evidence.find(x=>x.metric===field && x.period===p.label)?.source;
     if(!source?.section?.trim()) {
       issues.push({code:"NO_EVIDENCE",metric:field,period:p.label,detail:"No period-specific filing evidence; omitted rather than inventing a source"});
       continue;
     }
     observations.push({
       metric:field,periodEnd:p.endDate,periodKind:p.periodKind,fiscalYear:p.fiscalYear,
       ...(p.fiscalQuarter!==undefined?{fiscalQuarter:p.fiscalQuarter}:{}),
       value,unit,currency,filingId,filedAt,sourceSection:source.section,sourceUrl:source.url ?? sourceUrl,
     });
   }
 }
 const validated = reconcileFinancialHistory(observations);
 if(validated.flags.some(f=>f.code==="INVALID_OBSERVATION")) {
   return {observations:observations.filter(o=> !validated.flags.some(f=>f.code==="INVALID_OBSERVATION" && f.key===o.filingId)),issues:[...issues,{code:"INVALID_INPUT",metric:"*",period:"*",detail:"Observation validation failed"}]};
 }
 if(!observations.length) issues.push({code:"NO_VALUES",metric:"*",period:"*",detail:"No evidence-supported numeric values found"});
 return {observations,issues};
}
