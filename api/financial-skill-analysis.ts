import type { FinancialsResult } from "../contracts/analysis";

type FinancialSeries = FinancialsResult["financials"];
type Trend = NonNullable<FinancialSeries["trends"]>[number];
type ValidationFlag = NonNullable<FinancialSeries["validationFlags"]>[number];
type ParsedPeriod = { year: number; quarter: number | null };

function parsePeriod(value: string): ParsedPeriod | null {
  const text = value.trim();
  const quarter = /^(\d{4})\s*[- ]?\s*[Qq]([1-4])$/.exec(text) ?? /^[Qq]([1-4])\s+(\d{4})$/.exec(text);
  if (quarter) { const yearFirst = /^\d{4}/.test(text); return { year: Number(yearFirst ? quarter[1] : quarter[2]), quarter: Number(yearFirst ? quarter[2] : quarter[1]) }; }
  const annual = /^(?:FY\s*)?(\d{4})$/i.exec(text);
  return annual ? { year: Number(annual[1]), quarter: null } : null;
}
function periodPairs(periods: string[]) {
  const parsed = periods.map(parsePeriod);
  const pairs: Array<{ current: number; prior: number; comparison: "YoY" | "QoQ" }> = [];
  for (let current = 0; current < periods.length; current++) {
    const now = parsed[current]; if (!now) continue;
    for (let prior = current - 1; prior >= 0; prior--) { const before = parsed[prior]; if (!before) continue; if (now.quarter === null && before.quarter === null && now.year === before.year + 1) { pairs.push({ current, prior, comparison: "YoY" }); break; } if (now.quarter !== null && before.quarter === now.quarter && now.year === before.year + 1) { pairs.push({ current, prior, comparison: "YoY" }); break; } }
    if (now.quarter !== null) { const prior = current - 1; const before = parsed[prior]; const isPreviousQuarter = before && before.quarter !== null && ((before.year === now.year && before.quarter === now.quarter - 1) || (before.year === now.year - 1 && before.quarter === 4 && now.quarter === 1)); if (isPreviousQuarter) pairs.push({ current, prior, comparison: "QoQ" }); }
  }
  return pairs;
}
function aligned(values: number[] | null | undefined, periods: string[]): Array<number | null> | null { if (!Array.isArray(values) || values.length !== periods.length) return null; return values.map(value => Number.isFinite(value) ? value : null); }
function pctChange(current: number | null, prior: number | null): number | null { if (current === null || prior === null || prior === 0) return null; const change = (current - prior) / Math.abs(prior) * 100; return Number.isFinite(change) ? Number(change.toFixed(2)) : null; }
function ratio(numerator: number | null, denominator: number | null): number | null { if (numerator === null || denominator === null || denominator === 0) return null; const result = numerator / denominator; return Number.isFinite(result) ? result : null; }

