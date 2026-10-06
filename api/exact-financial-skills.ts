import type { EvidenceReference, FinancialsResult } from "../contracts/analysis";
import { runRatioSkill, runStatementSkill, SkillRuntimeError } from "./skill-runtime";

type Financials = FinancialsResult["financials"];
type ComputedMetric = NonNullable<Financials["computed"]>[number];
type Trend = NonNullable<Financials["trends"]>[number];
type ValidationFlag = NonNullable<Financials["validationFlags"]>[number];

type RatioItem = {
  name_en?: string;
  value: number | null;
  format?: string;
};
type RatioOutput = {
  indicators?: Record<string, { items?: RatioItem[] }>;
  dupont_analysis?: {
    components?: Record<string, { value?: number | null }>;
    roe_decomposed?: number | null;
    roe_direct?: number | null;
  };
};
type StatementOutput = {
  periods?: string[];
  changes?: Record<string, { yoy?: Array<number | null>; qoq?: Array<number | null> }>;
  anomalies?: Array<{
    rule?: string;
    period?: string;
    severity?: "high" | "medium" | "low" | string;
    detail?: string;
    implication?: string;
  }>;
};

type ParsedPeriod = { year: number; quarter: number | null };

function parsePeriod(value: string): ParsedPeriod | null {
  const text = value.trim();
  const yearFirst = /^(?:FY\s*)?(\d{4})\s*[- ]?\s*[Qq]([1-4])$/i.exec(text);
  if (yearFirst) return { year: Number(yearFirst[1]), quarter: Number(yearFirst[2]) };
  const quarterFirst = /^[Qq]([1-4])\s+(\d{4})$/i.exec(text);
  if (quarterFirst) return { year: Number(quarterFirst[2]), quarter: Number(quarterFirst[1]) };
  const annual = /^(?:FY\s*)?(\d{4})$/i.exec(text);
  return annual ? { year: Number(annual[1]), quarter: null } : null;
}

function normalizedPeriod(value: string): string {
  const parsed = parsePeriod(value);
  if (!parsed) return value;
  return parsed.quarter === null ? String(parsed.year) : `${parsed.year}Q${parsed.quarter}`;
}

function aligned(values: number[] | null | undefined, periods: string[]): Array<number | null> {
  if (!Array.isArray(values) || values.length !== periods.length) return periods.map(() => null);
  return values.map(value => Number.isFinite(value) ? value : null);
}

function compactRecord(entries: Array<[string, number | null]>): Record<string, number> {
  return Object.fromEntries(entries.filter((entry): entry is [string, number] => entry[1] !== null));
}

function sourcesFor(financials: Financials, keys: string[]): EvidenceReference[] {
  return (financials.evidence ?? [])
    .filter(item => keys.includes(item.metric))
    .map(item => item.source)
    .filter((source, index, list) => list.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(source)) === index)
    .slice(0, 8);
}

function sourceItem(output: RatioOutput, name: string): RatioItem | null {
  for (const category of Object.values(output.indicators ?? {})) {
    const found = category.items?.find(item => item.name_en === name);
    if (found) return found;
  }
  return null;
}

