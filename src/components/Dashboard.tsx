import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption, EChartsType } from "echarts";
import type {
  AgentName,
  AnalysisStageName,
  EvidenceReference,
  FilingAnalysis,
} from "@contracts/analysis";
import { formatFilingNumber, formatKpiValue } from "@/lib/number-format";
import { alignSegmentSeries } from "@/lib/segment-series";

import { computeFinancialMetrics } from "@contracts/financial-metrics";
import { FINANCIAL_INDICATORS } from "@contracts/financial-indicators";

const SEG_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#fb923c",
  "#94a3b8",
];
const GRID = { left: 64, right: 24, top: 42, bottom: 34, containLabel: true };
const AXIS = {
  axisLabel: { color: "#94a3b8" },
  axisLine: { lineStyle: { color: "#334155" } },
  splitLine: { lineStyle: { color: "#1e293b" } },
};

type FinancialMetric =
  | "revenue"
  | "grossProfit"
  | "ebit"
  | "ebitda"
  | "adjustedEbitda"
  | "netIncome"
  | "eps"
  | "grossMargin"
  | "operatingMargin"
  | "operatingCashFlow"
  | "freeCashFlow"
  | "totalDebt"
  | "cash";
type ChartKind = "line" | "bar" | "area";
type EventSortKey = "date" | "title" | "category";

const METRIC_KEYS: FinancialMetric[] = [
  "revenue",
  "grossProfit",
  "ebit",
  "ebitda",
  "adjustedEbitda",
  "netIncome",
  "eps",
  "grossMargin",
  "operatingMargin",
  "operatingCashFlow",
  "freeCashFlow",
  "totalDebt",
  "cash",
];
const METRIC_NAMES: Record<"en" | "pt", Record<FinancialMetric, string>> = {
  en: {
    revenue: "Revenue",
    grossProfit: "Gross profit",
    ebit: "EBIT / operating income",
    ebitda: "EBITDA",
    adjustedEbitda: "Adjusted EBITDA",
    netIncome: "Net income",
    eps: "EPS",
    grossMargin: "Gross margin",
    operatingMargin: "Operating margin",
    operatingCashFlow: "Operating cash flow",
    freeCashFlow: "Free cash flow",
    totalDebt: "Total debt",
    cash: "Cash",
  },
  pt: {
    revenue: "Receita",
    grossProfit: "Lucro bruto",
    ebit: "EBIT / resultado operacional",
    ebitda: "EBITDA",
    adjustedEbitda: "EBITDA Ajustado",
    netIncome: "Lucro líquido",
    eps: "LPA",
    grossMargin: "Margem bruta",
    operatingMargin: "Margem operacional",
    operatingCashFlow: "Fluxo de caixa operacional",
    freeCashFlow: "Fluxo de caixa livre",
    totalDebt: "Dívida total",
    cash: "Caixa",
  },
};
const METRIC_COLORS: Record<FinancialMetric, string> = {
  revenue: "#60a5fa",
  grossProfit: "#fbbf24",
  ebit: "#22d3ee",
  ebitda: "#a78bfa",
  adjustedEbitda: "#f472b6",
  netIncome: "#34d399",
  eps: "#a78bfa",
  grossMargin: "#fbbf24",
  operatingMargin: "#22d3ee",
  operatingCashFlow: "#34d399",
  freeCashFlow: "#22d3ee",
  totalDebt: "#f87171",
  cash: "#60a5fa",
};

const COPY = {
  en: {
    overview: "Overview",
    market: "Market",
    risks: "Risks",
    financials: "Financials",
    events: "Events",
    filters: "Dashboard controls",
    period: "Fiscal period",
    from: "From",
    to: "To",
    segment: "Segment",
    allSegments: "All segments",
    visibility: "Headline metrics",
    showAll: "Show all",
    hideAll: "Hide all",
    explorer: "Metric explorer",
    chartType: "Chart type",
    line: "Line",
    bar: "Column",
    area: "Area",
    timeline: "Corporate timeline",
    risksTop: "Top risk factors",
    severity: "Severity",
    segRev: "Segment revenue",
    segEarn: "Segment earnings",
    geo: "Geographic revenue",
    competitors: "Named competitors",
    revVsNi: "Revenue & earnings",
    margins: "Margins",
    cash: "Cash flows",
    summary: "Executive summary",
    unit: "Unit",
    evidence: "Filing reference",
    filed: "Filed",
    periodEnd: "Period end",
    export: "Export financial CSV",
    print: "Print / save PDF",
    dataNote:
      "Figures and commentary are extracted from the uploaded filing. Verify material figures against the source document before relying on them.",
    noData: "No data reported for this section in the filing.",
    noEvents: "No events match your search.",
    searchEvents: "Search events…",
    sortBy: "Sort by",
    latest: "Latest reported KPIs",
    selectedPeriods: "Selected periods",
    filterNote:
      "Period filters affect charts; KPI cards always show the latest reported period. The segment filter applies to segment charts.",
    eventDate: "Date",
    event: "Event",
    category: "Category",
    impact: "Impact",
    all: "All",
    results: "results",
    noSegments: "No segment series could be verified from this filing. Check the filing's segment note for available figures.",
    noFinancials: "No financial series available for charting.",
    incomplete: "This section could not be completed from the uploaded filing.",
    marketIncomplete: "No verified peers, geographic revenue, or operating-segment figures were available. Unverified market claims were left out.",
    incompleteFinancials: "Historical financial figures could not be established from this filing. Upload a DFP or ITR for financial charts.",
    failedModule: "This analysis module could not be completed. Please try the filing again.",
    limitedData: "Limited extraction",
    source: "Source filing",
    kpiTitle: "Toggle individual KPI cards",
    allPeriods: "All periods",
    confidence: "Confidence notes",
    missingData: "Missing-data inventory",
    validation: "Financial validation",
    sourceRef: "Source",
    metadata: "Metadata",
    filingSource: "Filing disclosure",
    externalSource: "External source",
    externalEnrichmentLimited: "The profile and timeline use the uploaded filing only. Competitor research is added separately only when a cited web source is verified.",
    webResearchEmpty: "The filing did not name competitors, and web research returned no verifiable citations.",
    webResearchUnavailable: "The filing did not name competitors, and web research could not be completed. Try this filing again later.",
    peerWebSource: "Web research",
    timelineValidationLimited: "Some timeline items were omitted because their date or filing citation did not pass validation.",
    signalCaution: "Automated review signals only; they are not findings of misconduct or misstatement.",
    marketValidationLimited: "Items without a verifiable filing citation were omitted from the market module.",
  },
  pt: {
    overview: "Visão geral",
    market: "Mercado",
    risks: "Riscos",
    financials: "Financeiro",
    events: "Eventos",
    filters: "Controles do dashboard",
    period: "Período fiscal",
    from: "De",
    to: "Até",
    segment: "Segmento",
    allSegments: "Todos os segmentos",
    visibility: "Indicadores principais",
    showAll: "Mostrar todos",
    hideAll: "Ocultar todos",
    explorer: "Explorador de métricas",
    chartType: "Tipo de gráfico",
    line: "Linha",
    bar: "Colunas",
    area: "Área",
    timeline: "Linha do tempo corporativa",
    risksTop: "Principais fatores de risco",
    severity: "Gravidade",
    segRev: "Receita por segmento",
    segEarn: "Resultado por segmento",
    geo: "Receita por geografia",
    competitors: "Concorrentes citados",
    revVsNi: "Receita e lucro",
    margins: "Margens",
    cash: "Fluxos de caixa",
    summary: "Resumo executivo",
    unit: "Unidade",
    evidence: "Referência do documento",
    filed: "Entregue em",
    periodEnd: "Fim do período",
    export: "Exportar CSV financeiro",
    print: "Imprimir / salvar PDF",
    dataNote:
      "Números e comentários foram extraídos do documento enviado. Confira os valores relevantes na fonte antes de utilizá-los.",
    noData: "O documento não informa dados para esta seção.",
    noEvents: "Nenhum evento corresponde à busca.",
    searchEvents: "Buscar eventos…",
    sortBy: "Ordenar por",
    latest: "Indicadores do período mais recente",
    selectedPeriods: "Períodos selecionados",
    filterNote:
      "Os filtros de período afetam os gráficos; os indicadores sempre mostram o período divulgado mais recente. O filtro de segmento se aplica aos gráficos por segmento.",
    eventDate: "Data",
    event: "Evento",
    category: "Categoria",
    impact: "Impacto",
    all: "Todos",
    results: "resultados",
    noSegments: "Não foi possível verificar uma série por segmento neste documento. Confira a nota de segmentos para ver os valores divulgados.",
    noFinancials: "Não há séries financeiras disponíveis para o gráfico.",
    incomplete: "Esta seção não pôde ser concluída a partir do documento enviado.",
    marketIncomplete: "Não foram encontrados concorrentes verificáveis, receita geográfica ou valores por segmento. Afirmações de mercado sem fonte foram omitidas.",
    incompleteFinancials: "Não foi possível estabelecer séries financeiras históricas a partir deste documento. Envie uma DFP ou ITR para visualizar os gráficos financeiros.",
    failedModule: "Este módulo de análise não pôde ser concluído. Tente analisar o documento novamente.",
    limitedData: "Extração limitada",
    source: "Documento-fonte",
    kpiTitle: "Mostrar ou ocultar indicadores",
    allPeriods: "Todos os períodos",
    confidence: "Notas de confiança",
    missingData: "Inventário de dados ausentes",
    validation: "Validação financeira",
    sourceRef: "Fonte",
    metadata: "Metadados",
    filingSource: "Divulgação no documento",
    externalSource: "Fonte externa",
    externalEnrichmentLimited: "O perfil e a linha do tempo usam apenas o documento enviado. A pesquisa de concorrentes é separada e só aparece quando uma fonte web citável é verificada.",
    webResearchEmpty: "O documento não citou concorrentes e a pesquisa na web não encontrou citações verificáveis.",
    webResearchUnavailable: "O documento não citou concorrentes e a pesquisa na web não pôde ser concluída. Tente novamente mais tarde.",
    peerWebSource: "Pesquisa web",
    timelineValidationLimited: "Alguns itens da linha do tempo foram omitidos porque a data ou a citação do documento não passou pela validação.",
    signalCaution: "São apenas sinais automatizados para revisão; não constituem constatação de irregularidade ou distorção.",
    marketValidationLimited: "Itens sem citação verificável do documento foram omitidos do módulo de mercado.",
  },
};

