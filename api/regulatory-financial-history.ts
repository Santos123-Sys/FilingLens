import type { FinancialsResult } from "../contracts/analysis";
import type { RegulatoryDataMetric, RegulatoryDataSnapshot } from "../contracts/regulatory-data";

const HISTORY_KEYS = [
  "revenue",
  "grossProfit",
  "ebit",
  "netIncome",
  "operatingCashFlow",
  "capex",
  "totalAssets",
  "totalLiabilities",
  "totalEquity",
  "totalDebt",
  "cash",
] as const;

type HistoryKey = typeof HISTORY_KEYS[number];

function toMillions(value: number | null, unit?: string | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const normalized = (unit ?? "").toLowerCase();
  if (normalized.includes("billion") || normalized.includes("bilhão") || normalized.includes("bilhao")) return value * 1_000;
  if (normalized.includes("million") || normalized.includes("milhão") || normalized.includes("milhao")) return value;
  if (normalized.includes("thousand") || normalized.includes("milhar")) return value / 1_000;
  if (normalized === "usd" || normalized === "brl" || normalized === "us$" || normalized === "r$") return value / 1_000_000;
  return value / 1_000_000;
}

function yearOf(metric: RegulatoryDataMetric): number | null {
  if (metric.fiscalYear && Number.isInteger(metric.fiscalYear)) return metric.fiscalYear;
  const match = String(metric.period ?? "").match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

function newestByKeyAndYear(metrics: RegulatoryDataMetric[]) {
  const map = new Map<string, RegulatoryDataMetric>();
  for (const metric of metrics) {
    if (metric.statementType !== "annual") continue;
    const year = yearOf(metric);
    if (!year || !HISTORY_KEYS.includes(metric.key as HistoryKey)) continue;
    map.set(`${metric.key}:${year}`, metric);
  }
  return map;
}

export function buildRegulatoryAnnualHistory(
  snapshot: RegulatoryDataSnapshot | undefined,
): NonNullable<FinancialsResult["financials"]["annualHistory"]> | undefined {
  if (!snapshot || snapshot.status === "unavailable" || snapshot.status === "identifier_missing") return undefined;
  const annual = snapshot.metrics.filter(metric => metric.statementType === "annual");
  const years = [...new Set(annual.map(yearOf).filter((year): year is number => Boolean(year)))].sort((a, b) => a - b).slice(-5);
  if (!years.length) return undefined;

  const byKeyYear = newestByKeyAndYear(annual);
  const series = (key: HistoryKey) => years.map(year => {
    const metric = byKeyYear.get(`${key}:${year}`);
    return metric ? toMillions(metric.value, metric.unit) : null;
  });

  const seen = new Set<string>();
  const sources = annual
    .map(metric => metric.source)
    .filter((source): source is NonNullable<RegulatoryDataMetric["source"]> => Boolean(source?.url))
    .filter(source => {
      const key = `${source.provider}|${source.url}|${source.period ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-12)
    .map(source => ({
      section: "Authoritative regulatory structured data",
      kind: "citation" as const,
      url: source.url,
      publisher: source.provider === "sec_edgar" ? "SEC EDGAR" : "CVM Dados Abertos",
      accessed: source.retrievedAt.slice(0, 10),
      sourceForm: source.form ?? undefined,
      item: source.period ?? undefined,
    }));

  return {
    years: years.map(year => `FY${year}`),
    unit: snapshot.jurisdiction === "br" ? "BRL millions" : "USD millions",
    provider: snapshot.provider,
    status: years.length >= 5 ? "complete" : "partial",
    revenue: series("revenue"),
    grossProfit: series("grossProfit"),
    ebit: series("ebit"),
    netIncome: series("netIncome"),
    operatingCashFlow: series("operatingCashFlow"),
    capex: series("capex"),
    totalAssets: series("totalAssets"),
    totalLiabilities: series("totalLiabilities"),
    totalEquity: series("totalEquity"),
    totalDebt: series("totalDebt"),
    cash: series("cash"),
    sources,
  };
}

export function attachRegulatoryAnnualHistory(
  input: FinancialsResult,
  snapshot: RegulatoryDataSnapshot | undefined,
): FinancialsResult {
  const annualHistory = buildRegulatoryAnnualHistory(snapshot);
  if (!annualHistory) return input;
  return {
    financials: {
      ...input.financials,
      annualHistory,
      validationFlags: [
        ...(input.financials.validationFlags ?? []),
        {
          code: annualHistory.status === "complete" ? "EXTERNAL_FIVE_YEAR_HISTORY_COMPLETE" : "EXTERNAL_FIVE_YEAR_HISTORY_PARTIAL",
          severity: "warning",
          period: annualHistory.years.at(-1) ?? null,
          note: annualHistory.status === "complete"
            ? `Five-year annual history loaded from ${annualHistory.provider}; filing-derived periods remain unchanged.`
            : `Partial annual history loaded from ${annualHistory.provider}; filing-derived periods remain unchanged.`,
        },
      ],
    },
  };
}