const RATIO_BINDINGS: Array<{
  source: string;
  key: string;
  unit: ComputedMetric["unit"];
  scale?: number;
  components: string[];
  formula: string;
  annualOnly?: boolean;
  positiveDenominator?: string;
}> = [
  { source: "Return on Equity", key: "roePeriodEnd", unit: "percent", scale: 100, components: ["netIncome", "totalEquity"], formula: "Net income ÷ period-end total equity × 100" },
  { source: "Return on Assets", key: "roaPeriodEnd", unit: "percent", scale: 100, components: ["netIncome", "totalAssets"], formula: "Net income ÷ period-end total assets × 100" },
  { source: "Gross Profit Margin", key: "grossMarginCalculated", unit: "percent", scale: 100, components: ["revenue", "costOfGoodsSold"], formula: "(Revenue − cost of goods sold) ÷ Revenue × 100" },
  { source: "Net Profit Margin", key: "netMargin", unit: "percent", scale: 100, components: ["netIncome", "revenue"], formula: "Net income ÷ Revenue × 100" },
  { source: "Operating Profit Margin", key: "ebitMargin", unit: "percent", scale: 100, components: ["ebit", "revenue"], formula: "Operating income ÷ Revenue × 100" },
  { source: "Equity Multiplier", key: "equityMultiplier", unit: "multiple", components: ["totalAssets", "totalEquity"], formula: "Period-end total assets ÷ period-end total equity" },
  { source: "Interest Coverage Ratio", key: "interestCoverage", unit: "multiple", components: ["ebit", "interestExpense"], formula: "EBIT ÷ Interest expense" },
  { source: "Current Ratio", key: "currentRatio", unit: "ratio", components: ["currentAssets", "currentLiabilities"], formula: "Current assets ÷ Current liabilities" },
  { source: "Quick Ratio", key: "quickRatio", unit: "ratio", components: ["currentAssets", "inventory", "currentLiabilities"], formula: "(Current assets − Inventory) ÷ Current liabilities" },
  { source: "Cash Ratio", key: "cashRatio", unit: "ratio", components: ["cash", "currentLiabilities"], formula: "Cash and cash equivalents ÷ Current liabilities" },
  { source: "Asset Turnover", key: "assetTurnoverPeriodEnd", unit: "multiple", components: ["revenue", "totalAssets"], formula: "Revenue for disclosed period ÷ period-end total assets" },
  { source: "Inventory Turnover", key: "inventoryTurnover", unit: "multiple", components: ["costOfGoodsSold", "inventory"], formula: "Cost of goods sold ÷ period-end inventory" },
  { source: "Days Inventory Outstanding", key: "daysInventoryOutstanding", unit: "days", components: ["costOfGoodsSold", "inventory"], formula: "365 ÷ Inventory turnover", annualOnly: true },
  { source: "Receivables Turnover", key: "receivablesTurnover", unit: "multiple", components: ["revenue", "accountsReceivable"], formula: "Revenue ÷ period-end accounts receivable" },
  { source: "Days Sales Outstanding", key: "daysSalesOutstanding", unit: "days", components: ["revenue", "accountsReceivable"], formula: "365 ÷ Receivables turnover", annualOnly: true },
  { source: "Working Capital Turnover", key: "workingCapitalTurnover", unit: "multiple", components: ["revenue", "currentAssets", "currentLiabilities"], formula: "Revenue ÷ positive net working capital" },
  { source: "Operating Cash Flow Ratio", key: "operatingCashFlowRatio", unit: "multiple", components: ["operatingCashFlow", "currentLiabilities"], formula: "Operating cash flow ÷ Current liabilities" },
  { source: "Cash Flow to Net Income", key: "earningsCashConversion", unit: "multiple", components: ["operatingCashFlow", "netIncome"], formula: "Operating cash flow ÷ Net income", positiveDenominator: "netIncome" },
  { source: "Revenue Growth Rate (YoY)", key: "revenueGrowth", unit: "percent", scale: 100, components: ["revenue"], formula: "(Revenue ÷ prior comparable Revenue) − 1" },
  { source: "Net Income Growth Rate (YoY)", key: "netIncomeGrowth", unit: "percent", scale: 100, components: ["netIncome"], formula: "(Net income ÷ prior comparable Net income) − 1" },
];

function metricTemplate(financials: Financials, binding: typeof RATIO_BINDINGS[number]): ComputedMetric {
  return {
    key: binding.key,
    values: financials.years.map(() => null),
    unit: binding.unit,
    type: "calculated",
    formula: binding.formula,
    components: binding.components,
    numerator: binding.components[0] ?? null,
    denominator: binding.components.at(-1) ?? null,
    periods: financials.years,
    sources: sourcesFor(financials, binding.components),
    confidence: binding.components.every(key => (financials.evidence ?? []).some(item => item.metric === key)) ? "high" : "medium",
    note: "Calculated by the exact supplied financial-ratio-toolkit Python utility. FilingLens conventions override incompatible toolkit definitions.",
  };
}

