import type { FinancialsResult } from "../contracts/analysis";
import { computeFinancialMetrics } from "./financial-metrics";
import { analyzeFinancialSkillInputs } from "./financial-skill-analysis";
import { runExactFinancialSkills } from "./exact-financial-skills";

const SERIES_KEYS = [
  "revenue",
  "grossProfit",
  "ebit",
  "ebitda",
  "adjustedEbitda",
  "incomeBeforeTax",
  "incomeTaxExpense",
  "reportedRoic",
  "netIncome",
  "eps",
  "grossMargin",
  "operatingMargin",
  "operatingCashFlow",
  "capex",
  "freeCashFlow",
  "dividends",
  "buybacks",
  "totalAssets",
  "totalLiabilities",
  "totalEquity",
  "totalDebt",
  "shortTermDebt",
  "longTermDebt",
  "cash",
  "currentAssets",
  "currentLiabilities",
  "interestExpense",
  "accountsReceivable",
  "inventory",
  "accountsPayable",
  "costOfGoodsSold",
  "goodwill",
] as const;

function latest(values: number[] | null | undefined): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const value = values.at(-1);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function applyFinancialValidation(
  result: FinancialsResult,
): Promise<FinancialsResult> {
  const financials = result.financials;
  const assets = latest(financials.totalAssets);
  const liabilities = latest(financials.totalLiabilities);
  const equity = latest(financials.totalEquity);
  let balanceSheetIdentity: "reconciled" | "mismatch" | "not_available" = "not_available";
  let difference: number | null = null;

  if (assets !== null && liabilities !== null && equity !== null) {
    difference = Number((assets - liabilities - equity).toFixed(4));
    const tolerance = Math.max(Math.abs(assets) * 0.01, 1);
    balanceSheetIdentity = Math.abs(difference) <= tolerance ? "reconciled" : "mismatch";
  }

  const jumpWarnings: string[] = [];
  const ocrAnomalies: string[] = [];
  for (const key of SERIES_KEYS) {
    const values = financials[key];
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => {
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
        ocrAnomalies.push(`${key}:${financials.years[index] ?? index}`);
      }
      if (index === 0) return;
      const previous = values[index - 1];
      if (!Number.isFinite(previous) || Math.abs(previous) < 0.0001) return;
      const change = Math.abs((value - previous) / previous);
      if (change >= 5) jumpWarnings.push(`${key}:${financials.years[index - 1] ?? index - 1}->${financials.years[index] ?? index}`);
    });
  }

  const filingLensComputed = computeFinancialMetrics(financials);
  const exactSkills = await runExactFinancialSkills(financials, filingLensComputed);
  const exactStatementUnavailable = exactSkills.runtimeFlags.some(flag => flag.code === "FINANCIAL_STATEMENT_SKILL_RUNTIME_UNAVAILABLE");
  const fallbackStatement = exactStatementUnavailable ? analyzeFinancialSkillInputs(financials) : { trends: [], validationFlags: [] };
  const trends = exactSkills.trends.length ? exactSkills.trends : fallbackStatement.trends;
  const validationFlags = [
    ...(exactSkills.validationFlags.length ? exactSkills.validationFlags : fallbackStatement.validationFlags),
    ...exactSkills.runtimeFlags,
  ].filter((flag, index, list) => list.findIndex(other => other.code === flag.code && other.period === flag.period) === index);

  const relationshipWarnings: string[] = [];
  const calculatedFcf = exactSkills.computed.find(item => item.key === "freeCashFlowCalculated");
  if (Array.isArray(financials.freeCashFlow) && calculatedFcf) {
    financials.freeCashFlow.forEach((reported, index) => {
      const calculated = calculatedFcf.values[index];
      if (!Number.isFinite(reported) || calculated === null) return;
      const tolerance = Math.max(Math.abs(reported) * 0.05, 1);
      if (Math.abs(reported - calculated) > tolerance) {
        relationshipWarnings.push(`freeCashFlow:${financials.years[index] ?? index}`);
      }
    });
  }

  return {
    financials: {
      ...financials,
      computed: exactSkills.computed,
      trends,
      validationFlags,
      validation: {
        balanceSheetIdentity,
        difference,
        ocrAnomalies: [...new Set(ocrAnomalies)],
        jumpWarnings: [...new Set(jumpWarnings)],
        relationshipWarnings: [...new Set(relationshipWarnings)],
      },
    },
  };
}
