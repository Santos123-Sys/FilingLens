/**
 * Value Driver Intelligence (VDI) — deterministic, source-gated FCFF model.
 * Units throughout are USD/BRL billions for money, percentage points for rates.
 * Historical anchors are NEVER silently converted to forecasts.
 * This is an analyst scenario tool, not an estimate of a market consensus.
 */
export interface ValuationInputs {
  revenueBn: number;
  growthPct: number;
  operatingMarginPct: number;
  cashTaxPct: number;
  reinvestmentPct: number;
  waccPct: number;
  terminalGrowthPct: number;
  terminalRoicPct: number;
  netDebtBn: number;
  sharesBn: number;
  horizonYears: number;
}
export type DriverKey = "growthPct" | "operatingMarginPct" | "cashTaxPct" | "reinvestmentPct" | "waccPct" | "terminalGrowthPct" | "terminalRoicPct";
export type Uncertainty = "low" | "medium" | "high" | "unrated";
export interface DriverSpec {
  key: DriverKey;
  name: string;
  shock: number;
  unit: "pp";
  uncertainty: Uncertainty;
  rationale: string;
}
export interface DcfYear {
  year: number;
  revenueBn: number;
  growthPct: number;
  nopatBn: number;
  reinvestmentBn: number;
  fcffBn: number;
  presentValueBn: number;
}
export interface DcfResult {
  enterpriseValueBn: number;
  equityValueBn: number;
  impliedSharePrice: number;
  pvForecastBn: number;
  pvTerminalBn: number;
  terminalSharePct: number;
  years: DcfYear[];
}
export interface Sensitivity {
  key: DriverKey;
  name: string;
  shock: number;
  uncertainty: Uncertainty;
  rationale: string;
  minusEvBn: number | null;
  plusEvBn: number | null;
  minusImpactPct: number | null;
  plusImpactPct: number | null;
  maxAbsImpactPct: number;
}
export interface ReverseDcf {
  impliedGrowthPct: number | null;
  status: "solved" | "unreachable" | "missing-market";
  explanation: string;
}