function priorComparableIndex(periods: string[], index: number): number {
  const current = parsePeriod(periods[index]);
  if (!current) return -1;
  for (let candidate = index - 1; candidate >= 0; candidate--) {
    const prior = parsePeriod(periods[candidate]);
    if (prior && prior.year === current.year - 1 && prior.quarter === current.quarter) return candidate;
  }
  return -1;
}

function valueAt(financials: Financials, key: keyof Financials, index: number): number | null {
  const value = financials[key];
  if (!Array.isArray(value)) return null;
  const item = value[index];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}

function ratioInput(financials: Financials, index: number): Record<string, unknown> | null {
  const totalAssets = valueAt(financials, "totalAssets", index);
  const totalEquity = valueAt(financials, "totalEquity", index);
  const revenue = valueAt(financials, "revenue", index);
  const netIncome = valueAt(financials, "netIncome", index);
  if (totalAssets === null || totalEquity === null || revenue === null || netIncome === null) return null;

  const priorIndex = priorComparableIndex(financials.years, index);
  const priorRevenue = priorIndex >= 0 ? valueAt(financials, "revenue", priorIndex) : null;
  const priorNetIncome = priorIndex >= 0 ? valueAt(financials, "netIncome", priorIndex) : null;
  const capex = valueAt(financials, "capex", index);

  return {
    company_name: "",
    report_period: financials.years[index],
    currency: financials.unit,
    balance_sheet: compactRecord([
      ["total_assets", totalAssets],
      ["total_liabilities", valueAt(financials, "totalLiabilities", index)],
      ["shareholders_equity", totalEquity],
      ["current_assets", valueAt(financials, "currentAssets", index)],
      ["current_liabilities", valueAt(financials, "currentLiabilities", index)],
      ["inventory", valueAt(financials, "inventory", index)],
      ["accounts_receivable", valueAt(financials, "accountsReceivable", index)],
      ["cash_and_equivalents", valueAt(financials, "cash", index)],
    ]),
    income_statement: compactRecord([
      ["revenue", revenue],
      ["cost_of_goods_sold", valueAt(financials, "costOfGoodsSold", index)],
      ["operating_income", valueAt(financials, "ebit", index)],
      ["net_income", netIncome],
      ["interest_expense", valueAt(financials, "interestExpense", index)],
      ["income_tax", valueAt(financials, "incomeTaxExpense", index)],
    ]),
    cash_flow_statement: compactRecord([
      ["operating_cash_flow", valueAt(financials, "operatingCashFlow", index)],
      ["capital_expenditure", capex === null ? null : Math.abs(capex)],
    ]),
    ...(priorRevenue !== null || priorNetIncome !== null ? {
      prior_year: compactRecord([
        ["revenue", priorRevenue],
        ["net_income", priorNetIncome],
      ]),
    } : {}),
  };
}

function statementInput(financials: Financials): Record<string, unknown> {
  const periods = financials.years;
  const series = (values: number[] | null | undefined) => {
    if (!Array.isArray(values) || values.length !== periods.length) return undefined;
    return values.map(value => Number.isFinite(value) ? value : null);
  };
  const compactSeries = (input: Record<string, number[] | null | undefined>) => Object.fromEntries(
    Object.entries(input).flatMap(([key, values]) => {
      const normalized = series(values);
      return normalized ? [[key, normalized]] : [];
    }),
  );
  return {
    company: "",
    currency: financials.unit,
    unit: financials.unit,
    periods: periods.map(normalizedPeriod),
    income_statement: compactSeries({
      revenue: financials.revenue,
      cost_of_revenue: financials.costOfGoodsSold,
      operating_income: financials.ebit,
      net_income: financials.netIncome,
    }),
    balance_sheet: compactSeries({
      accounts_receivable: financials.accountsReceivable,
      inventory: financials.inventory,
      total_current_assets: financials.currentAssets,
      goodwill: financials.goodwill,
      total_assets: financials.totalAssets,
      accounts_payable: financials.accountsPayable,
      total_current_liabilities: financials.currentLiabilities,
      total_liabilities: financials.totalLiabilities,
      total_equity: financials.totalEquity,
    }),
    cash_flow: compactSeries({
      operating_cash_flow: financials.operatingCashFlow,
      capex: Array.isArray(financials.capex) ? financials.capex.map(value => Math.abs(value)) : financials.capex,
    }),
  };
}

