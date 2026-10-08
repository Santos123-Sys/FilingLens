/**
 * Phase 1: deterministic, source-aware financial history reconciliation.
 * This module deliberately does NOT perform extraction or automatic restatement.
 * Values are in the currency/unit explicitly supplied by each source.
 */
export type PeriodKind = "FY" | "Q" | "YTD" | "LTM";
export type FinancialObservation = {
  metric: string;
  periodEnd: string; // YYYY-MM-DD
  periodKind: PeriodKind;
  fiscalYear: number;
  fiscalQuarter?: 1 | 2 | 3 | 4;
  value: number | null;
  unit: string;
  currency: string | null;
  filingId: string;
  filedAt: string; // YYYY-MM-DD
  sourceSection: string;
  sourceUrl?: string;
};
export type HistoryFlag = {
  code: "INVALID_OBSERVATION" | "CONFLICT" | "MISSING_EVIDENCE" | "UNRESOLVED";
  key: string;
  detail: string;
};
export type ReconciledPoint = FinancialObservation & {
  candidates: FinancialObservation[];
  status: "verified" | "single_source" | "conflicted" | "missing";
};
export type HistoryReconciliation = { points: ReconciledPoint[]; flags: HistoryFlag[] };

/** Never conflate FY, quarter, YTD or LTM, nor combine currencies or units. */
export function observationKey(o: Pick<FinancialObservation,"metric"|"periodEnd"|"periodKind"|"fiscalYear"|"fiscalQuarter"|"unit"|"currency">): string {
  return JSON.stringify([o.metric, o.periodKind, o.fiscalYear, o.fiscalQuarter ?? null, o.periodEnd, o.currency, o.unit]);
}
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
function valid(o: FinancialObservation): boolean {
  return Boolean(o.metric.trim() && o.filingId.trim() && o.unit.trim() && validDate(o.periodEnd) && validDate(o.filedAt)) &&
    (o.value === null || Number.isFinite(o.value)) &&
    Number.isInteger(o.fiscalYear) && o.fiscalYear >= 1900 && o.fiscalYear <= 2200 &&
    (o.periodKind === "Q" ? o.fiscalQuarter !== undefined : o.fiscalQuarter === undefined) &&
    (o.fiscalQuarter === undefined || [1,2,3,4].includes(o.fiscalQuarter));
}
/**
 * Use latest-filed precedence only when observations agree. Conflicting
 * source values remain unresolved, never silently overwritten.
 * Missing values never displace reported values.
 */
export function reconcileFinancialHistory(observations: FinancialObservation[], tolerance = 0.000001): HistoryReconciliation {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Invalid tolerance");
  const flags: HistoryFlag[] = [];
  const groups = new Map<string, FinancialObservation[]>();
  for (const o of observations) {
    if (!valid(o)) {
      flags.push({code:"INVALID_OBSERVATION", key:o.filingId, detail:"Invalid period, fiscal designation, finite value, unit or filing identifier"});
      continue;
    }
    const key = observationKey(o);
    if (!o.sourceSection.trim()) flags.push({code:"MISSING_EVIDENCE", key, detail:`No source section in ${o.filingId}`});
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const points: ReconciledPoint[] = [];
  for (const [key, values] of groups) {
    const candidates = [...values].sort((a,b)=> b.filedAt.localeCompare(a.filedAt) || b.filingId.localeCompare(a.filingId));
    const present = candidates.filter(x=>x.value !== null);
    const chosen = present[0] ?? candidates[0];
    const distinct = present.some(x=>!close(x.value!, present[0].value!, tolerance));
    const status: ReconciledPoint["status"] = distinct ? "conflicted" : !present.length ? "missing" : present.length > 1 ? "verified" : "single_source";
    if (distinct) flags.push({code:"CONFLICT",key,detail:`Different reported values across ${[...new Set(present.map(x=>x.filingId))].join(", ")}; manual restatement review required`});
    if (distinct) flags.push({code:"UNRESOLVED",key,detail:"Conflicting values must not enter calculations without review"});
    points.push({...chosen, value: distinct ? null : chosen.value, candidates, status});
  }
  return {points:points.sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd) || a.metric.localeCompare(b.metric)), flags};
}
function close(a:number,b:number,tolerance:number):boolean {
  return Math.abs(a-b) <= tolerance * Math.max(1,Math.abs(a),Math.abs(b));
}

/** Produces an explicit period-aligned series. Missing/conflicted values remain null. */
export function seriesForMetric(result: HistoryReconciliation, metric: string, kind: PeriodKind) {
  return result.points.filter(p=>p.metric === metric && p.periodKind === kind)
    .map(p=>({periodEnd:p.periodEnd, fiscalYear:p.fiscalYear, fiscalQuarter:p.fiscalQuarter ?? null, value:p.value, status:p.status, filingId:p.filingId, sourceSection:p.sourceSection}));
}
