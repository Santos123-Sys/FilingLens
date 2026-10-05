import type { FinancialsResult } from "../contracts/analysis";
import { computeFinancialMetrics } from "./financial-metrics";
import { analyzeFinancialSkillInputs } from "./financial-skill-analysis";

const SERIES_KEYS = ["revenue","grossProfit","ebit","ebitda","adjustedEbitda","incomeBeforeTax","incomeTaxExpense","reportedRoic","netIncome","eps","grossMargin","operatingMargin","operatingCashFlow","capex","freeCashFlow","dividends","buybacks","totalAssets","totalLiabilities","totalEquity","totalDebt","shortTermDebt","longTermDebt","cash","currentAssets","currentLiabilities","interestExpense","accountsReceivable","inventory","accountsPayable","costOfGoodsSold","goodwill"] as const;
function latest(values: number[] | null | undefined): number | null { if (!Array.isArray(values) || values.length === 0) return null; const value = values.at(-1); return typeof value === "number" && Number.isFinite(value) ? value : null; }
export function applyFinancialValidation(result: FinancialsResult): FinancialsResult {
  const financials = result.financials;
  const assets = latest(financials.totalAssets), liabilities = latest(financials.totalLiabilities), equity = latest(financials.totalEquity);
  let balanceSheetIdentity: "reconciled" | "mismatch" | "not_available" = "not_available";
  let difference: number | null = null;
  if (assets !== null && liabilities !== null && equity !== null) { difference = Number((assets - liabilities - equity).toFixed(4)); const tolerance = Math.max(Math.abs(assets) * 0.01, 1); balanceSheetIdentity = Math.abs(difference) <= tolerance ? "reconciled" : "mismatch"; }
  const jumpWarnings: string[] = [], ocrAnomalies: string[] = [];
  for (const key of SERIES_KEYS) { const values = financials[key]; if (!Array.isArray(values)) continue; values.forEach((value, index) => { if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) ocrAnomalies.push(`${key}:${financials.years[index] ?? index}`); if (index === 0) return; const previous = values[index - 1]; if (!Number.isFinite(previous) || Math.abs(previous) < 0.0001) return; if (Math.abs((value - previous) / previous) >= 5) jumpWarnings.push(`${key}:${financials.years[index - 1] ?? index - 1}->${financials.years[index] ?? index}`); }); }
  const computed = computeFinancialMetrics(financials);
  const statementAnalysis = analyzeFinancialSkillInputs(financials);
  const relationshipWarnings: string[] = [];
  const calculatedFcf = computed.find(item => item.key === "freeCashFlowCalculated");
  if (Array.isArray(financials.freeCashFlow) && calculatedFcf) financials.freeCashFlow.forEach((reported, index) => { const calculated = calculatedFcf.values[index]; if (!Number.isFinite(reported) || calculated === null) return; if (Math.abs(reported - calculated) > Math.max(Math.abs(reported) * 0.05, 1)) relationshipWarnings.push(`freeCashFlow:${financials.years[index] ?? index}`); });
  return { financials: { ...financials, computed, trends: statementAnalysis.trends, validationFlags: statementAnalysis.validationFlags, validation: { balanceSheetIdentity, difference, ocrAnomalies: [...new Set(ocrAnomalies)], jumpWarnings: [...new Set(jumpWarnings)], relationshipWarnings: [...new Set(relationshipWarnings)] } } };
}