const CHANGE_KEYS: Record<string, string> = {
  revenue: "revenue",
  cost_of_revenue: "costOfGoodsSold",
  operating_income: "ebit",
  net_income: "netIncome",
  operating_cash_flow: "operatingCashFlow",
  accounts_receivable: "accountsReceivable",
  inventory: "inventory",
  accounts_payable: "accountsPayable",
  total_assets: "totalAssets",
  total_liabilities: "totalLiabilities",
  total_equity: "totalEquity",
};

const ANOMALY_CODES: Record<string, string> = {
  "应收账款暴增": "AR_SURGE",
  "现金流背离利润": "CASH_FLOW_DIVERGENCE",
  "存货积压": "INVENTORY_BUILDUP",
  "毛利率突变": "GROSS_MARGIN_SHIFT",
  "净利率突变": "NET_MARGIN_SHIFT",
  "经营现金流持续为负": "PERSISTENT_NEGATIVE_OCF",
  "商誉占比过高": "EXCESSIVE_GOODWILL",
  "资产负债率过高": "LIABILITIES_TO_ASSETS_SCREEN",
  "流动比率过低": "LOW_CURRENT_RATIO",
  "应付账款异常": "AP_ANOMALY",
};

const ANOMALY_NOTES: Record<string, string> = {
  AR_SURGE: "Receivables growth materially exceeded revenue growth under the supplied analyzer's default review threshold.",
  CASH_FLOW_DIVERGENCE: "Operating cash flow diverged from positive net income under the supplied analyzer's cash-conversion review rule.",
  INVENTORY_BUILDUP: "Inventory growth materially exceeded revenue growth under the supplied analyzer's default review threshold.",
  GROSS_MARGIN_SHIFT: "Gross margin changed beyond the supplied analyzer's default review threshold between comparable periods.",
  NET_MARGIN_SHIFT: "Net margin changed beyond the supplied analyzer's default review threshold between comparable periods.",
  PERSISTENT_NEGATIVE_OCF: "Operating cash flow remained negative for the number of consecutive periods screened by the supplied analyzer.",
  EXCESSIVE_GOODWILL: "Goodwill exceeded the supplied analyzer's default share-of-assets review threshold.",
  LIABILITIES_TO_ASSETS_SCREEN: "Total liabilities exceeded the supplied analyzer's default share-of-assets review threshold. This is a screening signal, not an interest-bearing debt ratio.",
  LOW_CURRENT_RATIO: "Current ratio fell below the supplied analyzer's default review threshold.",
  AP_ANOMALY: "Accounts-payable growth diverged materially from cost growth under the supplied analyzer's default review threshold.",
};

function statementTrends(financials: Financials, output: StatementOutput): Trend[] {
  const trends: Trend[] = [];
  for (const [sourceKey, changes] of Object.entries(output.changes ?? {})) {
    const metric = CHANGE_KEYS[sourceKey];
    if (!metric) continue;
    for (const [kind, values] of [["YoY", changes.yoy], ["QoQ", changes.qoq]] as const) {
      if (!Array.isArray(values)) continue;
      values.forEach((value, index) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        if (kind === "QoQ" && parsePeriod(financials.years[index])?.quarter === null) return;
        let comparisonIndex = -1;
        if (kind === "QoQ") comparisonIndex = index - 1;
        else comparisonIndex = priorComparableIndex(financials.years, index);
        if (comparisonIndex < 0) return;
        trends.push({
          metric,
          period: financials.years[index],
          comparisonPeriod: financials.years[comparisonIndex],
          comparison: kind,
          changePercent: Number((value * 100).toFixed(2)),
        });
      });
    }
  }
  return trends.filter((trend, index) => trends.findIndex(other =>
    other.metric === trend.metric && other.period === trend.period && other.comparison === trend.comparison,
  ) === index);
}

