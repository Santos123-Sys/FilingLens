import type { EvidenceReference, FilingAnalysis } from "./analysis";

/**
 * Phase 3 — deterministic point-in-time filing comparison.
 * Never equate two model extractions with audited restatement evidence.
 * Cross-filing numerical changes are REVIEW CANDIDATES, not proven restatements.
 */
const METRICS = [
 "revenue","grossProfit","ebit","netIncome","operatingCashFlow",
 "capex","freeCashFlow","totalAssets","totalLiabilities","totalEquity",
 "totalDebt","cash",
] as const;
type Metric = typeof METRICS[number];
export type FilingChange = {
 metric: Metric; period: string; previous: number; current: number;
 difference: number; percentChange: number | null;
 evidence: {previous: EvidenceReference | null; current: EvidenceReference | null};
 status: "review_with_two_sources" | "missing_source";
};
export type FilingDelta = {
 status: "ready" | "identity_mismatch" | "incomparable" | "invalid_input";
 previous: {company: string; period: string; filedAt: string | null};
 current: {company: string; period: string; filedAt: string | null};
 changes: FilingChange[];
 addedPeriods: string[];
 removedPeriods: string[];
 addedRiskTitles: string[];
 removedRiskTitles: string[];
 exclusions: string[];
 notes: string[];
};
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const year = (s: string): number | null => {
 const match = /^(?:FY\s*)?(20\d{2})$/i.exec(s.trim());
 return match ? Number(match[1]) : null;
};
const date = (s: string | null | undefined): boolean =>
 !!s && /^20\d{2}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) &&
 new Date(s).toISOString().slice(0,10) === s;
const supportedSource = (ref: EvidenceReference | null | undefined): ref is EvidenceReference =>
 !!ref && !!ref.section.trim() && (
  (ref.kind === "excerpt" && !!ref.quote?.trim()) ||
  (ref.kind === "citation" && !!ref.url?.startsWith("https://"))
 );
const metricSource = (data: FilingAnalysis, metric: string, period: string): EvidenceReference | null =>
 data.financials.evidence?.find(x => x.metric === metric &&
  year(x.period ?? "") === year(period) && supportedSource(x.source))?.source ?? null;