const MAX_ABS = 1e8;
function finite(value: number, label: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS) throw new Error(`Invalid ${label}`);
}
export function validateValuationInputs(p: ValuationInputs): void {
  (Object.keys(p) as (keyof ValuationInputs)[]).forEach(key => finite(p[key], key));
  if (p.revenueBn <= 0 || p.sharesBn <= 0) throw new Error("Revenue and shares must be positive.");
  if (!Number.isInteger(p.horizonYears) || p.horizonYears < 5 || p.horizonYears > 20) throw new Error("Forecast years must be 5–20.");
  if (p.growthPct < -30 || p.growthPct > 45) throw new Error("Revenue growth must be between -30% and 45%.");
  if (p.operatingMarginPct < -20 || p.operatingMarginPct > 80) throw new Error("Operating margin out of range.");
  if (p.cashTaxPct < 0 || p.cashTaxPct > 60) throw new Error("Cash tax rate out of range.");
  if (p.reinvestmentPct < 0 || p.reinvestmentPct > 100) throw new Error("Reinvestment / NOPAT out of range.");
  if (p.waccPct <= 0 || p.waccPct > 35) throw new Error("WACC out of range.");
  if (p.terminalGrowthPct < -5 || p.terminalGrowthPct > 7) throw new Error("Terminal growth out of range.");
  if (p.waccPct <= p.terminalGrowthPct) throw new Error("WACC must exceed terminal growth.");
  if (p.terminalRoicPct <= Math.max(0, p.terminalGrowthPct) || p.terminalRoicPct > 80) {
    throw new Error("Terminal ROIC must exceed positive perpetual growth.");
  }
}
export function runDcf(p: ValuationInputs): DcfResult {
  validateValuationInputs(p);
  let revenue = p.revenueBn;
  let pvForecast = 0;
  const years: DcfYear[] = [];
  for (let year = 1; year <= p.horizonYears; year++) {
    // First half at analyst growth; fade linearly to sustainable growth by year N.
    const half = Math.ceil(p.horizonYears / 2);
    const fade = year <= half ? 0 : (year - half) / (p.horizonYears - half);
    const g = p.growthPct * (1 - fade) + p.terminalGrowthPct * fade;
    revenue *= 1 + g / 100;
    const nopat = revenue * (p.operatingMarginPct / 100) * (1 - p.cashTaxPct / 100);
    const reinvestment = nopat * p.reinvestmentPct / 100;
    const fcff = nopat - reinvestment;
    const pv = fcff / Math.pow(1 + p.waccPct / 100, year);
    pvForecast += pv;
    years.push({ year, revenueBn: revenue, growthPct: g, nopatBn: nopat, reinvestmentBn: reinvestment, fcffBn: fcff, presentValueBn: pv });
  }
  const nextRevenue = revenue * (1 + p.terminalGrowthPct / 100);
  const nextNopat = nextRevenue * (p.operatingMarginPct / 100) * (1 - p.cashTaxPct / 100);
  // Perpetuity reinvestment enforces g = reinvestment rate × return on new capital.
  const terminalFcff = nextNopat * (1 - p.terminalGrowthPct / p.terminalRoicPct);
  const terminalValue = terminalFcff / ((p.waccPct - p.terminalGrowthPct) / 100);
  const pvTerminal = terminalValue / Math.pow(1 + p.waccPct / 100, p.horizonYears);
  const enterpriseValue = pvForecast + pvTerminal;
  const equityValue = enterpriseValue - p.netDebtBn;
  return {
    enterpriseValueBn: enterpriseValue,
    equityValueBn: equityValue,
    impliedSharePrice: equityValue / p.sharesBn,
    pvForecastBn: pvForecast,
    pvTerminalBn: pvTerminal,
    terminalSharePct: pvTerminal / enterpriseValue * 100,
    years,
  };
}
export const DEFAULT_DRIVER_SPECS: DriverSpec[] = [
  { key: "growthPct", name: "Revenue growth", shock: 2, unit: "pp", uncertainty: "unrated", rationale: "Product volumes, pricing, Services mix and retention" },
  { key: "operatingMarginPct", name: "Operating margin", shock: 2, unit: "pp", uncertainty: "unrated", rationale: "Gross mix, recurring versus temporary benefits, operating leverage" },
  { key: "cashTaxPct", name: "Cash tax rate", shock: 2, unit: "pp", uncertainty: "unrated", rationale: "Cash taxes and effective jurisdictional exposure" },
  { key: "reinvestmentPct", name: "Forecast reinvestment", shock: 5, unit: "pp", uncertainty: "unrated", rationale: "Capital intensity and changes in working capital" },
  { key: "waccPct", name: "Cost of capital", shock: 1, unit: "pp", uncertainty: "unrated", rationale: "Risk-free yield, equity risk premium and leverage" },
  { key: "terminalGrowthPct", name: "Terminal growth", shock: 0.5, unit: "pp", uncertainty: "unrated", rationale: "Long-run growth and inflation; WACC must remain greater" },
  { key: "terminalRoicPct", name: "Terminal ROIC", shock: 5, unit: "pp", uncertainty: "unrated", rationale: "Competitive advantage and value created on incremental investment" },
];
export function analyzeDrivers(p: ValuationInputs, specs: DriverSpec[] = DEFAULT_DRIVER_SPECS): Sensitivity[] {
  const base = runDcf(p).enterpriseValueBn;
  return specs.map(spec => {
    const changed = (direction: -1 | 1): number | null => {
      try {
        return runDcf({ ...p, [spec.key]: p[spec.key] + spec.shock * direction }).enterpriseValueBn;
      } catch {
        return null; // Invalid perturbations are explicitly unavailable, never silently clamped.
      }
    };
    const minusEv = changed(-1);
    const plusEv = changed(1);
    const minus = minusEv === null ? null : (minusEv / base - 1) * 100;
    const plus = plusEv === null ? null : (plusEv / base - 1) * 100;
    return {
      key: spec.key, name: spec.name, shock: spec.shock, uncertainty: spec.uncertainty, rationale: spec.rationale,
      minusEvBn: minusEv, plusEvBn: plusEv, minusImpactPct: minus, plusImpactPct: plus,
      maxAbsImpactPct: Math.max(Math.abs(minus ?? 0), Math.abs(plus ?? 0)),
    };
  }).sort((a, b) => b.maxAbsImpactPct - a.maxAbsImpactPct);
}
export function reverseDcfGrowth(p: ValuationInputs, observedEnterpriseValueBn: number | null): ReverseDcf {
  if (observedEnterpriseValueBn === null || !Number.isFinite(observedEnterpriseValueBn) || observedEnterpriseValueBn <= 0) {
    return { impliedGrowthPct: null, status: "missing-market", explanation: "A dated, sourced market equity value and net debt are required." };
  }
  let low = -20, high = 45;
  const f = (g: number) => runDcf({ ...p, growthPct: g }).enterpriseValueBn - observedEnterpriseValueBn;
  const lower = f(low), upper = f(high);
  if (lower * upper > 0) {
    return { impliedGrowthPct: null, status: "unreachable", explanation: "No solution within -20% to 45% initial growth. Adjust the other assumptions; do not extrapolate." };
  }
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (f(mid) > 0) high = mid;
    else low = mid;
  }
  return {
    impliedGrowthPct: (low + high) / 2, status: "solved",
    explanation: "Model-implied initial annual growth over the first half of the forecast, fading to terminal growth; NOT an observed analyst-consensus estimate.",
  };
}
export function scenario(p: ValuationInputs, updates: Partial<ValuationInputs>): DcfResult {
  return runDcf({ ...p, ...updates });
}
