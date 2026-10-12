import type { FilingAnalysis } from "./analysis";

export type DriverSignal = {
  metric: "revenue_growth" | "operating_margin" | "free_cash_flow" | "capex_intensity";
  title: string;
  previousPeriod: string;
  currentPeriod: string;
  previousValue: number;
  currentValue: number;
  delta: number;
  unit: "percent" | "percentage_points";
  threshold: number;
  material: boolean;
  evidenceUrl: string | null;
  evidence: "filing_observation";
  interpretation: string;
};
/**
 * Computes on-new-filing change signals from explicitly annual series only.
 * These are observations, not attribution of root causes, and do not poll a source.
 * Series are reported in millions, oldest first, and must share the same basis.
 */
export function annualValueDriverSignals(data: FilingAnalysis): DriverSignal[] {
  const f = data.financials;
  const h = f.annualHistory;
  const annualForm = /10-k|20-f|\bdfp\b|annual/i.test(data.company.filingType);
  if (!h && !annualForm) return [];
  const s = h ?? f;
  if (!/million|milh[oõ]es|usd mm|brl mm/i.test(s.unit)) return [];
  const i = s.years.length - 1;
  if (i < 1) return [];
  const url = h?.sources.find(source => source.url)?.url ??
    f.evidence?.find(e => e.source.url)?.source.url ?? null;
  const out: DriverSignal[] = [];
  const add = (
    metric: DriverSignal["metric"], title: string, before: number | null | undefined,
    after: number | null | undefined, unit: DriverSignal["unit"], threshold: number, interpretation: string,
  ) => {
    if (typeof before !== "number" || typeof after !== "number" || !Number.isFinite(before) ||
      !Number.isFinite(after) || (unit === "percent" && before === 0)) return;
    const delta = unit === "percent" ? (after / Math.abs(before) - 1) * 100 : after - before;
    out.push({
      metric, title, previousPeriod: s.years[i-1], currentPeriod: s.years[i],
      previousValue: before, currentValue: after, delta, unit, threshold,
      material: Math.abs(delta) >= threshold, evidenceUrl: url,
      evidence: "filing_observation", interpretation,
    });
  };
  const rev0 = s.revenue[i-1], rev1 = s.revenue[i];
  add("revenue_growth", "Annual revenue", rev0, rev1, "percent", 10,
    "Determine pricing, customer volume, product mix and inorganic contributions before attributing causality.");
  const margin0 = typeof s.ebit?.[i-1] === "number" && typeof rev0 === "number" && rev0 !== 0 ? s.ebit[i-1]! / rev0 * 100 : null;
  const margin1 = typeof s.ebit?.[i] === "number" && typeof rev1 === "number" && rev1 !== 0 ? s.ebit[i]! / rev1 * 100 : null;
  add("operating_margin", "Operating margin", margin0, margin1, "percentage_points", 1.5,
    "Review price/cost/mix changes, tariff items, and recurring versus temporary items.");
  const fc0 = typeof s.operatingCashFlow?.[i-1] === "number" && typeof s.capex?.[i-1] === "number" ?
    s.operatingCashFlow[i-1]! - Math.abs(s.capex[i-1]!) : null;
  const fc1 = typeof s.operatingCashFlow?.[i] === "number" && typeof s.capex?.[i] === "number" ?
    s.operatingCashFlow[i]! - Math.abs(s.capex[i]!) : null;
  add("free_cash_flow", "OCF less cash capex", fc0, fc1, "percent", 20,
    "Reconcile cash conversion, taxes, working capital and capital investment; this diagnostic is not FCFF.");
  const intensity0 = typeof s.capex?.[i-1] === "number" && typeof rev0 === "number" && rev0 > 0 ?
    Math.abs(s.capex[i-1]!) / rev0 * 100 : null;
  const intensity1 = typeof s.capex?.[i] === "number" && typeof rev1 === "number" && rev1 > 0 ?
    Math.abs(s.capex[i]!) / rev1 * 100 : null;
  add("capex_intensity", "Cash capex / sales", intensity0, intensity1, "percentage_points", 1,
    "Investigate planned versus maintenance capital spending and asset intensity.");
  return out.sort((a,b) => Number(b.material) - Number(a.material) || Math.abs(b.delta/b.threshold)-Math.abs(a.delta/a.threshold));
}
