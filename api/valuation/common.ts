import type { FilingAnalysis, ValuationAssumption, ValuationAssumptionValue, ValuationMethod } from "../../contracts/analysis";
import { valuationAssumptionSchema } from "../../contracts/analysis";

export class ValuationInputError extends Error {
  constructor(message: string) { super(message); this.name = "ValuationInputError"; }
}
export class ValuationGateError extends Error {
  constructor(message: string, public pending: string[]) { super(message); this.name = "ValuationGateError"; }
}

export const latest = (v: number[] | null | undefined) => v?.length && Number.isFinite(v.at(-1)) ? v.at(-1)! : null;
export const prior = (v: number[] | null | undefined) => v && v.length > 1 && Number.isFinite(v.at(-2)) ? v.at(-2)! : null;
export const round = (v: number, n = 2) => Number(v.toFixed(n));
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function makeAssumption(method: ValuationMethod, id: string, category: string, label: string, value: ValuationAssumptionValue, unit: string | null, rationale: string, confidence: "high" | "medium" | "low", impact: "high" | "medium" | "low"): ValuationAssumption {
  return { id, method, category, label, proposed_value: value, unit, rationale, confidence, impact, status: "proposed" };
}

export function validatedRows(method: ValuationMethod, assumptions: ValuationAssumption[]) {
  const parsed = assumptions.map(row => valuationAssumptionSchema.parse(row));
  const wrong = parsed.filter(row => row.method !== method);
  if (wrong.length) throw new ValuationInputError("assumption_method_mismatch");
  const pending = parsed.filter(row => row.status === "proposed").map(row => row.id);
  if (pending.length) throw new ValuationGateError("assumptions_require_validation", pending);
  return new Map(parsed.map(row => [row.id, row]));
}

export function resolved(row: ValuationAssumption): ValuationAssumptionValue {
  return row.status === "edited" ? row.final_value ?? row.proposed_value : row.proposed_value;
}
export function num(rows: Map<string, ValuationAssumption>, id: string): number {
  const row = rows.get(id);
  if (!row || row.status === "rejected") throw new ValuationInputError(`missing_${id}`);
  const value = resolved(row);
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new ValuationInputError(`invalid_${id}`);
  return n;
}
export function text(rows: Map<string, ValuationAssumption>, id: string): string {
  const row = rows.get(id);
  if (!row || row.status === "rejected") throw new ValuationInputError(`missing_${id}`);
  const value = resolved(row);
  if (typeof value !== "string" || !value.trim()) throw new ValuationInputError(`invalid_${id}`);
  return value;
}

export function netDebt(a: FilingAnalysis) {
  const debt = latest(a.financials.totalDebt), cash = latest(a.financials.cash);
  return debt === null || cash === null ? null : debt - cash;
}
export function shares(a: FilingAnalysis) {
  const ni = latest(a.financials.netIncome), eps = latest(a.financials.eps);
  if (ni === null || eps === null || Math.abs(eps) < 1e-9) return null;
  const out = ni / eps;
  return out > 0 && Number.isFinite(out) ? out : null;
}
export function revenueGrowth(a: FilingAnalysis) {
  const c = latest(a.financials.revenue), p = prior(a.financials.revenue);
  return c === null || p === null || Math.abs(p) < 1e-9 ? null : round(clamp((c / p - 1) * 100, -50, 50));
}
export function ebitMargin(a: FilingAnalysis) {
  const rev = latest(a.financials.revenue), ebit = latest(a.financials.ebit);
  if (rev !== null && ebit !== null && Math.abs(rev) > 1e-9) return round(ebit / rev * 100);
  const m = latest(a.financials.operatingMargin);
  return m === null ? null : round(Math.abs(m) <= 1.5 ? m * 100 : m);
}
export function taxRate(a: FilingAnalysis) {
  const tax = latest(a.financials.incomeTaxExpense), pretax = latest(a.financials.incomeBeforeTax);
  return tax === null || pretax === null || Math.abs(pretax) < 1e-9 ? null : round(clamp(Math.abs(tax / pretax) * 100, 0, 60));
}
export function capexPct(a: FilingAnalysis) {
  const rev = latest(a.financials.revenue), capex = latest(a.financials.capex);
  return rev === null || capex === null || Math.abs(rev) < 1e-9 ? null : round(clamp(Math.abs(capex / rev) * 100, 0, 60));
}
export function daPct(a: FilingAnalysis) {
  const rev = latest(a.financials.revenue), ebitda = latest(a.financials.ebitda) ?? latest(a.financials.adjustedEbitda), ebit = latest(a.financials.ebit);
  return rev === null || ebitda === null || ebit === null || Math.abs(rev) < 1e-9 ? null : round(clamp((ebitda - ebit) / rev * 100, 0, 40));
}
export function nwcPct(a: FilingAnalysis) {
  const rev = latest(a.financials.revenue), ar = latest(a.financials.accountsReceivable), inv = latest(a.financials.inventory), ap = latest(a.financials.accountsPayable);
  return rev === null || ar === null || inv === null || ap === null || Math.abs(rev) < 1e-9 ? null : round(clamp((ar + inv - ap) / rev * 100, -50, 100));
}
export function costDebt(a: FilingAnalysis) {
  const debt = latest(a.financials.totalDebt), interest = latest(a.financials.interestExpense);
  return debt === null || interest === null || Math.abs(debt) < 1e-9 ? null : round(clamp(Math.abs(interest / debt) * 100, 0, 40));
}
