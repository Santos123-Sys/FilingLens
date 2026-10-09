import type { FilingAnalysis, ValuationAssumption, ValuationAssumptionValue, ValuationMethod } from "../../contracts/analysis";
import { annualBasis } from "./basis";
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
  if (new Set(parsed.map(row => row.id)).size !== parsed.length) throw new ValuationInputError("duplicate_assumption_ids");
  const wrong = parsed.filter(row => row.method !== method);
  if (wrong.length) throw new ValuationInputError("assumption_method_mismatch");
  const pending = parsed.filter(row => row.status === "proposed").map(row => row.id);
  if (pending.length) throw new ValuationGateError("assumptions_require_validation", pending);
  return new Map(parsed.map(row => [row.id, row]));
}

export function resolved(row: ValuationAssumption): ValuationAssumptionValue {
  return row.final_value !== undefined ? row.final_value : row.proposed_value;
}
export function num(rows: Map<string, ValuationAssumption>, id: string): number {
  const row = rows.get(id);
  if (!row || row.status === "rejected") throw new ValuationInputError(`missing_${id}`);
  const value = resolved(row);
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
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

export function range(value: number, name: string, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) throw new ValuationInputError(`out_of_range_${name}`);
  return value;
}
const annual = (a: FilingAnalysis, key: string) => annualBasis(a)?.value(key) ?? null;
export function netDebt(a: FilingAnalysis) {
  const debt = annual(a, "totalDebt"), cash = annual(a, "cash");
  return debt === null || cash === null ? null : debt - cash;
}
export function shares(a: FilingAnalysis) {
  const ni = annual(a, "netIncome"), eps = annual(a, "eps");
  if (ni === null || eps === null || Math.abs(eps) < 1e-9) return null;
  const out = ni / eps;
  return out > 0 && Number.isFinite(out) ? out : null;
}
export function revenueGrowth(a: FilingAnalysis) { return annualBasis(a)?.growth ?? null; }
export function ebitMargin(a: FilingAnalysis) {
  const revenue = annual(a, "revenue"), ebit = annual(a, "ebit");
  return revenue !== null && revenue > 0 && ebit !== null ? round(ebit / revenue * 100) : null;
}
export function taxRate(a: FilingAnalysis) {
  const tax = annual(a, "incomeTaxExpense"), pretax = annual(a, "incomeBeforeTax");
  return tax !== null && pretax !== null && pretax > 0 && tax >= 0 ? round(tax / pretax * 100) : null;
}
export function capexPct(a: FilingAnalysis) {
  const rev = annual(a, "revenue"), capex = annual(a, "capex");
  return rev !== null && rev > 0 && capex !== null ? round(Math.abs(capex) / rev * 100) : null;
}
export function daPct(a: FilingAnalysis) {
  const rev = annual(a, "revenue"), ebitda = annual(a, "ebitda"), ebit = annual(a, "ebit");
  // Adjusted EBITDA is not a safe D&A proxy. Keep that missing rather than blend GAAP and adjustments.
  return rev !== null && rev > 0 && ebitda !== null && ebit !== null && ebitda >= ebit ? round((ebitda - ebit) / rev * 100) : null;
}
export function nwcPct(a: FilingAnalysis) {
  const rev = annual(a, "revenue"), ar = annual(a, "accountsReceivable"), inv = annual(a, "inventory"), ap = annual(a, "accountsPayable");
  return rev !== null && rev > 0 && ar !== null && inv !== null && ap !== null ? round((ar + inv - ap) / rev * 100) : null;
}
export function costDebt(a: FilingAnalysis) {
  const debt = annual(a, "totalDebt"), interest = annual(a, "interestExpense");
  return debt !== null && debt > 0 && interest !== null && interest >= 0 ? round(interest / debt * 100) : debt === 0 ? 0 : null;
}