export function analyzeFinancialSkillInputs(financials: FinancialSeries): { trends: Trend[]; validationFlags: ValidationFlag[] } {
  const periods = financials.years;
  const pairs = periodPairs(periods);
  const sourceKeys = ["revenue", "grossProfit", "costOfGoodsSold", "ebit", "netIncome", "operatingCashFlow", "totalAssets", "totalLiabilities", "totalEquity", "currentAssets", "currentLiabilities", "accountsReceivable", "inventory", "accountsPayable", "goodwill", "totalDebt", "cash"] as const;
  const series = Object.fromEntries(sourceKeys.map(key => [key, aligned(financials[key], periods)])) as Record<typeof sourceKeys[number], Array<number | null> | null>;
  const reportedGrossMargin = aligned(financials.grossMargin, periods)?.map(value => value === null ? null : value / 100);
  const grossMargin = periods.map((_, i) => { const revenue = series.revenue?.[i] ?? null; const grossProfit = series.grossProfit?.[i] ?? (revenue !== null && series.costOfGoodsSold?.[i] !== null && series.costOfGoodsSold?.[i] !== undefined ? revenue - series.costOfGoodsSold[i]! : null); return ratio(grossProfit, revenue) ?? reportedGrossMargin?.[i] ?? null; });
  const netMargin = series.netIncome?.map((value, i) => ratio(value, series.revenue?.[i] ?? null));
  const trends: Trend[] = [];
  for (const key of ["revenue", "grossProfit", "ebit", "netIncome", "operatingCashFlow", "totalDebt"] as const) { const values = series[key]; if (!values) continue; for (const pair of pairs) { const changePercent = pctChange(values[pair.current], values[pair.prior]); if (changePercent !== null) trends.push({ metric: key, period: periods[pair.current], comparisonPeriod: periods[pair.prior], comparison: pair.comparison, changePercent }); } }
  const flags: ValidationFlag[] = [];
  const add = (code: string, index: number, note: string, severity: "warning" | "error" = "warning") => flags.push({ code, severity, period: periods[index] ?? null, note });
  for (const pair of pairs.filter(pair => pair.comparison === "YoY")) {
    const revenueGrowth = pctChange(series.revenue?.[pair.current] ?? null, series.revenue?.[pair.prior] ?? null);
    const receivableGrowth = pctChange(series.accountsReceivable?.[pair.current] ?? null, series.accountsReceivable?.[pair.prior] ?? null);
    if (revenueGrowth !== null && receivableGrowth !== null && receivableGrowth - revenueGrowth > 20) add("AR_SURGE", pair.current, `Receivables growth exceeded revenue growth by ${(receivableGrowth - revenueGrowth).toFixed(1)} percentage points vs ${periods[pair.prior]}.`);
    const inventoryGrowth = pctChange(series.inventory?.[pair.current] ?? null, series.inventory?.[pair.prior] ?? null);
    if (revenueGrowth !== null && inventoryGrowth !== null && inventoryGrowth - revenueGrowth > 15) add("INVENTORY_BUILDUP", pair.current, `Inventory growth exceeded revenue growth by ${(inventoryGrowth - revenueGrowth).toFixed(1)} percentage points vs ${periods[pair.prior]}.`);
    const cogsGrowth = pctChange(series.costOfGoodsSold?.[pair.current] ?? null, series.costOfGoodsSold?.[pair.prior] ?? null);
    const apGrowth = pctChange(series.accountsPayable?.[pair.current] ?? null, series.accountsPayable?.[pair.prior] ?? null);
    if (cogsGrowth !== null && apGrowth !== null && Math.abs(apGrowth - cogsGrowth) > 20) add("AP_ANOMALY", pair.current, `Accounts payable growth differs from cost-of-goods-sold growth by ${Math.abs(apGrowth - cogsGrowth).toFixed(1)} percentage points vs ${periods[pair.prior]}. This is a working-capital signal, not a conclusion.`);
  }
  const sequentialPairs = pairs.filter(pair => pair.comparison === "QoQ" || parsePeriod(periods[pair.current])?.quarter === null);
  for (const pair of sequentialPairs) for (const [code, margins, threshold] of [["GROSS_MARGIN_SHIFT", grossMargin, 5], ["NET_MARGIN_SHIFT", netMargin, 3]] as const) { const before = margins?.[pair.prior], now = margins?.[pair.current]; if (before !== null && before !== undefined && now !== null && now !== undefined && Math.abs(now - before) * 100 > threshold) add(code, pair.current, `${code === "GROSS_MARGIN_SHIFT" ? "Gross" : "Net"} margin moved from ${(before * 100).toFixed(1)}% to ${(now * 100).toFixed(1)}% vs ${periods[pair.prior]}.`); }
  for (let i = 0; i < periods.length; i++) {
    const ocf = series.operatingCashFlow?.[i] ?? null, income = series.netIncome?.[i] ?? null;
    if (ocf !== null && income !== null && income > 0) { const conversion = ocf / income; if (ocf < 0 || conversion < 0.5) add("CASH_FLOW_DIVERGENCE", i, ocf < 0 ? "Operating cash flow is negative while net income is positive. This is a review signal, not a finding of misstatement." : `Operating cash flow is ${(conversion * 100).toFixed(1)}% of positive net income, below the 50% screen.`); }
    const assets = series.totalAssets?.[i] ?? null, goodwill = series.goodwill?.[i] ?? null, liabilities = series.totalLiabilities?.[i] ?? null, currentAssets = series.currentAssets?.[i] ?? null, currentLiabilities = series.currentLiabilities?.[i] ?? null;
    if (assets !== null && assets > 0 && goodwill !== null && goodwill / assets > 0.3) add("EXCESSIVE_GOODWILL", i, `Goodwill is ${(goodwill / assets * 100).toFixed(1)}% of total assets, above the 30% review threshold.`);
    if (assets !== null && assets > 0 && liabilities !== null && liabilities / assets > 0.7) add("LIABILITIES_TO_ASSETS_SCREEN", i, `Total liabilities are ${(liabilities / assets * 100).toFixed(1)}% of assets. This is a liabilities-to-assets screening signal, not a debt ratio.`);
    const currentRatio = ratio(currentAssets, currentLiabilities); if (currentRatio !== null && currentRatio < 1) add("LOW_CURRENT_RATIO", i, `Current ratio is ${currentRatio.toFixed(2)}, below the 1.00 review threshold.`);
  }
  for (let i = 1; i < periods.length; i++) { const before = parsePeriod(periods[i - 1]), now = parsePeriod(periods[i]); if (!before || !now) continue; const adjacent = before.quarter === null && now.quarter === null && now.year === before.year + 1 || before.quarter !== null && now.quarter !== null && (now.year === before.year && now.quarter === before.quarter + 1 || now.year === before.year + 1 && before.quarter === 4 && now.quarter === 1); if (adjacent && (series.operatingCashFlow?.[i - 1] ?? 0) < 0 && (series.operatingCashFlow?.[i] ?? 0) < 0) add("PERSISTENT_NEGATIVE_OCF", i, `Operating cash flow was negative for two consecutive comparable periods (${periods[i - 1]} and ${periods[i]}).`); }
  return { trends, validationFlags: flags.filter((flag, index) => flags.findIndex(other => other.code === flag.code && other.period === flag.period) === index) };
}
