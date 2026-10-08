import type { FinancialsResult, EvidenceReference } from "./analysis";
import { reconcileFinancialHistory, type FinancialObservation, type HistoryFlag } from "./financial-history";

type AnnualHistory = NonNullable<FinancialsResult["financials"]["annualHistory"]>;
const METRICS = ["revenue","grossProfit","ebit","netIncome","operatingCashFlow","capex","totalAssets","totalLiabilities","totalEquity","totalDebt","cash"] as const;
type Metric = typeof METRICS[number];
export type AnnualHistoryBuild = { history: AnnualHistory | null; flags: HistoryFlag[]; excluded: number };

/**
 * Only produces a common-currency/common-unit five-year FY series. Unlike the
 * display contract, observations retain exact period ends and full filing
 * provenance, so nothing here should be treated as automatic restatement.
 */
export function buildAnnualHistory(observations: FinancialObservation[]): AnnualHistoryBuild {
  const reconciled = reconcileFinancialHistory(observations);
  const flags = [...reconciled.flags];
  const fy = reconciled.points.filter(p => p.periodKind === "FY" && (METRICS as readonly string[]).includes(p.metric));
  if (!fy.length) return {history:null, flags, excluded:reconciled.points.length};
  // Never use unknown currencies in a historical currency series.
  const usable = fy.filter(p => p.currency && p.sourceSection.trim() && p.status !== "conflicted");
  if (!usable.length) return {history:null,flags,excluded:reconciled.points.length};
  // Select the latest explicitly identified FY/currency/unit cohort; reject all
  // other cohorts rather than inventing conversions.
  const anchor = [...usable].sort((a,b) => b.periodEnd.localeCompare(a.periodEnd) || b.filedAt.localeCompare(a.filedAt))[0];
  const cohort = fy.filter(p=>p.currency === anchor.currency && p.unit === anchor.unit && p.sourceSection.trim());
  const years = [...new Set(cohort.map(p=>p.fiscalYear))].sort((a,b)=>b-a).slice(0,5).sort((a,b)=>a-b);
  const excluded = reconciled.points.length - cohort.filter(p=>years.includes(p.fiscalYear)).length;
  // Fiscal year label must map to exactly one date. Do not silently merge
  // changed year-ends or period definitions into a single annual point.
  for (const year of years) {
    const ends = new Set(cohort.filter(p=>p.fiscalYear===year).map(p=>p.periodEnd));
    if (ends.size > 1) {
      flags.push({code:"UNRESOLVED",key:String(year),detail:"Different period end dates for the same fiscal year"});
      return {history:null,flags,excluded};
    }
  }
  const lookup = (metric: Metric,year:number): number|null => {
    const found = cohort.find(p=>p.metric===metric && p.fiscalYear===year);
    return found && found.status !== "conflicted" ? found.value : null;
  };
  const data = Object.fromEntries(METRICS.map(m=>[m, years.map(y=>lookup(m,y))])) as Record<Metric,Array<number|null>>;
  const sourceMap = new Map<string,EvidenceReference>();
  for (const p of cohort.filter(p=>years.includes(p.fiscalYear) && p.value !== null && p.status!=="conflicted")) {
    const key = p.filingId+"|"+p.sourceSection;
    sourceMap.set(key,{section:p.sourceSection,sourceForm:p.filingId,url:p.sourceUrl});
  }
  const sources = [...sourceMap.values()].slice(0,12);
  const status = years.length===5 && Object.values(data).every(v=>v.every(x=>x!==null)) ? "complete" : "partial";
  const history: AnnualHistory = {
    years:years.map(String),unit:`${anchor.currency} ${anchor.unit}`,provider:"reconciled-filing-observations",status,
    ...data,sources,
  };
  return {history,flags,excluded};
}