function statementFlags(financials: Financials, output: StatementOutput): ValidationFlag[] {
  const normalizedToOriginal = new Map(financials.years.map(period => [normalizedPeriod(period), period]));
  return (output.anomalies ?? []).flatMap(anomaly => {
    const code = anomaly.rule ? ANOMALY_CODES[anomaly.rule] : undefined;
    if (!code) return [];
    return [{
      code,
      severity: anomaly.severity === "high" ? "error" as const : "warning" as const,
      period: anomaly.period ? normalizedToOriginal.get(anomaly.period) ?? anomaly.period : null,
      note: ANOMALY_NOTES[code] ?? "Review signal produced by the exact supplied financial-statement-analyzer utility.",
    }];
  }).filter((flag, index, list) => list.findIndex(other => other.code === flag.code && other.period === flag.period) === index);
}

export async function runExactFinancialSkills(
  financials: Financials,
  baseMetrics: ComputedMetric[],
): Promise<{
  computed: ComputedMetric[];
  trends: Trend[];
  validationFlags: ValidationFlag[];
  runtimeFlags: ValidationFlag[];
}> {
  const metrics = baseMetrics.map(item => ({ ...item, values: [...item.values] }));
  const runtimeFlags: ValidationFlag[] = [];

  try {
    for (let index = 0; index < financials.years.length; index++) {
      const input = ratioInput(financials, index);
      if (!input) continue;
      const output = await runRatioSkill<RatioOutput>(input);
      for (const binding of RATIO_BINDINGS) {
        const parsed = parsePeriod(financials.years[index]);
        if (binding.annualOnly && parsed?.quarter !== null) continue;
        if (binding.positiveDenominator) {
          const denominator = valueAt(financials, binding.positiveDenominator as keyof Financials, index);
          if (denominator === null || denominator <= 0) continue;
        }
        const item = sourceItem(output, binding.source);
        if (!item || item.value === null || !Number.isFinite(item.value)) continue;
        const value = Number((item.value * (binding.scale ?? 1)).toFixed(4));
        let metric = metrics.find(candidate => candidate.key === binding.key);
        if (!metric) {
          metric = metricTemplate(financials, binding);
          metrics.push(metric);
        }
        metric.values[index] = value;
        metric.note = "Calculated by the exact supplied financial-ratio-toolkit Python utility. FilingLens debt, denominator, period and locale conventions remain authoritative.";
      }
    }
  } catch (error) {
    const detail = error instanceof SkillRuntimeError ? error.stderr : String(error);
    runtimeFlags.push({
      code: "FINANCIAL_RATIO_SKILL_RUNTIME_UNAVAILABLE",
      severity: "warning",
      period: null,
      note: `The exact financial-ratio-toolkit utility could not complete; FilingLens deterministic calculations were retained. ${detail.slice(0, 240)}`.trim(),
    });
  }

  try {
    if (financials.years.length < 2) {
      return {
        computed: metrics,
        trends: [],
        validationFlags: [],
        runtimeFlags,
      };
    }
    const statementOutput = await runStatementSkill<StatementOutput>(statementInput(financials));
    return {
      computed: metrics,
      trends: statementTrends(financials, statementOutput),
      validationFlags: statementFlags(financials, statementOutput),
      runtimeFlags,
    };
  } catch (error) {
    const detail = error instanceof SkillRuntimeError ? error.stderr : String(error);
    runtimeFlags.push({
      code: "FINANCIAL_STATEMENT_SKILL_RUNTIME_UNAVAILABLE",
      severity: "warning",
      period: null,
      note: `The exact financial-statement-analyzer utility could not complete; FilingLens deterministic validation was retained. ${detail.slice(0, 240)}`.trim(),
    });
    return {
      computed: metrics,
      trends: [],
      validationFlags: [],
      runtimeFlags,
    };
  }
}
