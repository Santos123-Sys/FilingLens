import type { EvidenceReference, FinancialsResult } from './analysis';

type Financials = FinancialsResult['financials'];
type ComputedMetric = NonNullable<Financials['computed']>[number];
const align = (values: number[] | null | undefined, periods: string[]) => Array.isArray(values) && values.length === periods.length ? values.map(v => Number.isFinite(v) ? v : null) : periods.map(() => null);
const div = (a: number | null, b: number | null) => a === null || b === null || b === 0 ? null : a / b;
const round = (v: number | null, d = 2) => v === null || !Number.isFinite(v) ? null : Number(v.toFixed(d));
const sourcesFor = (financials: Financials, keys: string[]): EvidenceReference[] => (financials.evidence ?? []).filter(i => keys.includes(i.metric)).map(i => i.source).slice(0, 8);
export function computedMetric(financials: Financials, key: string, values: Array<number | null>, unit: ComputedMetric['unit'], formula: string | null, components: string[], type: ComputedMetric['type'] = 'calculated', note: string | null = null): ComputedMetric { return { key, values, unit, type, formula, components, numerator: components[0] ?? null, denominator: components[1] ?? null, periods: financials.years, sources: sourcesFor(financials, components), confidence: components.every(k => (financials.evidence ?? []).some(i => i.metric === k)) ? 'high' : 'medium', note }; }
export function computeFinancialMetrics(financials: Financials): ComputedMetric[] {
  const p = financials.years;
  const revenue = align(financials.revenue, p), grossProfit = align(financials.grossProfit, p), ebit = align(financials.ebit, p), ebitda = align(financials.ebitda, p), netIncome = align(financials.netIncome, p);
  const ocf = align(financials.operatingCashFlow, p), capex = align(financials.capex, p), reportedFcf = align(financials.freeCashFlow, p), debt = align(financials.totalDebt, p), cash = align(financials.cash, p);
  const currentAssets = align(financials.currentAssets, p), currentLiabilities = align(financials.currentLiabilities, p), assets = align(financials.totalAssets, p), equity = align(financials.totalEquity, p), interest = align(financials.interestExpense, p);
  const calculatedFcf = ocf.map((v, i) => v === null || capex[i] === null ? null : round(v - Math.abs(capex[i]!)));
  const fcf = reportedFcf.some(v => v !== null) ? reportedFcf : calculatedFcf;
  const netDebt = debt.map((v, i) => v === null || cash[i] === null ? null : round(v - cash[i]!));
  const pct = (a: Array<number | null>, b: Array<number | null>) => a.map((v, i) => round(div(v, b[i]) === null ? null : div(v, b[i])! * 100));
  const multiple = (a: Array<number | null>, b: Array<number | null>) => a.map((v, i) => b[i] !== null && b[i]! > 0 ? round(div(v, b[i])) : null);
  const metrics: ComputedMetric[] = [
    computedMetric(financials, 'grossMarginCalculated', pct(grossProfit, revenue), 'percent', 'Gross profit ÷ Revenue × 100', ['grossProfit','revenue']),
    computedMetric(financials, 'ebitMargin', pct(ebit, revenue), 'percent', 'EBIT ÷ Revenue × 100', ['ebit','revenue']),
    computedMetric(financials, 'ebitdaMargin', pct(ebitda, revenue), 'percent', 'EBITDA ÷ Revenue × 100', ['ebitda','revenue']),
    computedMetric(financials, 'netMargin', pct(netIncome, revenue), 'percent', 'Net income ÷ Revenue × 100', ['netIncome','revenue']),
    computedMetric(financials, 'netDebt', netDebt, 'currency', 'Total debt − Cash', ['totalDebt','cash']),
    computedMetric(financials, 'grossDebtToEbitda', multiple(debt, ebitda), 'multiple', 'Total debt ÷ EBITDA', ['totalDebt','ebitda'], 'calculated', 'N/M when EBITDA is zero or negative.'),
    computedMetric(financials, 'netDebtToEbitda', multiple(netDebt, ebitda), 'multiple', 'Net debt ÷ EBITDA', ['totalDebt','cash','ebitda'], 'calculated', 'N/M when EBITDA is zero or negative.'),
    computedMetric(financials, 'freeCashFlowCalculated', fcf, 'currency', reportedFcf.some(v => v !== null) ? null : 'Operating cash flow − |Capex|', ['operatingCashFlow','capex','freeCashFlow'], reportedFcf.some(v => v !== null) ? 'reported' : 'calculated'),
    computedMetric(financials, 'fcfMargin', pct(fcf, revenue), 'percent', 'Free cash flow ÷ Revenue × 100', ['freeCashFlow','operatingCashFlow','capex','revenue']),
    computedMetric(financials, 'currentRatio', currentAssets.map((v,i) => round(div(v,currentLiabilities[i]))), 'ratio', 'Current assets ÷ Current liabilities', ['currentAssets','currentLiabilities']),
    computedMetric(financials, 'interestCoverage', ebit.map((v,i) => interest[i] === null ? null : round(div(v, Math.abs(interest[i]!)))), 'multiple', 'EBIT ÷ |Interest expense|', ['ebit','interestExpense']),
    computedMetric(financials, 'roePeriodEnd', pct(netIncome, equity), 'percent', 'Net income ÷ period-end equity × 100', ['netIncome','totalEquity']),
    computedMetric(financials, 'roaPeriodEnd', pct(netIncome, assets), 'percent', 'Net income ÷ period-end assets × 100', ['netIncome','totalAssets']),
  ];
  return metrics.filter(metric => metric.values.some(v => v !== null));
}
