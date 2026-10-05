import type {
  FilingAnalysis,
  Jurisdiction,
  PrebuiltDashboardData,
} from "../contracts/analysis";

const METRIC_ROWS = [
  ["revenue", "Receita líquida", "Revenue"],
  ["netIncome", "Lucro líquido", "Net income"],
  ["operatingCashFlow", "Fluxo de caixa operacional", "Operating cash flow"],
  ["freeCashFlow", "Fluxo de caixa livre", "Free cash flow"],
  ["totalDebt", "Dívida total", "Total debt"],
  ["cash", "Caixa", "Cash"],
] as const;

function latestAligned(
  values: number[] | null | undefined,
  periods: string[],
): number | null {
  if (!Array.isArray(values) || values.length !== periods.length || values.length === 0) return null;
  const value = values.at(-1);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function latest(values: number[] | null | undefined): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const value = values.at(-1);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasAlignedSeries(
  values: number[] | null | undefined,
  periods: string[],
): values is number[] {
  return Array.isArray(values) && values.length === periods.length && values.length >= 2;
}

function formatted(value: number, unit: string, jurisdiction: Jurisdiction): string {
  const amount = value.toLocaleString(jurisdiction === "br" ? "pt-BR" : "en-US", { maximumFractionDigits: 1 });
  return unit ? `${unit} ${amount}` : amount;
}

/**
 * Populates the supplied fixed dashboard contract from agent data. It never
 * invents figures: unsupported blocks are emitted as explicit empty states.
 */
export function buildPrebuiltDashboardData(
  analysis: FilingAnalysis,
): PrebuiltDashboardData {
  const f = analysis.financials;
  const years = f.years;
  const isBr = analysis.jurisdiction === "br";
  const unit = f.unit || (isBr ? "R$ milhões" : "USD millions");
  const revenue = latestAligned(f.revenue, years);
  const income = latestAligned(f.netIncome, years);
  const heroValue = revenue ?? income;
  const heroLabel = revenue !== null
    ? (isBr ? "Receita líquida" : "Revenue")
    : (isBr ? "Lucro líquido" : "Net income");
  const financialReady = years.length >= 2 && (hasAlignedSeries(f.revenue, years) || hasAlignedSeries(f.netIncome, years));

  const combo = financialReady
    ? {
        state: "ready" as const,
        title: isBr ? "Desempenho financeiro" : "Financial performance",
        subtitle: hasAlignedSeries(f.operatingMargin, years)
          ? (isBr ? "receita líquida × margem operacional" : "revenue × operating margin")
          : (isBr ? "receita líquida × lucro líquido" : "revenue × net income"),
        axis: years,
        bar: hasAlignedSeries(f.revenue, years)
          ? { name: isBr ? "Receita líquida" : "Revenue", values: f.revenue }
          : { name: isBr ? "Lucro líquido" : "Net income", values: f.netIncome },
        line: hasAlignedSeries(f.operatingMargin, years)
          ? { name: isBr ? "Margem operacional" : "Operating margin", values: f.operatingMargin, suffix: "%" }
          : hasAlignedSeries(f.netIncome, years)
            ? { name: isBr ? "Lucro líquido" : "Net income", values: f.netIncome, suffix: unit }
            : null,
      }
    : {
        state: "empty" as const,
        title: isBr ? "Desempenho financeiro" : "Financial performance",
        subtitle: isBr ? "séries históricas" : "historical series",
        axis: [],
        bar: null,
        line: null,
        message: analysis.diagnostics?.financials?.status === "not_applicable"
          ? (isBr
              ? "Este formulário é narrativo. Envie uma DFP ou ITR para gerar gráficos financeiros."
              : "This narrative filing does not contain historical statements. Upload a 10-K or 10-Q for financial charts.")
          : (isBr
              ? "Não há série histórica financeira compatível no documento."
              : "No compatible historical financial series was found in the filing."),
      };

  const sourceBreakdown = analysis.market.segments.length
    ? analysis.market.segments.map(segment => ({ name: segment.name, value: latest(segment.revenue) }))
    : analysis.market.geographies.map(geography => ({ name: geography.name, value: latest(geography.values) }));
  const paretoItems = sourceBreakdown
    .filter((item): item is { name: string; value: number } => item.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const pivotRows = METRIC_ROWS.flatMap(([key, labelBr, labelUs]) => {
    const values = f[key];
    const latestValue = latestAligned(values, years);
    return latestValue === null
      ? []
      : [[isBr ? labelBr : labelUs, formatted(latestValue, unit, analysis.jurisdiction), years.at(-1) ?? "", isBr ? "Reportado" : "Reported"] as [string, string, string, string]];
  });
  return {
    template: "featured-map",
    jurisdiction: analysis.jurisdiction,
    locale: isBr ? "pt-BR" : "en-US",
    currency: isBr ? "BRL" : "USD",
    riskPresentation: isBr ? "narrative" : "structured",
    eventPriority: isBr ? "fatos-relevantes" : "8-k",
    period: analysis.company.periodEnd || years.at(-1) || "Período não identificado",
    hero: heroValue === null
      ? {
          state: "empty",
          label: isBr ? "Indicador principal" : "Headline metric",
          value: null,
          unit,
          delta: null,
          comparison: null,
          message: isBr
            ? "Não há indicador financeiro principal compatível no documento."
            : "No compatible headline financial metric was found in the filing.",
        }
      : {
          state: "ready",
          label: heroLabel,
          value: heroValue,
          unit,
          delta: null,
          comparison: null,
        },
    kpis: analysis.kpis.slice(0, 4),
    combo,
    pareto: paretoItems.length
      ? { state: "ready", title: isBr ? "Concentração de receita" : "Revenue concentration", items: paretoItems }
      : {
          state: "empty",
          title: isBr ? "Concentração de receita" : "Revenue concentration",
          items: [],
          message: isBr
            ? "Não há divisão por segmento ou geografia compatível no documento."
            : "No compatible segment or geography breakdown was found in the filing.",
        },
    pivot: pivotRows.length
      ? {
          state: "ready",
          title: isBr ? "Métricas financeiras reportadas" : "Reported financial metrics",
          columns: isBr ? ["Métrica", "Valor", "Período", "Base"] : ["Metric", "Value", "Period", "Basis"],
          rows: pivotRows.slice(0, 6),
          // A table mixing revenue, profit, cash and balance-sheet measures has
          // no meaningful grand total. Do not repeat revenue as a fake total.
          total: null,
        }
      : {
          state: "empty",
          title: isBr ? "Métricas financeiras reportadas" : "Reported financial metrics",
          columns: isBr ? ["Métrica", "Valor", "Período", "Base"] : ["Metric", "Value", "Period", "Basis"],
          rows: [],
          total: null,
          message: isBr
            ? "Não há dados financeiros reportados para preencher a tabela."
            : "No reported financial data is available for this table.",
        },
  };
}