const series = (data: FilingAnalysis, metric: Metric): Map<number, number> | null => {
 const values = data.financials[metric];
 const periods = data.financials.years;
 if (!Array.isArray(values) || values.length !== periods.length || !periods.length) return null;
 const result = new Map<number, number>();
 for (let i = 0; i < periods.length; i++) {
  const fy = year(periods[i]), value = values[i];
  if (fy === null || result.has(fy) || !Number.isFinite(value)) return null;
  result.set(fy, value);
 }
 return result;
};
const identity = (a: FilingAnalysis, b: FilingAnalysis) => {
 if (a.jurisdiction !== b.jurisdiction) return false;
 const key = a.jurisdiction === "us" ? "cik" : "cnpj";
 const left = a.metadata[key]?.replace(/\D/g, "");
 const right = b.metadata[key]?.replace(/\D/g, "");
 if (left || right) return !!left && left === right;
 // Without regulator IDs, exact ticker/exchange/name matches are only a
 // conservative secondary key. No fuzzy issuer matching.
 return !!a.company.ticker && !!b.company.ticker &&
  normalize(a.company.ticker) === normalize(b.company.ticker) &&
  !!a.company.exchange && !!b.company.exchange &&
  normalize(a.company.exchange) === normalize(b.company.exchange) &&
  normalize(a.company.name) === normalize(b.company.name);
};
const valid = (x: unknown): x is FilingAnalysis => {
 if (!x || typeof x !== "object") return false;
 const a = x as Partial<FilingAnalysis>;
 return a.schemaVersion === "2.0" &&
  (a.jurisdiction === "us" || a.jurisdiction === "br") &&
  typeof a.company?.name === "string" && !!a.company.name.trim() &&
  typeof a.company?.periodEnd === "string" &&
  !!a.metadata && typeof a.financials?.unit === "string" &&
  Array.isArray(a.financials?.years) && Array.isArray(a.risks) &&
  a.financials.years.length <= 5 && a.risks.length <= 15 &&
  a.financials.years.every(y => typeof y === "string") &&
  a.risks.every(r => !!r && typeof r.title === "string") &&
  (!a.metadata.cik || typeof a.metadata.cik === "string") &&
  (!a.metadata.cnpj || typeof a.metadata.cnpj === "string") &&
  (!a.company.filedAt || typeof a.company.filedAt === "string") &&
  (!a.financials.evidence || (Array.isArray(a.financials.evidence) &&
   a.financials.evidence.every(e => !!e && typeof e.metric === "string" &&
    (e.period === null || typeof e.period === "string") &&
    !!e.source && typeof e.source.section === "string"))) &&
  METRICS.every(metric => {
   const values = a.financials?.[metric];
   return values === null || values === undefined ||
    (Array.isArray(values) && values.every(v => typeof v === "number" && Number.isFinite(v)));
  });
};
const empty = (status: FilingDelta["status"], prior: FilingAnalysis, current: FilingAnalysis,
 exclusions: string[]): FilingDelta => ({
 status, previous: {company: prior.company.name, period: prior.company.periodEnd,
  filedAt: prior.company.filedAt}, current: {company: current.company.name,
  period: current.company.periodEnd, filedAt: current.company.filedAt},
 changes: [], addedPeriods: [], removedPeriods: [], addedRiskTitles: [],
 removedRiskTitles: [], exclusions, notes: [],
});
export function compareFilingAnalyses(priorInput: unknown, currentInput: unknown): FilingDelta {
 if (!valid(priorInput) || !valid(currentInput))
  return {status:"invalid_input",previous:{company:"",period:"",filedAt:null},
   current:{company:"",period:"",filedAt:null},changes:[],addedPeriods:[],
   removedPeriods:[],addedRiskTitles:[],removedRiskTitles:[],
   exclusions:["Both inputs must be FilingLens 2.0 analysis JSON objects."],notes:[]};
 const prior = priorInput, current = currentInput;
 if (!identity(prior,current))
  return empty("identity_mismatch",prior,current,["Regulator issuer ID or strict ticker/exchange/name identity does not match."]);
 if (!date(prior.company.filedAt) || !date(current.company.filedAt) ||
     prior.company.filedAt >= current.company.filedAt)
  return empty("incomparable",prior,current,["Valid, strictly increasing filing dates are required."]);
 const p = prior.financials, c = current.financials;
 const comparable = p.unit.trim() && p.unit === c.unit &&
  p.accountingBasis && p.accountingBasis !== "unknown" &&
  p.accountingBasis === c.accountingBasis &&
  p.statementScope && p.statementScope !== "unknown" &&
  p.statementScope === c.statementScope &&
  !!prior.metadata.fiscalYearEnd && prior.metadata.fiscalYearEnd === current.metadata.fiscalYearEnd;
 const exclusions: string[] = [];
 if (!comparable) exclusions.push("Numerical comparison requires the same reported unit, known accounting basis, consolidated/standalone scope and explicit fiscal-year-end.");
 const changes: FilingChange[] = [];
 if (comparable) for (const metric of METRICS) {
  const left = series(prior,metric), right = series(current,metric);
  if (!left || !right) {exclusions.push(`Excluded ${metric}: missing, duplicate, non-FY or nonfinite period-aligned series.`);continue;}
  for (const [fy,previous] of left) {
   const next = right.get(fy);
   if (next === undefined) continue;
   const difference = next - previous;
   if (Math.abs(difference) <= Math.max(1e-9,Math.abs(previous)*1e-9)) continue;
   const period = `FY${fy}`;
   const oldSource = metricSource(prior,metric,period);
   const newSource = metricSource(current,metric,period);
   changes.push({metric,period,previous,current:next,difference,
    percentChange:previous===0?null:difference/Math.abs(previous)*100,
    evidence:{previous:oldSource,current:newSource},
    status:oldSource&&newSource?"review_with_two_sources":"missing_source"});
  }
 }
 const periodSet = (a: FilingAnalysis) => new Set(a.financials.years
  .map(year).filter((x):x is number=>x!==null));
 const oldYears=periodSet(prior),newYears=periodSet(current);
 const riskSet=(a:FilingAnalysis)=>new Map(a.risks.filter(r=>r.title.trim())
  .map(r=>[normalize(r.title),r.title]));
 const oldRisks=riskSet(prior),newRisks=riskSet(current);
 return {...empty("ready",prior,current,exclusions),changes:changes.sort((a,b)=>
  Math.abs(b.percentChange??0)-Math.abs(a.percentChange??0)),
  addedPeriods:[...newYears].filter(y=>!oldYears.has(y)).sort().map(y=>`FY${y}`),
  removedPeriods:[...oldYears].filter(y=>!newYears.has(y)).sort().map(y=>`FY${y}`),
  addedRiskTitles:[...newRisks].filter(([k])=>!oldRisks.has(k)).map(([,v])=>v),
  removedRiskTitles:[...oldRisks].filter(([k])=>!newRisks.has(k)).map(([,v])=>v),
  notes:["Changed figures are extraction discrepancies or restatement REVIEW CANDIDATES, not confirmed regulatory restatements.",
   "Risk-title changes reflect exact normalized wording only, not semantic risk addition or removal.",
   "Newly available fiscal periods are not interpreted as year-over-year growth.",
   "Original filings and dated source evidence must be reviewed before acting."],
 };
}