interface Props {
  data: FilingAnalysis;
  lang: "en" | "pt";
}

function Chart({
  option,
  height = 320,
  label,
}: {
  option: EChartsOption;
  height?: number;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = echarts.init(hostRef.current);
    chartRef.current = chart;
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(hostRef.current);
    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(
      { backgroundColor: "transparent", animation: false, ...option },
      { notMerge: true }
    );
  }, [option]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      style={{ width: "100%", height }}
    />
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 px-5 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function compactMoney(value: number, locale: "pt-BR" | "en-US") {
  const abs = Math.abs(value);
  const isBrazilian = locale === "pt-BR";
  const suffixB = isBrazilian ? " bi" : "B";
  const suffixM = isBrazilian ? " mi" : "M";
  if (abs >= 1000)
    return `${formatFilingNumber(value / 1000, locale, 1)}${suffixB}`;
  return `${formatFilingNumber(value, locale, 1)}${suffixM}`;
}

function financialAmount(
  value: number | null | undefined,
  jurisdiction: "br" | "us",
  locale: "pt-BR" | "en-US",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const prefix = jurisdiction === "br" ? "R$ " : "$";
  const abs = Math.abs(value);
  const isBr = jurisdiction === "br";
  if (abs >= 1000) {
    return `${prefix}${formatFilingNumber(value / 1000, locale, 1)}${isBr ? " bi" : "B"}`;
  }
  return `${prefix}${formatFilingNumber(value, locale, 1)}${isBr ? " mi" : "M"}`;
}

function rate(value: number | null | undefined, locale: "pt-BR" | "en-US"): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${formatFilingNumber(value, locale, 1)}%`;
}

function multiple(value: number | null | undefined, locale: "pt-BR" | "en-US"): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "N/M"
    : `${formatFilingNumber(value, locale, 1)}x`;
}

function latestValue(values: Array<number | null | undefined> | null | undefined): number | null {
  const value = values?.at(-1);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function sourceText(source: EvidenceReference | null | undefined): string {
  if (!source) return "";
  return [source.sourceForm, source.item, source.section, source.page && `p. ${source.page}`]
    .filter(Boolean)
    .join(" · ");
}

function financialFlagLabel(code: string, lang: "en" | "pt"): string {
  const labels: Record<string, [string, string]> = {
    AR_SURGE: ["Receivables growth outpaced revenue", "Contas a receber cresceram acima da receita"],
    INVENTORY_BUILDUP: ["Inventory growth outpaced revenue", "Estoques cresceram acima da receita"],
    AP_ANOMALY: ["Payables growth diverged from cost growth", "Fornecedores divergiram do custo"],
    GROSS_MARGIN_SHIFT: ["Gross margin changed materially", "Margem bruta variou materialmente"],
    NET_MARGIN_SHIFT: ["Net margin changed materially", "Margem líquida variou materialmente"],
    CASH_FLOW_DIVERGENCE: ["Operating cash flow diverged from net income", "Fluxo operacional divergiu do lucro líquido"],
    PERSISTENT_NEGATIVE_OCF: ["Operating cash flow was negative for consecutive periods", "Fluxo operacional negativo em períodos consecutivos"],
    EXCESSIVE_GOODWILL: ["Goodwill exceeds the screening threshold", "Goodwill supera o limite de triagem"],
    LIABILITIES_TO_ASSETS_SCREEN: ["Liabilities/assets screening signal", "Sinal de triagem passivo/ativo"],
    LOW_CURRENT_RATIO: ["Current ratio below 1.00", "Índice de liquidez corrente abaixo de 1,00"],
  };
  return labels[code]?.[lang === "pt" ? 1 : 0] ?? code.replaceAll("_", " ");
}

export default function Dashboard({ data, lang }: Props) {
  const [tab, setTab] = useState(0);
  const [riskCategory, setRiskCategory] = useState<string | null>(null);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [metric, setMetric] = useState<FinancialMetric>("revenue");
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const [hiddenKpis, setHiddenKpis] = useState<string[]>([]);
  const [eventQuery, setEventQuery] = useState("");
  const [eventSort, setEventSort] = useState<EventSortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const t = COPY[lang];
  const filingLocale = data.jurisdiction === "br" ? "pt-BR" : "en-US";
  const names = METRIC_NAMES[lang];
  const f = data.financials;
  const years = f.years;
  const availableMetrics = METRIC_KEYS.filter(key => {
    const values = f[key];
    return (
      Array.isArray(values) && values.some(value => Number.isFinite(value))
    );
  });

  const startIdx =
    periodFrom && years.includes(periodFrom) ? years.indexOf(periodFrom) : 0;
  const endIdx =
    periodTo && years.includes(periodTo)
      ? years.indexOf(periodTo)
      : Math.max(years.length - 1, 0);
  const lowIdx = Math.min(startIdx, endIdx);
  const highIdx = Math.max(startIdx, endIdx);
  const indices = years
    .map((_, i) => i)
    .filter(i => i >= lowIdx && i <= highIdx);
  const selectedYears = indices.map(i => years[i]);
  const computed = computeFinancialMetrics(f);
  const calculated = (key: string) => computed.find(item => item.key === key);
  const calculatedValues = (key: string) => calculated(key)?.values ?? years.map(() => null);
  const latestCalculated = (key: string) => latestValue(calculatedValues(key));
  const isFinancialInstitution = /\b(bank|banco|banking|insurance|seguradora|insurer|reit)\b/i.test(data.market.industry);
  const activeMetric: FinancialMetric = availableMetrics.includes(metric)
    ? metric
    : (availableMetrics[0] ?? "revenue");
  const selectedSegments = data.market.segments.filter(
    segment => segmentFilter === "all" || segment.name === segmentFilter
  );
  const riskCategories = [...new Set(data.risks.map(risk => risk.category))];
  const filteredRisks = data.risks
    .filter(risk => !riskCategory || risk.category === riskCategory)
    .slice()
    .sort((a, b) => {
      if (a.materialityRank && b.materialityRank) return a.materialityRank - b.materialityRank;
      return b.severity - a.severity;
    });
  const filteredEvents = data.events
    .filter(event =>
      `${event.date} ${event.title} ${event.category} ${event.impact ?? ""}`
        .toLowerCase()
        .includes(eventQuery.toLowerCase())
    )
    .slice()
    .sort((a, b) => {
      const comparison = a[eventSort].localeCompare(b[eventSort], undefined, {
        numeric: true,
      });
      return sortAsc ? comparison : -comparison;
    });

  const periodValues = (values: Array<number | null> | null | undefined) =>
    indices.map(i => values?.[i] ?? null);
  const calculatedPeriodValues = (key: string) => indices.map(i => calculatedValues(key)[i] ?? null);
  const chartAxisFormatter = (key: FinancialMetric) => (value: number) => {
    if (key === "grossMargin" || key === "operatingMargin") return `${formatFilingNumber(value, filingLocale, 1)}%`;
    if (key === "eps") return `${data.jurisdiction === "br" ? "R$" : "$"}${formatFilingNumber(value, filingLocale, 2)}`;
    return compactMoney(value, filingLocale);
  };
  const financialMetricOption = (
    key: FinancialMetric,
    kind: ChartKind
  ): EChartsOption => {
    const values = periodValues(f[key]);
    const isArea = kind === "area";
    const isBar = kind === "bar";
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: value => chartAxisFormatter(key)(Number(value)),
      },
      grid: GRID,
      xAxis: { type: "category", data: selectedYears, ...AXIS },
      yAxis: {
        type: "value",
        ...AXIS,
        axisLabel: { color: "#94a3b8", formatter: chartAxisFormatter(key) },
      },
      series: [
        {
          name: names[key],
          type: isBar ? "bar" : "line",
          data: values,
          connectNulls: false,
          smooth: !isBar,
          symbolSize: 8,
          barMaxWidth: 48,
          lineStyle: { width: 3, color: METRIC_COLORS[key] },
          itemStyle: {
            color: METRIC_COLORS[key],
            borderRadius: isBar ? [5, 5, 0, 0] : undefined,
          },
          areaStyle: isArea ? { color: `${METRIC_COLORS[key]}40` } : undefined,
        },
      ],
    };
  };

  const segmentOption = (field: "revenue" | "earnings"): EChartsOption => {
    const series = selectedSegments
      .map((segment, i) => {
        const alignedValues = alignSegmentSeries(
          field === "revenue" ? segment.revenue : segment.earnings,
          years.length,
        );
        return {
          name: segment.name,
          values: indices.map(index => alignedValues[index] ?? null),
          color:
            SEG_COLORS[data.market.segments.indexOf(segment) % SEG_COLORS.length] ??
            SEG_COLORS[i % SEG_COLORS.length],
        };
      })
      .filter(item => item.values.some(value => value !== null));
    const single = segmentFilter !== "all";
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: value => compactMoney(Number(value), filingLocale),
      },
      legend: {
        show: !single,
        textStyle: { color: "#cbd5e1", fontSize: 11 },
        type: "scroll",
      },
      grid: GRID,
      xAxis: { type: "category", data: selectedYears, ...AXIS },
      yAxis: {
        type: "value",
        ...AXIS,
        axisLabel: {
          color: "#94a3b8",
          formatter: (value: number) => compactMoney(value, filingLocale),
        },
      },
      series: series.map(item => ({
        name: item.name,
        type: single ? ("line" as const) : ("bar" as const),
        ...(single ? {} : { stack: "segments" }),
        data: item.values,
        smooth: single,
        barMaxWidth: 56,
        lineStyle: { width: 3, color: item.color },
        itemStyle: {
          color: item.color,
          borderRadius: single ? undefined : [3, 3, 0, 0],
        },
      })),
    };
  };

  const geographyOption: EChartsOption = {
    tooltip: {
      trigger: "axis",
      valueFormatter: value => compactMoney(Number(value), filingLocale),
    },
    legend: { textStyle: { color: "#cbd5e1", fontSize: 11 }, type: "scroll" },
    grid: GRID,
    xAxis: { type: "category", data: selectedYears, ...AXIS },
    yAxis: {
      type: "value",
      ...AXIS,
      axisLabel: {
        color: "#94a3b8",
        formatter: (value: number) => compactMoney(value, filingLocale),
      },
    },
    series: data.market.geographies.map((geo, i) => ({
      name: geo.name,
      type: "bar" as const,
      stack: "geographies",
      data: periodValues(geo.values),
      itemStyle: { color: SEG_COLORS[i % SEG_COLORS.length] },
    })),
  };

  const combinedFinancialsOption: EChartsOption = {
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: "#cbd5e1" } },
    grid: GRID,
    xAxis: { type: "category", data: selectedYears, ...AXIS },
    yAxis: [
      {
        type: "value",
        ...AXIS,
        axisLabel: {
          color: "#94a3b8",
          formatter: (value: number) => compactMoney(value, filingLocale),
        },
      },
      {
        type: "value",
        ...AXIS,
        axisLabel: {
          color: "#94a3b8",
          formatter: (value: number) => `${formatFilingNumber(value, filingLocale, 1)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: names.revenue,
        type: "bar",
        data: periodValues(f.revenue),
        itemStyle: { color: "#3b82f6", borderRadius: [4, 4, 0, 0] },
      },
      {
        name: names.netIncome,
        type: "bar",
        data: periodValues(f.netIncome),
        itemStyle: { color: "#34d399", borderRadius: [4, 4, 0, 0] },
      },
      ...(f.grossMargin
        ? [
            {
              name: names.grossMargin,
              type: "line" as const,
              yAxisIndex: 1,
              data: periodValues(f.grossMargin),
              smooth: true,
              lineStyle: { color: "#fbbf24", width: 3 },
              itemStyle: { color: "#fbbf24" },
            },
          ]
        : []),
    ],
  };

  const marginOption: EChartsOption = {
    tooltip: { trigger: "axis", valueFormatter: value => `${formatFilingNumber(Number(value), filingLocale, 1)}%` },
    legend: { textStyle: { color: "#cbd5e1" } },
    grid: GRID,
    xAxis: { type: "category", data: selectedYears, ...AXIS },
    yAxis: {
      type: "value",
      ...AXIS,
      axisLabel: {
        color: "#94a3b8",
        formatter: (value: number) => `${formatFilingNumber(value, filingLocale, 1)}%`,
      },
    },
    series: [
      ...(f.grossMargin
        ? [
            {
              name: names.grossMargin,
              type: "line" as const,
              data: periodValues(f.grossMargin),
              smooth: true,
              lineStyle: { color: "#fbbf24", width: 3 },
            },
          ]
        : []),
      ...(f.operatingMargin
        ? [
            {
              name: names.operatingMargin,
              type: "line" as const,
              data: periodValues(f.operatingMargin),
              smooth: true,
              lineStyle: { color: "#22d3ee", width: 3 },
            },
          ]
        : []),
    ],
  };

  const cashOption: EChartsOption = {
    tooltip: {
      trigger: "axis",
      valueFormatter: value => compactMoney(Number(value), filingLocale),
    },
    legend: { textStyle: { color: "#cbd5e1" }, type: "scroll" },
    grid: GRID,
    xAxis: { type: "category", data: selectedYears, ...AXIS },
    yAxis: {
      type: "value",
      ...AXIS,
      axisLabel: {
        color: "#94a3b8",
        formatter: (value: number) => compactMoney(value, filingLocale),
      },
    },
    series: [
      ...(f.operatingCashFlow
        ? [
            {
              name: names.operatingCashFlow,
              type: "bar" as const,
              data: periodValues(f.operatingCashFlow),
              itemStyle: { color: "#34d399" },
            },
          ]
        : []),
      ...(f.freeCashFlow
        ? [
            {
              name: names.freeCashFlow,
              type: "line" as const,
              data: periodValues(f.freeCashFlow),
              smooth: true,
              lineStyle: { color: "#22d3ee", width: 3 },
            },
          ]
        : []),
      ...(f.dividends
        ? [
            {
              name: lang === "pt" ? "Dividendos" : "Dividends",
              type: "bar" as const,
              data: periodValues(f.dividends),
              itemStyle: { color: "#a78bfa" },
            },
          ]
        : []),
      ...(f.buybacks
        ? [
            {
              name: lang === "pt" ? "Recompras" : "Buybacks",
              type: "bar" as const,
              data: periodValues(f.buybacks),
              itemStyle: { color: "#f472b6" },
            },
          ]
        : []),
    ],
  };

  const debtCashOption: EChartsOption = {
    tooltip: {
      trigger: "axis",
      valueFormatter: value => compactMoney(Number(value), filingLocale),
    },
    legend: { textStyle: { color: "#cbd5e1" } },
    grid: GRID,
    xAxis: { type: "category", data: selectedYears, ...AXIS },
    yAxis: {
      type: "value",
      ...AXIS,
      axisLabel: {
        color: "#94a3b8",
        formatter: (value: number) => compactMoney(value, filingLocale),
      },
    },
    series: [
      ...(f.totalDebt
        ? [
            {
              name: names.totalDebt,
              type: "bar" as const,
              data: periodValues(f.totalDebt),
              itemStyle: { color: "#f87171" },
            },
          ]
        : []),
      ...(f.cash
        ? [
            {
              name: names.cash,
              type: "bar" as const,
              data: periodValues(f.cash),
              itemStyle: { color: "#22d3ee" },
            },
          ]
        : []),
      ...(calculated("netDebt")
        ? [
            {
              name: lang === "pt" ? "Dívida líquida" : "Net debt",
              type: "line" as const,
              data: calculatedPeriodValues("netDebt"),
              smooth: true,
              lineStyle: { color: "#fbbf24", width: 3 },
              itemStyle: { color: "#fbbf24" },
            },
          ]
        : []),
    ],
  };

  const amountAndRateOption = (
    amount: number[] | null | undefined,
    amountName: string,
    rateValues: Array<number | null>,
    rateName: string,
    color: string,
  ): EChartsOption => ({
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: "#cbd5e1", fontSize: 11 } },
    grid: GRID,
    xAxis: { type: "category", data: selectedYears, ...AXIS },
    yAxis: [
      { type: "value", ...AXIS, axisLabel: { color: "#94a3b8", formatter: (value: number) => compactMoney(value, filingLocale) } },
      { type: "value", ...AXIS, axisLabel: { color: "#94a3b8", formatter: (value: number) => `${formatFilingNumber(value, filingLocale, 1)}%` }, splitLine: { show: false } },
    ],
    series: [
      { name: amountName, type: "bar", data: periodValues(amount), barMaxWidth: 52, itemStyle: { color, borderRadius: [4, 4, 0, 0] } },
      { name: rateName, type: "line", yAxisIndex: 1, data: indices.map(i => rateValues[i] ?? null), smooth: true, lineStyle: { color: "#fbbf24", width: 3 }, itemStyle: { color: "#fbbf24" } },
    ],
  });

  const revenueGrowthOption = amountAndRateOption(
    f.revenue,
    names.revenue,
    calculatedValues("revenueGrowth"),
    lang === "pt" ? "Crescimento da receita" : "Revenue growth",
    "#3b82f6",
  );
  const ebitdaMarginOption = amountAndRateOption(
    f.ebitda,
    names.ebitda,
    calculatedValues("ebitdaMargin"),
    lang === "pt" ? "Margem EBITDA" : "EBITDA margin",
    "#a78bfa",
  );
  const netIncomeMarginOption = amountAndRateOption(
    f.netIncome,
    names.netIncome,
    calculatedValues("netMargin"),
    lang === "pt" ? "Margem líquida" : "Net margin",
    "#34d399",
  );

  const toggleKpi = (label: string) =>
    setHiddenKpis(current =>
      current.includes(label)
        ? current.filter(item => item !== label)
        : [...current, label]
    );
  const exportFinancials = () => {
    const header = [lang === "pt" ? "Métrica" : "Metric", ...selectedYears];
    const rows: (string | number | null)[][] = METRIC_KEYS.filter(key =>
      Array.isArray(f[key])
    ).map(key => [names[key], ...periodValues(f[key])]);
    if (!isFinancialInstitution) for (const definition of FINANCIAL_INDICATORS) {
      const item = calculated(definition.key);
      if (item) rows.push([`${definition[lang]} (${item.unit})`, ...periodValues(item.values)]);
    }
    const csv = [header, ...rows]
      .map(row => row.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `filinglens-financials-${data.company.ticker || "company"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const tabs = [t.overview, t.market, t.risks, t.financials, t.events];
  const sourceLine = [
    data.company.filingType,
    data.jurisdiction === "br" ? data.metadata.cnpj : data.metadata.cik,
    data.jurisdiction === "us" && data.metadata.sicCode && `SIC ${data.metadata.sicCode}`,
    data.company.exchange,
    data.company.ticker,
    data.company.periodEnd && `${t.periodEnd}: ${data.company.periodEnd}`,
    data.company.filedAt && `${t.filed}: ${data.company.filedAt}`,
    data.company.filingReference,
  ]
    .filter(Boolean)
    .join(" · ");
  const unitText = f.unit ? `${t.unit}: ${f.unit}` : "";
  const isReferenceForm = /formul[aá]rio\s+de\s+refer[eê]ncia/i.test(data.company.filingType);
  const isNarrativeForm = isReferenceForm || /(^|\s)8-k($|\s)|fato\s+relevante/i.test(data.company.filingType);
  const financialGuidance = data.jurisdiction === "br"
    ? t.incompleteFinancials
    : (lang === "pt"
        ? "Este documento não contém séries financeiras históricas suficientes. Envie um 10-K ou 10-Q para gerar os gráficos."
        : "This filing does not contain sufficient historical financial series. Upload a 10-K or 10-Q for financial charts.");
  const moduleMessage = (agent: AgentName, fallback: string) => {
    const diagnostic = data.diagnostics?.[agent];
    if (diagnostic?.status === "failed") return t.failedModule;
    if (diagnostic?.status === "not_applicable") return agent === "financials" ? financialGuidance : t.incomplete;
    if (diagnostic?.status === "incomplete") {
      if (agent === "market") return t.marketIncomplete;
      return agent === "financials" && isNarrativeForm
        ? financialGuidance
        : t.incomplete;
    }
    return fallback;
  };
  const incompleteModules = (
    Object.entries(data.diagnostics ?? {}) as [AnalysisStageName, { status: string }][]
  )
    .filter(([, diagnostic]) => diagnostic.status !== "complete")
    .map(([agent]) => agent);
  const hasSkippedEnrichment = Object.values(data.diagnostics ?? {}).some(
    diagnostic => diagnostic?.enrichmentStatus === "skipped",
  );
  const moduleNames: Record<AnalysisStageName, string> = {
    metadata: t.metadata,
    profiler: lang === "pt" ? "Perfil" : "Profile",
    market: t.market,
    risks: t.risks,
    financials: t.financials,
    historian: lang === "pt" ? "Linha do tempo" : "Timeline",
    synthesizer: t.summary,
  };
  const evidenceFor = (metric: string) =>
    (f.evidence ?? []).find(item => item.metric === metric)?.source;
  const financialCards = [
    { key: "revenue", label: names.revenue, value: latestValue(f.revenue), detail: rate(latestCalculated("revenueGrowth"), filingLocale), type: "reported" as const, source: evidenceFor("revenue") },
    { key: "ebitda", label: names.ebitda, value: latestValue(f.ebitda), detail: rate(latestCalculated("ebitdaMargin"), filingLocale), type: "reported" as const, source: evidenceFor("ebitda") },
    ...(latestValue(f.adjustedEbitda) === null ? [] : [{ key: "adjustedEbitda", label: names.adjustedEbitda, value: latestValue(f.adjustedEbitda), detail: lang === "pt" ? "Não-GAAP / definição da companhia" : "Non-GAAP / company-defined", type: "adjusted" as const, source: evidenceFor("adjustedEbitda") }]),
    { key: "netIncome", label: names.netIncome, value: latestValue(f.netIncome), detail: rate(latestCalculated("netMargin"), filingLocale), type: "reported" as const, source: evidenceFor("netIncome") },
    { key: "netDebt", label: lang === "pt" ? "Dívida líquida" : "Net debt", value: latestCalculated("netDebt"), detail: lang === "pt" ? "Dívida bruta − caixa" : "Gross debt − cash", type: "calculated" as const, source: calculated("netDebt")?.sources[0] },
    ...(isFinancialInstitution ? [] : [{ key: "netDebtToEbitda", label: lang === "pt" ? "Dívida líquida / EBITDA" : "Net debt / EBITDA", value: latestCalculated("netDebtToEbitda"), detail: lang === "pt" ? "Dívida líquida ÷ EBITDA" : "Net debt ÷ EBITDA", type: "calculated" as const, source: calculated("netDebtToEbitda")?.sources[0], multiple: true }]),
    { key: "freeCashFlow", label: lang === "pt" ? "Fluxo de caixa livre" : "Free cash flow", value: latestCalculated("freeCashFlowCalculated"), detail: latestCalculated("fcfMargin") === null ? "—" : rate(latestCalculated("fcfMargin"), filingLocale), type: calculated("freeCashFlowCalculated")?.type ?? "calculated", source: calculated("freeCashFlowCalculated")?.sources[0] },
    ...(isFinancialInstitution ? [] : [{ key: "roic", label: "ROIC", value: latestCalculated("roic"), detail: lang === "pt" ? "NOPAT ÷ capital investido médio" : "NOPAT ÷ average invested capital", type: "calculated" as const, source: calculated("roic")?.sources[0], percent: true }]),
    ...(isFinancialInstitution || latestCalculated("reportedRoic") === null ? [] : [{ key: "reportedRoic", label: lang === "pt" ? "ROIC divulgado" : "Company-reported ROIC", value: latestCalculated("reportedRoic"), detail: lang === "pt" ? "Definição própria da companhia" : "Company-defined methodology", type: "reported" as const, source: calculated("reportedRoic")?.sources[0], percent: true }]),
  ].filter(card => card.value !== null);
  const historicalRows = [
    { key: "revenue", label: names.revenue, values: f.revenue.map(value => value ?? null), unit: "currency" as const, type: "reported" as const, source: evidenceFor("revenue") },
    { key: "revenueGrowth", label: lang === "pt" ? "Crescimento da receita" : "Revenue growth", values: calculatedValues("revenueGrowth"), unit: "percent" as const, type: "calculated" as const, source: calculated("revenueGrowth")?.sources[0] },
    { key: "ebitda", label: names.ebitda, values: f.ebitda ?? [], unit: "currency" as const, type: "reported" as const, source: evidenceFor("ebitda") },
    { key: "adjustedEbitda", label: names.adjustedEbitda, values: f.adjustedEbitda ?? [], unit: "currency" as const, type: "adjusted" as const, source: evidenceFor("adjustedEbitda") },
    { key: "ebitdaMargin", label: lang === "pt" ? "Margem EBITDA" : "EBITDA margin", values: calculatedValues("ebitdaMargin"), unit: "percent" as const, type: "calculated" as const, source: calculated("ebitdaMargin")?.sources[0] },
    { key: "ebit", label: names.ebit, values: f.ebit ?? [], unit: "currency" as const, type: "reported" as const, source: evidenceFor("ebit") },
    { key: "netIncome", label: names.netIncome, values: f.netIncome.map(value => value ?? null), unit: "currency" as const, type: "reported" as const, source: evidenceFor("netIncome") },
    { key: "netMargin", label: lang === "pt" ? "Margem líquida" : "Net margin", values: calculatedValues("netMargin"), unit: "percent" as const, type: "calculated" as const, source: calculated("netMargin")?.sources[0] },
    { key: "operatingCashFlow", label: names.operatingCashFlow, values: f.operatingCashFlow ?? [], unit: "currency" as const, type: "reported" as const, source: evidenceFor("operatingCashFlow") },
    { key: "capex", label: "CAPEX", values: f.capex ?? [], unit: "currency" as const, type: "reported" as const, source: evidenceFor("capex") },
    { key: "freeCashFlow", label: lang === "pt" ? "Fluxo de caixa livre" : "Free cash flow", values: calculatedValues("freeCashFlowCalculated"), unit: "currency" as const, type: calculated("freeCashFlowCalculated")?.type ?? "calculated", source: calculated("freeCashFlowCalculated")?.sources[0] },
    { key: "totalDebt", label: lang === "pt" ? "Dívida bruta" : "Gross debt", values: f.totalDebt ?? [], unit: "currency" as const, type: "reported" as const, source: evidenceFor("totalDebt") },
    { key: "netDebt", label: lang === "pt" ? "Dívida líquida" : "Net debt", values: calculatedValues("netDebt"), unit: "currency" as const, type: "calculated" as const, source: calculated("netDebt")?.sources[0] },
    { key: "currentRatio", label: lang === "pt" ? "Liquidez corrente" : "Current ratio", values: calculatedValues("currentRatio"), unit: "multiple" as const, type: "calculated" as const, source: calculated("currentRatio")?.sources[0] },
    { key: "roe", label: "ROE", values: calculatedValues("roe"), unit: "percent" as const, type: "calculated" as const, source: calculated("roe")?.sources[0] },
    { key: "roa", label: "ROA", values: calculatedValues("roa"), unit: "percent" as const, type: "calculated" as const, source: calculated("roa")?.sources[0] },
    { key: "interestCoverage", label: lang === "pt" ? "Cobertura de juros" : "Interest coverage", values: calculatedValues("interestCoverage"), unit: "multiple" as const, type: "calculated" as const, source: calculated("interestCoverage")?.sources[0] },
    ...(!isFinancialInstitution ? [{ key: "roic", label: "ROIC", values: calculatedValues("roic"), unit: "percent" as const, type: "calculated" as const, source: calculated("roic")?.sources[0] }, { key: "reportedRoic", label: lang === "pt" ? "ROIC divulgado" : "Company-reported ROIC", values: calculatedValues("reportedRoic"), unit: "percent" as const, type: "reported" as const, source: calculated("reportedRoic")?.sources[0] }] : []),
    ...(!isFinancialInstitution ? [{ key: "netDebtToEbitda", label: lang === "pt" ? "Dívida líquida / EBITDA" : "Net debt / EBITDA", values: calculatedValues("netDebtToEbitda"), unit: "multiple" as const, type: "calculated" as const, source: calculated("netDebtToEbitda")?.sources[0] }] : []),
    ...(!isFinancialInstitution ? FINANCIAL_INDICATORS.map(definition => ({
      key: definition.key, label: definition[lang], values: calculatedValues(definition.key),
      unit: calculated(definition.key)?.unit === "currency" ? "currency" as const : calculated(definition.key)?.unit === "percent" ? "percent" as const : calculated(definition.key)?.unit === "days" ? "days" as const : "multiple" as const,
      type: "calculated" as const, source: calculated(definition.key)?.sources[0],
    })) : []),
  ].filter(row => row.values.some(value => value !== null && value !== undefined));
  const historicalCell = (value: number | null | undefined, unit: "currency" | "percent" | "multiple" | "days") =>
    unit === "currency" ? financialAmount(value, data.jurisdiction, filingLocale)
      : unit === "percent" ? rate(value, filingLocale)
        : unit === "days" ? (value == null ? "—" : `${formatFilingNumber(value, filingLocale, 0)} ${lang === "pt" ? "dias" : "days"}`)
        : multiple(value, filingLocale);

  const historicalRowByKey = new Map(historicalRows.map(row => [row.key, row]));
  const selectedHistoricalRows = [
    historicalRowByKey.get("revenue"),
    historicalRowByKey.get("netIncome"),
    historicalRowByKey.get("grossMarginCalculated") ?? historicalRowByKey.get("ebitdaMargin") ?? historicalRowByKey.get("netMargin"),
    ...(isFinancialInstitution ? [] : [historicalRowByKey.get("roic")]),
    ...(isFinancialInstitution ? [] : [historicalRowByKey.get("netDebtToEbitda")]),
    historicalRowByKey.get("currentRatio") ?? historicalRowByKey.get("interestCoverage") ?? historicalRowByKey.get("earningsCashConversion") ?? historicalRowByKey.get("roePeriodEnd"),
  ].filter((row): row is NonNullable<typeof row> => Boolean(row)).slice(0, 6);

  return (
    <section
      className="dashboard-print overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/80 shadow-2xl shadow-slate-950/30"
      aria-label={`${data.company.name} filing dashboard`}
    >
      <header className="border-b border-slate-700 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-200">
                {data.jurisdiction === "br" ? "CVM" : "SEC"} · {lang === "pt" ? "Análise de documento" : "Filing analysis"}
              </span>
              <span className="rounded-full border border-violet-500/30 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200">
                JSON v{data.schemaVersion}
              </span>
              {data.company.filingType && (
                <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-slate-300">
                  {data.company.filingType}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {data.company.name}
              </h2>
              {data.company.ticker && (
                <span className="rounded-md bg-blue-500/15 px-2 py-0.5 text-sm font-bold text-blue-300">
                  {data.company.ticker}
                </span>
              )}
            </div>
            {sourceLine && (
              <p className="mt-2 text-xs text-slate-400">
                {t.evidence}: {sourceLine}
              </p>
            )}
            {data.company.description && (
              <p className="mt-4 max-w-4xl text-sm leading-relaxed text-slate-300">
                {data.company.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportFinancials}
              className="rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-500/70 hover:text-white"
            >
              {t.export}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-500/70 hover:text-white"
            >
              {t.print}
            </button>
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside
          className="border-b border-slate-700 bg-slate-950/40 p-5 lg:border-b-0 lg:border-r"
          aria-label={t.filters}
        >
          <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-300">
            {t.filters}
          </h3>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="period-from"
                className="mb-1.5 block text-xs font-medium text-slate-400"
              >
                {t.from}
              </label>
              <select
                id="period-from"
                value={periodFrom}
                onChange={event => setPeriodFrom(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="">{t.allPeriods}</option>
                {years.map(year => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="period-to"
                className="mb-1.5 block text-xs font-medium text-slate-400"
              >
                {t.to}
              </label>
              <select
                id="period-to"
                value={periodTo}
                onChange={event => setPeriodTo(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="">{t.allPeriods}</option>
                {years.map(year => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="segment-filter"
                className="mb-1.5 block text-xs font-medium text-slate-400"
              >
                {t.segment}
              </label>
              <select
                id="segment-filter"
                value={segmentFilter}
                onChange={event => setSegmentFilter(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="all">{t.allSegments}</option>
                {data.market.segments.map(segment => (
                  <option key={segment.name} value={segment.name}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="border-t border-slate-800 pt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span
                  className="text-xs font-medium text-slate-400"
                  title={t.kpiTitle}
                >
                  {t.visibility}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setHiddenKpis(
                      hiddenKpis.length ? [] : data.kpis.map(kpi => kpi.label)
                    )
                  }
                  className="text-[10px] font-semibold text-cyan-300 hover:text-cyan-200"
                >
                  {hiddenKpis.length ? t.showAll : t.hideAll}
                </button>
              </div>
              {data.kpis.length ? (
                <div className="max-h-48 space-y-1 overflow-auto pr-1">
                  {data.kpis.map(kpi => (
                    <label
                      key={kpi.label}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-xs text-slate-300 hover:bg-slate-800/70"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenKpis.includes(kpi.label)}
                        onChange={() => toggleKpi(kpi.label)}
                        className="accent-cyan-400"
                      />
                      <span className="truncate">{kpi.label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-600">{t.noData}</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-[11px] leading-relaxed text-slate-500">
              <div className="mb-1 font-semibold text-slate-400">
                {t.selectedPeriods}
              </div>
              {selectedYears.length
                ? selectedYears.join(" · ")
                : t.noFinancials}
              {unitText && <div className="mt-1">{unitText}</div>}
              <div className="mt-2 border-t border-slate-800 pt-2">
                {t.filterNote}
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          {incompleteModules.length > 0 && (
            <div
              role="status"
              className="m-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:mx-6"
            >
              <span className="font-semibold">{t.limitedData}:</span>{" "}
              {incompleteModules.map(agent => {
                const missing = data.diagnostics?.[agent]?.missing?.join(", ");
                const guidance = agent === "market" ? t.marketIncomplete
                  : agent === "financials" && isNarrativeForm ? financialGuidance
                    : missing || t.incomplete;
                return `${moduleNames[agent]}: ${guidance}`;
              }).join(" · ")}
            </div>
          )}
          {hasSkippedEnrichment && (
            <div role="note" className="mx-4 mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-xs leading-relaxed text-slate-400 sm:mx-6">
              <span className="font-semibold text-slate-300">{lang === "pt" ? "Limite de fontes:" : "Source boundary:"}</span>{" "}{t.externalEnrichmentLimited}
            </div>
          )}
          <nav
            className="flex gap-1 overflow-x-auto border-b border-slate-700 px-4 pt-2"
            aria-label={
              lang === "pt" ? "Seções do dashboard" : "Dashboard sections"
            }
          >
            {tabs.map((name, i) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(i)}
                aria-current={tab === i ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition sm:px-4 ${tab === i ? "border-cyan-400 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
              >
                {name}
              </button>
            ))}
          </nav>

          <div className="p-4 sm:p-6">
            {tab === 0 && (
              <div className="space-y-6">
                <section aria-label={t.latest}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                      {t.latest}
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      {selectedYears.length
                        ? `${selectedYears[0]} – ${selectedYears[selectedYears.length - 1]}`
                        : t.allPeriods}
                    </span>
                  </div>
                  {data.kpis.filter(kpi => !hiddenKpis.includes(kpi.label))
                    .length ? (
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      {data.kpis
                        .filter(kpi => !hiddenKpis.includes(kpi.label))
                        .map(kpi => (
                          <article
                            key={kpi.label}
                            className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/50 p-4"
                          >
                            <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              {kpi.label}
                            </div>
                            <div
                              className="mt-1 truncate text-xl font-bold text-slate-50"
                              title={kpi.value}
                            >
                              {formatKpiValue(kpi.value, filingLocale)}
                            </div>
                            {kpi.delta && (
                              <div
                                className={`mt-1 text-xs font-medium ${kpi.positive === false ? "text-rose-400" : "text-emerald-400"}`}
                              >
                                {kpi.positive === false ? "↓" : "↑"} {formatKpiValue(kpi.delta, filingLocale)}
                              </div>
                            )}
                            {sourceText(kpi.source) && (
                              <div className="mt-2 text-[10px] leading-snug text-slate-500">
                                {t.sourceRef}: {sourceText(kpi.source)}
                              </div>
                            )}
                          </article>
                        ))}
                    </div>
                  ) : (
                    <EmptyState>{t.noData}</EmptyState>
                  )}
                </section>

                <div className="grid gap-4 xl:grid-cols-2">
                  <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-cyan-200">
                        {t.revVsNi}
                      </h3>
                      {unitText && (
                        <span className="text-[10px] text-slate-500">
                          {unitText}
                        </span>
                      )}
                    </div>
                    {f.revenue.length || f.netIncome.length ? (
                      <Chart
                        option={combinedFinancialsOption}
                        label={t.revVsNi}
                      />
                    ) : (
                      <EmptyState>
                        {moduleMessage("financials", t.noFinancials)}
                      </EmptyState>
                    )}
                  </article>
                  <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-cyan-200">
                        {t.explorer}
                      </h3>
                      <div className="flex gap-2">
                        <select
                          aria-label={t.explorer}
                          value={activeMetric}
                          onChange={event =>
                            setMetric(event.target.value as FinancialMetric)
                          }
                          className="max-w-36 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                        >
                          {availableMetrics.map(key => (
                            <option key={key} value={key}>
                              {names[key]}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={t.chartType}
                          value={chartKind}
                          onChange={event =>
                            setChartKind(event.target.value as ChartKind)
                          }
                          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                        >
                          <option value="line">{t.line}</option>
                          <option value="bar">{t.bar}</option>
                          <option value="area">{t.area}</option>
                        </select>
                      </div>
                    </div>
                    {availableMetrics.length ? (
                      <Chart
                        option={financialMetricOption(activeMetric, chartKind)}
                        label={`${names[activeMetric]} ${t.explorer}`}
                      />
                    ) : (
                      <EmptyState>{t.noFinancials}</EmptyState>
                    )}
                  </article>
                  {selectedSegments.some(segment => segment.revenue.length > 0) && (
                    <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                      <h3 className="mb-1 text-sm font-semibold text-cyan-200">
                        {t.segRev}{" "}
                        {unitText && (
                          <span className="text-[10px] font-normal text-slate-500">
                            ({f.unit})
                          </span>
                        )}
                      </h3>
                      <Chart
                        option={segmentOption("revenue")}
                        label={t.segRev}
                      />
                    </article>
                  )}
                  {data.market.geographies.length > 0 && (
                    <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                      <h3 className="mb-1 text-sm font-semibold text-cyan-200">
                        {t.geo}
                      </h3>
                      <Chart option={geographyOption} label={t.geo} />
                    </article>
                  )}
                </div>
                {(data.timeline.length > 0 || data.summary.length > 0) && (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                      <h3 className="mb-4 text-sm font-semibold text-cyan-200">
                        {t.timeline}
                      </h3>
                      {data.timeline.length ? (
                        <div className="space-y-2 border-l border-slate-700 pl-4">
                          {data.timeline.map((event, i) => (
                            <details
                              key={`${event.year}-${event.title}-${i}`}
                              className="group relative rounded-lg border border-slate-700/60 bg-slate-900/50 p-3"
                            >
                              <span className="absolute -left-[21px] top-4 h-2.5 w-2.5 rounded-full bg-blue-400 ring-4 ring-slate-900" />
                              <summary className="cursor-pointer list-none text-sm font-medium text-slate-200">
                                <span className="font-bold text-blue-300">
                                  {event.year}
                                </span>{" "}
                                · {event.title}
                                <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                                  {event.category}
                                </span>
                              </summary>
                              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                                {event.detail}
                              </p>
                              <span className="mt-2 inline-flex rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-400">
                                {event.sourceType === "external" ? t.externalSource : t.filingSource}
                              </span>
                              {sourceText(event.source) && (
                                <p className="mt-2 text-[10px] text-slate-500">
                                  {t.sourceRef}: {sourceText(event.source)}
                                </p>
                              )}
                            </details>
                          ))}
                        </div>
                      ) : (
                        <EmptyState>{t.noData}</EmptyState>
                      )}
                    </article>
                    <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                      <h3 className="mb-4 text-sm font-semibold text-cyan-200">
                        {t.summary}
                      </h3>
                      {data.summary.length ? (
                        <ul className="space-y-2">
                          {data.summary.map((item, i) => (
                            <li
                              key={`${i}-${item}`}
                              className="flex gap-3 rounded-lg border border-slate-700/60 bg-slate-900/50 p-3 text-sm leading-relaxed text-slate-300"
                            >
                              <span className="mt-0.5 font-bold text-cyan-400">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <EmptyState>{t.noData}</EmptyState>
                      )}
                    </article>
                  </div>
                )}
                {(data.confidenceNotes.length > 0 || data.missingData.length > 0) && (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                      <h3 className="mb-3 text-sm font-semibold text-cyan-200">{t.confidence}</h3>
                      {data.confidenceNotes.length ? (
                        <div className="space-y-2">
                          {data.confidenceNotes.map((note, index) => (
                            <div key={`${note.claim}-${index}`} className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-xs leading-relaxed text-slate-300">{note.claim}</p>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${note.confidence === "high" ? "bg-emerald-500/15 text-emerald-300" : note.confidence === "medium" ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300"}`}>
                                  {note.confidence}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">{note.reason}</p>
                              {sourceText(note.source) && <p className="mt-1 text-[10px] text-slate-600">{t.sourceRef}: {sourceText(note.source)}</p>}
                            </div>
                          ))}
                        </div>
                      ) : <EmptyState>{t.noData}</EmptyState>}
                    </article>
                    <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                      <h3 className="mb-3 text-sm font-semibold text-cyan-200">{t.missingData}</h3>
                      {data.missingData.length ? (
                        <ul className="space-y-2 text-sm text-slate-300">
                          {data.missingData.map((item, index) => (
                            <li key={`${item}-${index}`} className="flex gap-2 rounded-lg border border-slate-700/60 bg-slate-900/50 p-3">
                              <span className="text-amber-400">•</span><span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-sm text-slate-500">{lang === "pt" ? "Nenhuma ausência relevante foi identificada." : "No material missing data was identified."}</p>}
                    </article>
                  </div>
                )}
              </div>
            )}

            {tab === 1 && (
              <div className="grid gap-4 xl:grid-cols-2">
                {(data.market.validationFlags?.length ?? 0) > 0 && <div role="status" className="xl:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-100/80">{t.marketValidationLimited} {lang === "pt" ? "Itens:" : "Items:"} {data.market.validationFlags?.length}.</div>}
                {(data.market.insights?.length ?? 0) > 0 && (
                  <article className="xl:col-span-2 rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-cyan-200">{lang === "pt" ? "Variações divulgadas por segmento e região" : "Disclosed segment and geography trends"}</h3>
                      <span className="text-[10px] text-slate-500">{lang === "pt" ? "Cálculo sobre séries comparáveis do documento" : "Calculated from comparable filing series"}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {data.market.insights!.slice(-6).map((insight, index) => {
                        const metricLabel = insight.metric === "earnings" ? (lang === "pt" ? "Resultado" : "Earnings") : (lang === "pt" ? "Receita" : "Revenue");
                        const direction = insight.changePercent > 0 ? (lang === "pt" ? "cresceu" : "grew") : insight.changePercent < 0 ? (lang === "pt" ? "caiu" : "declined") : (lang === "pt" ? "ficou estável" : "was flat");
                        return <div key={`${insight.dimension}-${insight.name}-${insight.period}-${index}`} title={insight.source.quote ?? sourceText(insight.source)} className="rounded-lg bg-slate-900/60 p-3">
                          <div className="text-xs font-semibold text-slate-200">{metricLabel} · {insight.name}</div>
                          <div className={`mt-1 text-sm font-bold ${insight.changePercent < 0 ? "text-rose-300" : "text-emerald-300"}`}>{insight.changePercent < 0 ? "▼" : insight.changePercent > 0 ? "▲" : "•"} {formatFilingNumber(Math.abs(insight.changePercent), filingLocale, 1)}%</div>
                          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{lang === "pt" ? `${direction} em ${insight.period} vs. ${insight.comparisonPeriod}. A variação localiza onde a receita/resultado divulgado mudou; o documento não estabelece a causa.` : `${direction} in ${insight.period} vs. ${insight.comparisonPeriod}. This identifies where disclosed activity changed; the filing does not establish the cause.`}</p>
                          <div className="mt-2 text-[10px] text-slate-500">{t.filingSource} · {sourceText(insight.source) || insight.source.section}</div>
                        </div>;
                      })}
                    </div>
                  </article>
                )}
                  {selectedSegments.some(segment => segment.revenue.length > 0) ? (
                  <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <h3 className="mb-1 text-sm font-semibold text-cyan-200">
                      {t.segRev}{" "}
                      {unitText && (
                        <span className="text-[10px] font-normal text-slate-500">
                          ({f.unit})
                        </span>
                      )}
                    </h3>
                    <Chart option={segmentOption("revenue")} label={t.segRev} />
                  </article>
                ) : (
                  <EmptyState>{moduleMessage("market", t.noSegments)}</EmptyState>
                )}
                {selectedSegments.some(segment => segment.earnings?.length) && (
                  <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <h3 className="mb-1 text-sm font-semibold text-cyan-200">
                      {t.segEarn}
                    </h3>
                    <Chart
                      option={segmentOption("earnings")}
                      label={t.segEarn}
                    />
                  </article>
                )}
                {data.market.geographies.length > 0 && (
                  <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <h3 className="mb-1 text-sm font-semibold text-cyan-200">
                      {t.geo}
                    </h3>
                    <Chart option={geographyOption} label={t.geo} />
                  </article>
                )}
                <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-cyan-200">
                    {data.market.industry || t.market} — {t.competitors}
                  </h3>
                  {data.market.competitors.length ? (
                    <div className="flex flex-wrap gap-2">
                      {data.market.competitors.map(competitor => {
                        const evidence = data.market.peerEvidence?.find(peer => peer.name.toLowerCase() === competitor.toLowerCase());
                        const source = evidence?.source;
                        const external = evidence?.sourceType === "external";
                        const label = external ? t.peerWebSource : t.filingSource;
                        const title = external ? `${source?.publisher ?? label} · ${source?.accessed ?? ""}` : source?.quote ?? sourceText(source);
                        const content = <>{competitor}<span className="ml-1 text-[9px] text-slate-400">· {label}</span></>;
                        return external && source?.url
                          ? <a key={competitor} href={source.url} target="_blank" rel="noreferrer" title={title} className="rounded-full border border-cyan-700/70 bg-cyan-950/40 px-3 py-1.5 text-xs text-cyan-100 hover:border-cyan-400">{content}</a>
                          : <span key={competitor} title={title} className="rounded-full border border-slate-600 bg-slate-700/50 px-3 py-1.5 text-xs text-slate-200">{content}</span>;
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {data.market.externalResearchStatus === "unavailable" ? t.webResearchUnavailable
                        : data.market.externalResearchStatus === "no_citable_results" ? t.webResearchEmpty
                          : moduleMessage("market", t.noData)}
                    </p>
                  )}
                </article>
              </div>
            )}

            {tab === 2 && (
              <div>
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRiskCategory(null)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${!riskCategory ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-600 text-slate-400 hover:text-white"}`}
                  >
                    {t.all}
                  </button>
                  {riskCategories.map(category => (
                    <button
                      type="button"
                      key={category}
                      onClick={() => setRiskCategory(category)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${riskCategory === category ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-600 text-slate-400 hover:text-white"}`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                {filteredRisks.length ? (
                  <div className="space-y-3">
                    {filteredRisks.map((risk, i) => {
                      const color =
                        risk.severity >= 4
                          ? "#f87171"
                          : risk.severity >= 3
                            ? "#fbbf24"
                            : "#34d399";
                      return (
                        <article
                          key={`${risk.title}-${i}`}
                          className="rounded-xl border border-slate-700/80 bg-slate-800/35 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-slate-100">
                              {risk.materialityRank ?? i + 1}. {risk.title}
                            </h3>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-slate-700 px-2 py-1 text-[10px] text-slate-300">
                                {risk.category}
                              </span>
                              <span
                                className="rounded-full px-2 py-1 text-[10px] font-bold"
                                style={{ background: `${color}25`, color }}
                              >
                                {t.severity} {risk.severity}/5
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 h-1.5 w-full rounded-full bg-slate-700">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(0, Math.min(100, risk.severity * 20))}%`,
                                background: color,
                              }}
                            />
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-slate-400">
                            {risk.summary}
                          </p>
                          {sourceText(risk.source) && (
                            <p className="mt-2 text-[10px] text-slate-500">
                              {t.sourceRef}: {sourceText(risk.source)}
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState>{moduleMessage("risks", t.noData)}</EmptyState>
                )}
              </div>
            )}

            {tab === 3 && (
              <div className="space-y-4">
                {financialCards.length > 0 && (
                  <section aria-label={lang === "pt" ? "Indicadores financeiros" : "Financial indicators"}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                        {lang === "pt" ? "Indicadores financeiros" : "Financial indicators"}
                      </h3>
                      {unitText && <span className="text-[10px] text-slate-500">{unitText}</span>}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {financialCards.map(card => (
                        <article key={card.key} className="rounded-xl border border-slate-700 bg-slate-800/35 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{card.label}</div>
                            <span className="rounded-full border border-slate-700 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
                              {card.type === "reported" ? (lang === "pt" ? "reportado" : "reported") : card.type === "adjusted" ? (lang === "pt" ? "ajustado" : "adjusted") : (lang === "pt" ? "calculado" : "calculated")}
                            </span>
                          </div>
                          <div className="mt-2 text-2xl font-bold text-slate-50">
                            {"multiple" in card && card.multiple ? multiple(card.value, filingLocale) : "percent" in card && card.percent ? rate(card.value, filingLocale) : financialAmount(card.value, data.jurisdiction, filingLocale)}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">{card.detail}</div>
                          {sourceText(card.source) && <div className="mt-2 text-[10px] text-slate-500">{t.sourceRef}: {sourceText(card.source)}</div>}
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                <nav aria-label={lang === "pt" ? "Navegação financeira" : "Financial sections"} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-700/70 bg-slate-900/50 px-4 py-3 text-xs">
                  <span className="font-semibold text-slate-300">{lang === "pt" ? "Ir para" : "Jump to"}:</span>
                  <a className="text-cyan-300 underline underline-offset-2" href="#financial-trends">{lang === "pt" ? "Gráficos de KPIs" : "KPI charts"}</a>
                  <a className="text-cyan-300 underline underline-offset-2" href="#financial-additional-indicators">{lang === "pt" ? "Outros indicadores" : "Other indicators"}</a>
                  <a className="text-cyan-300 underline underline-offset-2" href="#financial-history">{lang === "pt" ? "Histórico e índices" : "History and ratios"}</a>
                </nav>

                <section id="financial-trends" className="scroll-mt-6 space-y-3" aria-label={lang === "pt" ? "Gráficos de tendências financeiras" : "Financial trend charts"}>
                  <h3 className="text-base font-semibold text-cyan-200">{lang === "pt" ? "Tendências dos KPIs" : "KPI trends"}</h3>
                  <div className="grid gap-4 xl:grid-cols-2">
                  {f.revenue.length > 0 && <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4"><h3 className="mb-1 text-sm font-semibold text-cyan-200">{lang === "pt" ? "Receita e crescimento" : "Revenue and growth"}</h3><Chart option={revenueGrowthOption} label={lang === "pt" ? "Receita e crescimento" : "Revenue and growth"} /></article>}
                  {f.ebitda && f.ebitda.length > 0 && <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4"><h3 className="mb-1 text-sm font-semibold text-cyan-200">{lang === "pt" ? "EBITDA e margem" : "EBITDA and margin"}</h3><Chart option={ebitdaMarginOption} label={lang === "pt" ? "EBITDA e margem" : "EBITDA and margin"} /></article>}
                  {f.netIncome.length > 0 && <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4"><h3 className="mb-1 text-sm font-semibold text-cyan-200">{lang === "pt" ? "Lucro líquido e margem" : "Net income and margin"}</h3><Chart option={netIncomeMarginOption} label={lang === "pt" ? "Lucro líquido e margem" : "Net income and margin"} /></article>}
                  {(f.operatingCashFlow || f.freeCashFlow || f.dividends || f.buybacks) && <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4"><h3 className="mb-1 text-sm font-semibold text-cyan-200">{t.cash}</h3><Chart option={cashOption} label={t.cash} /></article>}
                  {!isFinancialInstitution && (f.totalDebt || f.cash) && <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4"><h3 className="mb-1 text-sm font-semibold text-cyan-200">{lang === "pt" ? "Dívida, caixa e dívida líquida" : "Debt, cash and net debt"}</h3><Chart option={debtCashOption} label={lang === "pt" ? "Dívida, caixa e dívida líquida" : "Debt, cash and net debt"} /></article>}
                  {(f.grossMargin || f.operatingMargin) && <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4"><h3 className="mb-1 text-sm font-semibold text-cyan-200">{t.margins}</h3><Chart option={marginOption} label={t.margins} /></article>}
                  </div>
                </section>

                {years.length > 0 && (
                  <section id="financial-additional-indicators" className="scroll-mt-6 rounded-xl border border-slate-700 bg-slate-800/25 p-4" aria-label={lang === "pt" ? "Indicadores complementares" : "Additional indicators"}>
                    <h3 className="text-base font-semibold text-cyan-200">{lang === "pt" ? "Indicadores complementares" : "Additional indicators"}</h3>
                    <p className="mt-2 text-sm text-slate-400">{isFinancialInstitution
                      ? (lang === "pt" ? "Estes indicadores corporativos não são apresentados para instituições financeiras. Consulte ROE, ROA e os indicadores regulatórios divulgados pela companhia." : "These corporate indicators are not displayed for financial institutions. See ROE, ROA and company-disclosed regulatory metrics.")
                      : (lang === "pt" ? "Calculados exclusivamente com dados do documento. Valores ausentes ou denominadores não significativos não são substituídos por zero. Histórico na tabela abaixo; sem anualização de trimestres." : "Calculated exclusively from filing data. Missing inputs or non-meaningful denominators are never replaced with zero. History is shown below; quarters are not annualized.")}</p>
                    {!isFinancialInstitution && (["profitability", "cash", "liquidity"] as const).map(group => (
                      <details key={group} open className="mt-4 border-t border-slate-700 pt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-200">{group === "profitability" ? (lang === "pt" ? "Rentabilidade e eficiência" : "Profitability and efficiency") : group === "cash" ? (lang === "pt" ? "Geração e qualidade do caixa" : "Cash generation and quality") : (lang === "pt" ? "Liquidez e endividamento" : "Liquidity and debt")}</summary>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {FINANCIAL_INDICATORS.filter(definition => definition.group === group).map(definition => {
                            const item = calculated(definition.key);
                            const index = years.length - 1;
                            const value = item?.values[index];
                            return <article key={definition.key} className="rounded-lg bg-slate-900/60 p-3">
                              <h4 className="text-sm text-slate-300">{definition[lang]}</h4>
                              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-50">{value == null ? "—" : historicalCell(value, item?.unit === "currency" ? "currency" : item?.unit === "percent" ? "percent" : item?.unit === "days" ? "days" : "multiple")}</div>
                              <p className="mt-1 text-sm text-slate-400">{years[index]} · {value == null ? (lang === "pt" ? "Dados insuficientes ou base não significativa" : "Insufficient inputs or non-meaningful basis") : (lang === "pt" ? "Calculado" : "Calculated")}</p>
                              <p className="mt-2 break-words text-sm text-slate-400">{lang === "pt" ? definition.formulaPt : definition.formulaEn}</p>
                              <p className="mt-1 text-sm text-slate-500">{lang === "pt" ? definition.notePt : item?.note}</p>
                              {item && <p className="mt-2 text-sm text-slate-500">{lang === "pt" ? "Fontes dos componentes: " : "Input sources: "}{item.sources.length ? item.sources.map(sourceText).filter(Boolean).join(" · ") : (lang === "pt" ? "Referência de fonte não disponível" : "Source reference unavailable")}</p>}
                            </article>;
                          })}
                        </div>
                      </details>
                    ))}
                    <p className="mt-4 text-sm text-slate-500">{lang === "pt" ? "Múltiplos de mercado e dividend yield exigem cotações e não são inferidos do documento. Liquidez seca, prazos médios e DuPont só aparecem quando todos os componentes necessários estão divulgados. Definições: " : "Market multiples and dividend yield require prices and are not inferred from a filing. Quick ratio, turnover days and DuPont appear only when all required inputs are disclosed. Definitions: "}<a className="text-cyan-300 underline" href="https://www.cfainstitute.org/sites/default/files/-/media/documents/support/programs/cfa/cfa_program_level_ii_financial_ratio_list.pdf" target="_blank" rel="noreferrer">CFA Institute</a>.</p>
                  </section>
                )}

                {!isFinancialInstitution && (latestValue(f.totalDebt) !== null || latestValue(f.operatingCashFlow) !== null) && (
                  <section className="rounded-xl border border-slate-700 bg-slate-800/25 p-4" aria-label={lang === "pt" ? "Relações financeiras" : "Financial relationships"}>
                    <h3 className="mb-3 text-sm font-semibold text-cyan-200">{lang === "pt" ? "Relações financeiras" : "Financial relationships"}</h3>
                    <div className="grid gap-3 lg:grid-cols-3">
                      {latestCalculated("netDebt") !== null && (
                        <div className="rounded-lg bg-slate-900/60 p-3 text-sm text-slate-300">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">{lang === "pt" ? "Dívida líquida" : "Net debt"}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>{financialAmount(latestValue(f.totalDebt), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">−</span><span>{financialAmount(latestValue(f.cash), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">=</span><strong className="text-cyan-200">{financialAmount(latestCalculated("netDebt"), data.jurisdiction, filingLocale)}</strong></div>
                          <div className="mt-2 text-[10px] text-slate-500">{lang === "pt" ? "Dívida bruta − caixa" : "Gross debt − cash"}</div>
                        </div>
                      )}
                      {latestCalculated("freeCashFlowCalculated") !== null && (
                        <div className="rounded-lg bg-slate-900/60 p-3 text-sm text-slate-300">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">{lang === "pt" ? "Fluxo de caixa livre" : "Free cash flow"}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>{financialAmount(latestValue(f.operatingCashFlow), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">−</span><span>{financialAmount(latestValue(f.capex), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">=</span><strong className="text-cyan-200">{financialAmount(latestCalculated("freeCashFlowCalculated"), data.jurisdiction, filingLocale)}</strong></div>
                          <div className="mt-2 text-[10px] text-slate-500">{calculated("freeCashFlowCalculated")?.type === "reported" ? (lang === "pt" ? "Valor divulgado; componentes para referência." : "Reported value; components shown for reference.") : (lang === "pt" ? "FCO − CAPEX" : "Operating cash flow − Capex")}</div>
                        </div>
                      )}
                      {latestCalculated("netDebtToEbitda") !== null && (
                        <div className="rounded-lg bg-slate-900/60 p-3 text-sm text-slate-300">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">{lang === "pt" ? "Alavancagem" : "Leverage"}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>{financialAmount(latestCalculated("netDebt"), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">÷</span><span>{financialAmount(latestValue(f.ebitda), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">=</span><strong className="text-cyan-200">{multiple(latestCalculated("netDebtToEbitda"), filingLocale)}</strong></div>
                          <div className="mt-2 text-[10px] text-slate-500">{lang === "pt" ? "Dívida líquida ÷ EBITDA" : "Net debt ÷ EBITDA"}</div>
                        </div>
                      )}
                      {latestCalculated("roic") !== null && (
                        <div className="rounded-lg bg-slate-900/60 p-3 text-sm text-slate-300">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">ROIC</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>{financialAmount(latestCalculated("nopat"), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">÷</span><span>{financialAmount(latestCalculated("averageInvestedCapital"), data.jurisdiction, filingLocale)}</span><span className="text-slate-500">=</span><strong className="text-cyan-200">{rate(latestCalculated("roic"), filingLocale)}</strong></div>
                          <div className="mt-2 text-[10px] text-slate-500">{lang === "pt" ? "NOPAT ÷ capital investido médio" : "NOPAT ÷ average invested capital"}</div>
                        </div>
                      )}
                    </div>
                  </section>
                )}



                {selectedHistoricalRows.length > 0 && (
                  <section id="financial-history" className="scroll-mt-6 overflow-hidden rounded-xl border border-slate-700 bg-slate-800/25">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-4 py-3"><h3 className="text-sm font-semibold text-cyan-200">{lang === "pt" ? "Indicadores e dados financeiros" : "Financial metrics and ratios"}</h3><span className="text-[10px] text-slate-500">{lang === "pt" ? "Até 6 métricas · períodos divulgados" : "Up to 6 metrics · disclosed periods"}</span></div>
                    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-900/60 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">{lang === "pt" ? "Métrica" : "Metric"}</th>{years.map(year => <th key={year} className="px-3 py-3 text-right">{year}</th>)}<th className="px-4 py-3">{lang === "pt" ? "Base" : "Basis"}</th><th className="px-4 py-3">{t.sourceRef}</th></tr></thead><tbody>{selectedHistoricalRows.map(row => <tr key={row.key} className="border-t border-slate-800 text-slate-300"><th className="px-4 py-3 font-medium text-slate-200">{row.label}</th>{years.map((_, index) => <td key={index} className="px-3 py-3 text-right tabular-nums">{historicalCell(row.values[index], row.unit)}</td>)}<td className="px-4 py-3 text-[10px] text-slate-500">{row.type === "reported" ? (lang === "pt" ? "Reportado" : "Reported") : row.type === "adjusted" ? (lang === "pt" ? "Ajustado" : "Adjusted") : (lang === "pt" ? "Calculado" : "Calculated")}</td><td className="px-4 py-3 text-[10px] text-slate-500">{sourceText(row.source) || "—"}</td></tr>)}</tbody></table></div>
                  </section>
                )}

                {(f.trends?.length ?? 0) > 0 && (
                  <section className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-cyan-200">{lang === "pt" ? "Variações entre períodos comparáveis" : "Comparable-period trends"}</h3>
                      <span className="text-[10px] text-slate-500">{lang === "pt" ? "Sem anualização de trimestres" : "No quarterly annualization"}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {f.trends!.slice(-6).map((trend, index) => {
                        const metricLabel = names[trend.metric as FinancialMetric] ?? trend.metric;
                        return <div key={`${trend.metric}-${trend.period}-${trend.comparisonPeriod}-${index}`} className="rounded-lg bg-slate-900/60 p-3">
                          <div className="text-xs font-semibold text-slate-200">{metricLabel} · {trend.period}</div>
                          <div className={`mt-1 text-sm font-bold ${trend.changePercent < 0 ? "text-rose-300" : "text-emerald-300"}`}>{trend.changePercent < 0 ? "▼" : "▲"} {formatFilingNumber(Math.abs(trend.changePercent), filingLocale, 1)}%</div>
                          <div className="mt-1 text-[10px] text-slate-500">{trend.comparison} {lang === "pt" ? "vs." : "vs."} {trend.comparisonPeriod}</div>
                        </div>;
                      })}
                    </div>
                  </section>
                )}

                {f.validation && (
                  <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-cyan-200">{t.validation}</h3>
                    <div className="grid gap-3 sm:grid-cols-4"><div className="rounded-lg bg-slate-900/60 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">A = L + E</div><div className={`mt-1 text-sm font-semibold ${f.validation.balanceSheetIdentity === "reconciled" ? "text-emerald-300" : f.validation.balanceSheetIdentity === "mismatch" ? "text-rose-300" : "text-slate-400"}`}>{f.validation.balanceSheetIdentity.replaceAll("_", " ")}</div>{f.validation.difference !== null && <div className="mt-1 text-xs text-slate-500">Δ {financialAmount(f.validation.difference, data.jurisdiction, filingLocale)}</div>}</div><div className="rounded-lg bg-slate-900/60 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">OCR</div><div className="mt-1 text-sm font-semibold text-slate-300">{f.validation.ocrAnomalies.length} {lang === "pt" ? "alertas" : "flags"}</div></div><div className="rounded-lg bg-slate-900/60 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">{lang === "pt" ? "Variações" : "Period jumps"}</div><div className="mt-1 text-sm font-semibold text-slate-300">{f.validation.jumpWarnings.length} {lang === "pt" ? "alertas" : "flags"}</div></div><div className="rounded-lg bg-slate-900/60 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">{lang === "pt" ? "Relações" : "Relationships"}</div><div className="mt-1 text-sm font-semibold text-slate-300">{f.validation.relationshipWarnings?.length ?? 0} {lang === "pt" ? "alertas" : "flags"}</div></div></div>
                    {(f.validationFlags?.length ?? 0) > 0 && <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-200">{lang === "pt" ? "Sinais automatizados para revisão" : "Automated review signals"}</p><ul className="space-y-1 text-xs text-amber-100/80">{f.validationFlags!.slice(0, 10).map((flag, index) => <li key={`${flag.code}-${flag.period}-${index}`}>• {financialFlagLabel(flag.code, lang)}{flag.period ? ` · ${flag.period}` : ""}{lang === "pt" ? " — requer avaliação contextual." : " — review in context."}</li>)}</ul><p className="mt-2 text-[10px] text-slate-500">{t.signalCaution}</p></div>}
                    {([...(f.validation.ocrAnomalies ?? []), ...(f.validation.jumpWarnings ?? []), ...(f.validation.relationshipWarnings ?? [])].length > 0) && <p className="mt-3 text-xs leading-relaxed text-amber-200/80">{[...f.validation.ocrAnomalies, ...f.validation.jumpWarnings, ...(f.validation.relationshipWarnings ?? [])].join(" · ")}</p>}
                  </article>
                )}
                {f.forwardGuidance && f.forwardGuidance.length > 0 && <article className="rounded-xl border border-slate-700 bg-slate-800/25 p-4"><h3 className="mb-3 text-sm font-semibold text-cyan-200">{lang === "pt" ? "Guidance prospectivo" : "Forward guidance"}</h3><div className="grid gap-2 md:grid-cols-2">{f.forwardGuidance.map((item, index) => <div key={`${item.metric}-${item.period}-${index}`} className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-3 text-sm text-slate-300"><span className="font-semibold text-white">{item.metric}</span> · {item.period} · {item.range}<div className="mt-1 text-[10px] text-slate-500">{t.sourceRef}: {sourceText(item.source)}</div></div>)}</div></article>}
                {availableMetrics.length === 0 && <EmptyState>{moduleMessage("financials", t.noFinancials)}</EmptyState>}
              </div>
            )}

            {tab === 4 && (
              <div>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div className="w-full sm:max-w-sm">
                    <label
                      htmlFor="event-search"
                      className="mb-1.5 block text-xs font-medium text-slate-400"
                    >
                      {t.searchEvents}
                    </label>
                    <input
                      id="event-search"
                      value={eventQuery}
                      onChange={event => setEventQuery(event.target.value)}
                      placeholder={t.searchEvents}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-500"
                    />
                  </div>
                  <label className="text-xs text-slate-400">
                    {t.sortBy}
                    <select
                      value={eventSort}
                      onChange={event =>
                        setEventSort(event.target.value as EventSortKey)
                      }
                      className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"
                    >
                      <option value="date">{t.eventDate}</option>
                      <option value="title">{t.event}</option>
                      <option value="category">{t.category}</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSortAsc(current => !current)}
                      className="ml-2 rounded-lg border border-slate-700 px-2 py-2 text-xs text-slate-300"
                      aria-label={
                        sortAsc ? "Ascending order" : "Descending order"
                      }
                    >
                      {sortAsc ? "↑" : "↓"}
                    </button>
                  </label>
                </div>
                {(data.historyValidationFlags?.length ?? 0) > 0 && (
                  <div role="status" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-100/80">
                    {t.timelineValidationLimited} {lang === "pt" ? "Itens sinalizados:" : "Items flagged:"} {data.historyValidationFlags?.length}.
                  </div>
                )}
                {filteredEvents.length ? (
                  <>
                    <div className="mb-2 text-xs text-slate-500">
                      {filteredEvents.length} {t.results}
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-700">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="bg-slate-800/80 text-[10px] uppercase tracking-wider text-slate-400">
                          <tr>
                            <th className="px-4 py-3">{t.eventDate}</th>
                            <th className="px-4 py-3">{t.event}</th>
                            <th className="px-4 py-3">{t.category}</th>
                            <th className="px-4 py-3">{t.impact}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEvents.map((event, i) => (
                            <tr
                              key={`${event.date}-${event.title}-${i}`}
                              className="border-t border-slate-800 text-slate-300 hover:bg-slate-800/40"
                            >
                              <td className="whitespace-nowrap px-4 py-3 font-medium text-blue-300">
                                {event.date}
                              </td>
                              <td className="px-4 py-3">{event.title}</td>
                              <td className="px-4 py-3">
                                <span className="rounded-full bg-slate-700 px-2 py-1 text-[10px]">
                                  {event.category}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-400">
                                {event.impact ?? "—"}
                                {(event.sourceForm || sourceText(event.source)) && (
                                  <span className="mt-1 block text-[10px] text-slate-500">
                                    {[event.sourceType === "external" ? t.externalSource : t.filingSource, event.sourceForm, sourceText(event.source)].filter(Boolean).join(" · ")}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <EmptyState>
                    {data.events.length ? t.noEvents : t.noData}
                  </EmptyState>
                )}
              </div>
            )}
          </div>
          <footer className="border-t border-slate-800 bg-slate-950/30 px-5 py-3 text-[11px] leading-relaxed text-slate-500 sm:px-6">
            {t.dataNote}
            {data.company.filingType ||
            data.company.periodEnd ||
            data.company.filingReference ? (
              <span className="mt-1 block">
                {t.source}:{" "}
                {[
                  data.company.name,
                  data.company.filingType,
                  data.company.periodEnd,
                  data.company.filedAt,
                  data.company.filingReference,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </footer>
        </div>
      </div>
    </section>
  );
}
