import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption, EChartsType } from "echarts";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Database,
  FileCheck2,
  Gauge,
  Globe2,
  Info,
  Landmark,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type {
  AnalysisStageName,
  EvidenceReference,
  FilingAnalysis,
  ModuleDiagnostic,
} from "@contracts/analysis";
import { formatFilingNumber } from "@/lib/number-format";
import { filingLensTheme, qualityClasses, type QualityTone } from "@/lib/design-system";

type Lang = "en" | "pt";
type Tab = "overview" | "financials" | "market" | "risks" | "events" | "quality";

const MODULES: Array<{ key: AnalysisStageName; en: string; pt: string }> = [
  { key: "metadata", en: "Metadata", pt: "Metadados" },
  { key: "profiler", en: "Profile", pt: "Perfil" },
  { key: "financials", en: "Financials", pt: "Financeiro" },
  { key: "market", en: "Market", pt: "Mercado" },
  { key: "risks", en: "Risks", pt: "Riscos" },
  { key: "historian", en: "Events", pt: "Eventos" },
  { key: "synthesizer", en: "Synthesis", pt: "Síntese" },
];

const COPY = {
  en: {
    analysis: "Company analysis",
    overview: "Overview",
    financials: "Financials",
    market: "Market",
    risks: "Risks",
    events: "Events",
    quality: "Data quality",
    coverage: "Analysis coverage",
    coverageHelp: "How much of the expected filing evidence produced usable structured output.",
    completeModules: "complete modules",
    dataGaps: "data gaps",
    research: "peer research",
    executive: "Executive takeaways",
    latest: "Latest reported",
    revenue: "Revenue",
    netIncome: "Net income",
    opCash: "Operating cash flow",
    cash: "Cash",
    debt: "Total debt",
    grossMargin: "Gross margin",
    operatingMargin: "Operating margin",
    trend: "Revenue and net income",
    annualHistory: "Five-year annual history",
    annualHistorySource: "Authoritative external regulatory history",
    competitiveAnalysis: "Competitive analysis",
    competitiveFindings: "Competitive findings",
    marketShare: "Public market-share proxy",
    marketShareBasis: "Auditable numerator ÷ denominator",
    noCompetitive: "No independently cited competitive-analysis evidence was available.",
    noFinancial: "No comparable financial series were established from the supplied filing bundle.",
    industry: "Industry / business context",
    peers: "Verified peers",
    segments: "Operating segments",
    geographies: "Geographies",
    noPeers: "No peer relationship passed the filing/citation verification boundary.",
    noSegments: "No operating-segment series was captured.",
    noGeographies: "No geographic series was captured.",
    riskTitle: "Principal risk factors",
    noRisks: "No structured risk list was captured. Check Data quality to see whether this was a disclosure gap or module limitation.",
    timeline: "Timeline and material events",
    noEvents: "No validated events were captured from the supplied evidence.",
    moduleCoverage: "Module coverage",
    missingInventory: "Missing-data inventory",
    confidence: "Confidence notes",
    evidence: "Evidence boundary",
    evidenceText: "Filing disclosures are primary. External sources are accepted only when explicitly citation-backed and are labeled separately.",
    noGaps: "No material data gaps were reported.",
    noConfidence: "No additional confidence notes were reported.",
    filing: "Filing",
    external: "External",
    disclosed: "disclosed",
    source: "Source",
    complete: "Complete",
    partial: "Partial",
    failed: "Unavailable",
    na: "Not applicable",
    researchComplete: "complete",
    researchUnavailable: "unavailable",
    researchNotNeeded: "not needed",
    researchPending: "pending",
    researchEmpty: "no citable results",
    period: "Reporting period",
    filed: "Filed",
    jurisdiction: "Jurisdiction",
    diagnosticHint: "Partial is a data-coverage state, not automatically a system error.",
  },
  pt: {
    analysis: "Análise da companhia",
    overview: "Visão geral",
    financials: "Financeiro",
    market: "Mercado",
    risks: "Riscos",
    events: "Eventos",
    quality: "Qualidade dos dados",
    coverage: "Cobertura da análise",
    coverageHelp: "Quanto da evidência esperada do documento gerou saída estruturada utilizável.",
    completeModules: "módulos completos",
    dataGaps: "lacunas de dados",
    research: "pesquisa de concorrentes",
    executive: "Principais conclusões",
    latest: "Último reportado",
    revenue: "Receita",
    netIncome: "Lucro líquido",
    opCash: "Fluxo de caixa operacional",
    cash: "Caixa",
    debt: "Dívida total",
    grossMargin: "Margem bruta",
    operatingMargin: "Margem operacional",
    trend: "Receita e lucro líquido",
    annualHistory: "Histórico anual de cinco anos",
    annualHistorySource: "Histórico regulatório externo oficial",
    competitiveAnalysis: "Análise competitiva",
    competitiveFindings: "Conclusões competitivas",
    marketShare: "Proxy público de participação de mercado",
    marketShareBasis: "Numerador ÷ denominador auditáveis",
    noCompetitive: "Não havia evidência citável independente suficiente para análise competitiva.",
    noFinancial: "Não foi possível estabelecer séries financeiras comparáveis a partir do conjunto enviado.",
    industry: "Indústria / contexto do negócio",
    peers: "Concorrentes verificados",
    segments: "Segmentos operacionais",
    geographies: "Geografias",
    noPeers: "Nenhuma relação de concorrência passou pela fronteira de verificação do documento/citação.",
    noSegments: "Nenhuma série de segmentos operacionais foi capturada.",
    noGeographies: "Nenhuma série geográfica foi capturada.",
    riskTitle: "Principais fatores de risco",
    noRisks: "Nenhuma lista estruturada de riscos foi capturada. Consulte Qualidade dos dados para distinguir lacuna de divulgação de limitação do módulo.",
    timeline: "Linha do tempo e eventos materiais",
    noEvents: "Nenhum evento validado foi capturado das evidências fornecidas.",
    moduleCoverage: "Cobertura por módulo",
    missingInventory: "Inventário de dados ausentes",
    confidence: "Notas de confiança",
    evidence: "Fronteira de evidências",
    evidenceText: "Divulgações regulatórias são primárias. Fontes externas só são aceitas quando possuem citação explícita e são rotuladas separadamente.",
    noGaps: "Nenhuma lacuna material foi reportada.",
    noConfidence: "Nenhuma nota adicional de confiança foi reportada.",
    filing: "Documento",
    external: "Externo",
    disclosed: "divulgado",
    source: "Fonte",
    complete: "Completo",
    partial: "Parcial",
    failed: "Indisponível",
    na: "Não aplicável",
    researchComplete: "concluída",
    researchUnavailable: "indisponível",
    researchNotNeeded: "não necessária",
    researchPending: "pendente",
    researchEmpty: "sem resultados citáveis",
    period: "Período reportado",
    filed: "Protocolado",
    jurisdiction: "Jurisdição",
    diagnosticHint: "Parcial é um estado de cobertura de dados; não significa automaticamente falha do sistema.",
  },
} as const;

function latest(values: Array<number | null | undefined> | null | undefined): number | null {
  if (!values?.length) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}

function amount(value: number | null, data: FilingAnalysis, lang: Lang) {
  if (value == null) return "—";
  const locale = lang === "pt" ? "pt-BR" : "en-US";
  const prefix = data.jurisdiction === "br" ? "R$ " : "$";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${prefix}${formatFilingNumber(value / 1000, locale, 1)}${lang === "pt" ? " bi" : "B"}`;
  return `${prefix}${formatFilingNumber(value, locale, 1)}${lang === "pt" ? " mi" : "M"}`;
}

function percent(value: number | null, lang: Lang) {
  if (value == null) return "—";
  return `${formatFilingNumber(value, lang === "pt" ? "pt-BR" : "en-US", 1)}%`;
}

function diagnosticTone(diagnostic: ModuleDiagnostic | undefined): QualityTone {
  if (!diagnostic) return "neutral";
  if (diagnostic.status === "complete") return "good";
  if (diagnostic.status === "not_applicable") return "neutral";
  if (diagnostic.status === "failed") return "bad";
  return "partial";
}

function diagnosticLabel(diagnostic: ModuleDiagnostic | undefined, lang: Lang) {
  const c = COPY[lang];
  if (!diagnostic) return c.partial;
  if (diagnostic.status === "complete") return c.complete;
  if (diagnostic.status === "not_applicable") return c.na;
  if (diagnostic.status === "failed") return c.failed;
  return c.partial;
}

function reasonText(diagnostic: ModuleDiagnostic | undefined) {
  if (!diagnostic?.reason) return "";
  return diagnostic.reason.replaceAll("_", " ");
}

function sourceText(source: EvidenceReference | null | undefined, lang: Lang) {
  if (!source) return "";
  if (source.url) return `${source.publisher ?? COPY[lang].external} · ${source.url}`;
  return [source.sourceForm, source.item, source.section, source.page ? `p. ${source.page}` : null].filter(Boolean).join(" · ");
}

function Chart({ option, label, height = 330 }: { option: EChartsOption; label: string; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  useEffect(() => {
    if (!host.current) return;
    chart.current = echarts.init(host.current);
    const resize = new ResizeObserver(() => chart.current?.resize());
    resize.observe(host.current);
    return () => { resize.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    chart.current?.setOption({ backgroundColor: "transparent", animation: false, ...option }, { notMerge: true });
  }, [option]);
  return <div ref={host} role="img" aria-label={label} style={{ width: "100%", height }} />;
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Info; title: string; text: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/80 bg-slate-950/25 px-6 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl border border-slate-700 bg-slate-900"><Icon className="h-4.5 w-4.5 text-slate-400" /></div>
      <p className="mt-3 text-sm font-semibold text-slate-200">{title}</p>
      <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}

function KpiCard({ label, value, detail, source }: { label: string; value: string; detail?: string; source?: string }) {
  return (
    <div className={`${filingLensTheme.surface} rounded-xl p-4`}>
      <p className={filingLensTheme.label}>{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-slate-500">{detail}</p>}
      {source && <p className="mt-3 line-clamp-2 border-t border-slate-800 pt-2 text-[9px] leading-relaxed text-slate-600">{source}</p>}
    </div>
  );
}

function CoverageCard({ data, lang }: { data: FilingAnalysis; lang: Lang }) {
  const c = COPY[lang];
  const diagnostics = MODULES.map(module => data.diagnostics?.[module.key]);
  const score = Math.round((diagnostics.reduce((sum, diagnostic) => {
    if (diagnostic?.status === "complete" || diagnostic?.status === "not_applicable") return sum + 1;
    if (diagnostic?.status === "incomplete") return sum + 0.55;
    return sum;
  }, 0) / MODULES.length) * 100);
  const complete = diagnostics.filter(item => item?.status === "complete" || item?.status === "not_applicable").length;
  const tone: QualityTone = score >= 85 ? "good" : score >= 55 ? "partial" : "bad";
  const researchStatus = data.market.externalResearchStatus ?? "pending";
  const researchLabel = researchStatus === "complete" ? c.researchComplete
    : researchStatus === "not_needed" ? c.researchNotNeeded
      : researchStatus === "no_citable_results" ? c.researchEmpty
        : researchStatus === "unavailable" ? c.researchUnavailable : c.researchPending;

  return (
    <div className={`${filingLensTheme.surfaceRaised} rounded-2xl p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`grid h-16 w-16 place-items-center rounded-2xl border ${qualityClasses(tone)}`}><span className="text-xl font-bold tabular-nums">{score}%</span></div>
          <div><p className={filingLensTheme.label}>{c.coverage}</p><p className="mt-1 text-sm font-semibold text-white">{complete}/{MODULES.length} {c.completeModules}</p><p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">{c.coverageHelp}</p></div>
        </div>
        <div className="grid min-w-[280px] grid-cols-2 gap-2 sm:grid-cols-3">
          <div className={`${filingLensTheme.inset} rounded-lg p-2.5`}><p className="text-[9px] uppercase tracking-wide text-slate-600">{c.dataGaps}</p><p className="mt-1 text-sm font-semibold text-white">{data.missingData.length}</p></div>
          <div className={`${filingLensTheme.inset} rounded-lg p-2.5 sm:col-span-2`}><p className="text-[9px] uppercase tracking-wide text-slate-600">{c.research}</p><p className="mt-1 text-xs font-semibold text-slate-200">{researchLabel}</p></div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {MODULES.map(module => {
          const diagnostic = data.diagnostics?.[module.key];
          const tone = diagnosticTone(diagnostic);
          return <div key={module.key} title={diagnostic?.missing?.join(", ") || diagnostic?.reason || ""} className={`rounded-lg border px-2.5 py-2 ${qualityClasses(tone)}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-semibold">{lang === "pt" ? module.pt : module.en}</span>{tone === "good" ? <CheckCircle2 className="h-3 w-3" /> : tone === "bad" ? <CircleAlert className="h-3 w-3" /> : <Info className="h-3 w-3" />}</div><p className="mt-1 text-[8px] opacity-75">{diagnosticLabel(diagnostic, lang)}</p></div>;
        })}
      </div>
      <p className="mt-3 text-[10px] text-slate-600">{c.diagnosticHint}</p>
    </div>
  );
}

export default function DashboardV2({ data, lang }: { data: FilingAnalysis; lang: Lang }) {
  const [tab, setTab] = useState<Tab>("overview");
  const c = COPY[lang];
  const f = data.financials;
  const annual = f.annualHistory;
  const chartYears = annual?.years?.length ? annual.years : f.years;
  const chartRevenue = annual?.years?.length ? annual.revenue : f.revenue;
  const chartNetIncome = annual?.years?.length ? annual.netIncome : f.netIncome;
  const competitive = data.market.competitiveAnalysis;
  const marketShares = data.market.marketShares ?? [];

  const financialOption = useMemo<EChartsOption>(() => ({
    color: [filingLensTheme.chart.blue, filingLensTheme.chart.green],
    tooltip: { trigger: "axis", backgroundColor: "#0f172a", borderColor: "#334155", textStyle: { color: "#e2e8f0" } },
    legend: { top: 4, right: 8, textStyle: { color: filingLensTheme.chart.axis } },
    grid: { left: 55, right: 20, top: 45, bottom: 35, containLabel: true },
    xAxis: { type: "category", data: chartYears, axisLabel: { color: filingLensTheme.chart.axis }, axisLine: { lineStyle: { color: "#334155" } } },
    yAxis: { type: "value", axisLabel: { color: filingLensTheme.chart.axis }, splitLine: { lineStyle: { color: filingLensTheme.chart.grid } } },
    series: [
      { name: c.revenue, type: "bar", data: chartRevenue, itemStyle: { borderRadius: [4, 4, 0, 0] }, barMaxWidth: 42 },
      { name: c.netIncome, type: "line", data: chartNetIncome, smooth: true, symbolSize: 7, lineStyle: { width: 3 } },
    ],
  }), [c.netIncome, c.revenue, chartNetIncome, chartRevenue, chartYears]);

  const tabs: Array<{ key: Tab; label: string; icon: typeof Activity }> = [
    { key: "overview", label: c.overview, icon: Activity },
    { key: "financials", label: c.financials, icon: BarChart3 },
    { key: "market", label: c.market, icon: Globe2 },
    { key: "risks", label: c.risks, icon: ShieldAlert },
    { key: "events", label: c.events, icon: CalendarDays },
    { key: "quality", label: c.quality, icon: Gauge },
  ];

  const latestPeriod = f.years.at(-1) ?? data.metadata.reportingPeriod ?? data.company.periodEnd ?? "—";
  const fallbackKpis = [
    { label: c.revenue, value: amount(latest(f.revenue), data, lang), detail: latestPeriod, source: "" },
    { label: c.netIncome, value: amount(latest(f.netIncome), data, lang), detail: latestPeriod, source: "" },
    { label: c.grossMargin, value: percent(latest(f.grossMargin), lang), detail: latestPeriod, source: "" },
    { label: c.operatingMargin, value: percent(latest(f.operatingMargin), lang), detail: latestPeriod, source: "" },
  ];
  const kpis = data.kpis.length
    ? data.kpis.slice(0, 8).map(kpi => ({ label: kpi.label, value: kpi.value, detail: kpi.delta ?? c.latest, source: sourceText(kpi.source, lang) }))
    : fallbackKpis;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0a111f]/95 shadow-2xl shadow-slate-950/25">
      <header className="border-b border-slate-800 bg-gradient-to-r from-[#111c30] via-[#0d1627] to-[#0b1b2a] px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-cyan-500/25 bg-cyan-400/10"><Building2 className="h-5 w-5 text-cyan-300" /></div>
            <div><p className={filingLensTheme.label}>{c.analysis}</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">{data.company.name}</h2><p className="mt-1 text-xs text-slate-400">{[data.company.ticker, data.company.exchange, data.company.filingType].filter(Boolean).join(" · ")}</p></div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right">
            <div><p className="text-[9px] uppercase tracking-wide text-slate-600">{c.period}</p><p className="mt-1 text-[11px] font-medium text-slate-300">{data.metadata.reportingPeriod || data.company.periodEnd || "—"}</p></div>
            <div><p className="text-[9px] uppercase tracking-wide text-slate-600">{c.filed}</p><p className="mt-1 text-[11px] font-medium text-slate-300">{data.metadata.filedAt || data.company.filedAt || "—"}</p></div>
            <div><p className="text-[9px] uppercase tracking-wide text-slate-600">{c.jurisdiction}</p><p className="mt-1 text-[11px] font-medium text-slate-300">{data.jurisdiction === "br" ? "CVM / BR" : "SEC / US"}</p></div>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6"><CoverageCard data={data} lang={lang} /></div>

      <nav className="mx-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40 p-1 sm:mx-6" aria-label="Dashboard sections">
        {tabs.map(item => {
          const Icon = item.icon;
          const active = tab === item.key;
          return <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`inline-flex min-w-fit items-center gap-2 rounded-lg px-3.5 py-2 text-[11px] font-semibold transition ${active ? "bg-slate-800 text-white shadow" : "text-slate-500 hover:bg-slate-900 hover:text-slate-200"}`}><Icon className={`h-3.5 w-3.5 ${active ? "text-cyan-300" : ""}`} />{item.label}</button>;
        })}
      </nav>

      <div className="p-4 sm:p-6">
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
              <div className={`${filingLensTheme.surfaceRaised} rounded-2xl p-5`}>
                <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-emerald-300" /><h3 className="text-sm font-semibold text-white">{c.executive}</h3></div>
                {data.summary.length ? <div className="mt-4 space-y-3">{data.summary.slice(0, 6).map((item, index) => <div key={index} className="flex gap-3"><span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-cyan-500/30 bg-cyan-400/10 text-[9px] font-semibold text-cyan-200">{index + 1}</span><p className="text-sm leading-6 text-slate-300">{item}</p></div>)}</div> : <EmptyState icon={Info} title={c.executive} text={c.noConfidence} />}
              </div>
              <div className={`${filingLensTheme.surface} rounded-2xl p-5`}>
                <p className={filingLensTheme.label}>{c.industry}</p>
                <p className="mt-2 text-lg font-semibold text-white">{data.market.industry || "—"}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">{data.company.description || (lang === "pt" ? "Descrição completa do negócio não repetida neste documento." : "Full business description was not repeated in this filing.")}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{kpis.slice(0, 8).map((kpi, index) => <KpiCard key={`${kpi.label}-${index}`} {...kpi} />)}</div>
          </div>
        )}

        {tab === "financials" && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label={c.revenue} value={amount(latest(f.revenue), data, lang)} detail={latestPeriod} />
              <KpiCard label={c.netIncome} value={amount(latest(f.netIncome), data, lang)} detail={latestPeriod} />
              <KpiCard label={c.opCash} value={amount(latest(f.operatingCashFlow), data, lang)} detail={latestPeriod} />
              <KpiCard label={c.debt} value={amount(latest(f.totalDebt), data, lang)} detail={latestPeriod} />
              <KpiCard label={c.cash} value={amount(latest(f.cash), data, lang)} detail={latestPeriod} />
            </div>
            {chartYears.length && (chartRevenue.length || chartNetIncome.length) ? <div className={`${filingLensTheme.surfaceRaised} rounded-2xl p-4 sm:p-5`}><div className="mb-2 flex flex-wrap items-center justify-between gap-3"><div><p className={filingLensTheme.label}>{annual?.years?.length ? c.annualHistory : c.trend}</p><p className="mt-1 text-xs text-slate-500">{annual?.unit ?? f.unit}</p></div><div className="flex items-center gap-2"><Database className="h-4 w-4 text-slate-600" />{annual?.provider && <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[9px] font-semibold text-emerald-200">{c.annualHistorySource} · {annual.provider}</span>}</div></div><Chart option={financialOption} label={annual?.years?.length ? c.annualHistory : c.trend} /></div> : <EmptyState icon={BarChart3} title={c.financials} text={c.noFinancial} />}
            {(f.forwardGuidance?.length ?? 0) > 0 && <div className={`${filingLensTheme.surface} rounded-2xl p-5`}><p className={filingLensTheme.label}>{lang === "pt" ? "Guidance divulgado" : "Disclosed guidance"}</p><div className="mt-3 grid gap-2 md:grid-cols-2">{f.forwardGuidance!.slice(0, 8).map((item, index) => <div key={index} className={`${filingLensTheme.inset} rounded-lg p-3`}><p className="text-xs font-semibold text-slate-200">{item.metric} · {item.period}</p><p className="mt-1 text-xs text-cyan-300">{item.range}</p><p className="mt-2 text-[9px] text-slate-600">{sourceText(item.source, lang)}</p></div>)}</div></div>}
          </div>
        )}

        {tab === "market" && (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className={`${filingLensTheme.surfaceRaised} rounded-2xl p-5`}><Globe2 className="h-4 w-4 text-cyan-300" /><p className={`mt-3 ${filingLensTheme.label}`}>{c.industry}</p><p className="mt-2 text-lg font-semibold text-white">{data.market.industry || "—"}</p><p className={`mt-5 ${filingLensTheme.label}`}>{c.peers}</p>{data.market.competitors.length ? <div className="mt-3 flex flex-wrap gap-2">{data.market.competitors.map(peer => { const evidence = data.market.peerEvidence?.find(item => item.name.toLowerCase() === peer.toLowerCase()); return <span key={peer} title={sourceText(evidence?.source, lang)} className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${evidence?.sourceType === "external" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-blue-500/30 bg-blue-500/10 text-blue-200"}`}>{evidence?.sourceType === "external" ? c.external : c.filing} · {peer}</span>; })}</div> : <p className="mt-3 text-xs leading-5 text-slate-500">{c.noPeers}</p>}</div>
              <div className={`${filingLensTheme.surface} rounded-2xl p-5`}><Landmark className="h-4 w-4 text-blue-300" /><p className={`mt-3 ${filingLensTheme.label}`}>{c.segments}</p>{data.market.segments.length ? <div className="mt-3 space-y-2">{data.market.segments.slice(0, 8).map(segment => <div key={segment.name} className={`${filingLensTheme.inset} rounded-lg p-3`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-200">{segment.name}</p><p className="text-[11px] text-blue-200">{amount(latest(segment.revenue), data, lang)}</p></div>{segment.periods?.length ? <p className="mt-1 text-[9px] text-slate-600">{segment.periods.at(-1)}</p> : null}</div>)}</div> : <p className="mt-3 text-xs text-slate-500">{c.noSegments}</p>}</div>
              <div className={`${filingLensTheme.surface} rounded-2xl p-5`}><Building2 className="h-4 w-4 text-violet-300" /><p className={`mt-3 ${filingLensTheme.label}`}>{c.geographies}</p>{data.market.geographies.length ? <div className="mt-3 space-y-2">{data.market.geographies.slice(0, 8).map(geo => <div key={geo.name} className={`${filingLensTheme.inset} rounded-lg p-3`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-200">{geo.name}</p><p className="text-[11px] text-violet-200">{amount(latest(geo.values), data, lang)}</p></div></div>)}</div> : <p className="mt-3 text-xs text-slate-500">{c.noGeographies}</p>}</div>
            </div>
            {marketShares.length > 0 && <div className={`${filingLensTheme.surfaceRaised} rounded-2xl p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className={filingLensTheme.label}>{c.marketShare}</p><p className="mt-1 text-xs text-slate-500">{c.marketShareBasis}</p></div><Gauge className="h-4 w-4 text-emerald-300" /></div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{marketShares.slice(0, 6).map((share, index) => <article key={`${share.label}-${index}`} className={`${filingLensTheme.inset} rounded-xl p-4`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold leading-5 text-slate-200">{share.label}</p><p className="mt-1 text-[9px] uppercase tracking-wide text-slate-600">{share.period} · {share.geography}</p></div><span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-sm font-bold text-emerald-200">{percent(share.valuePercent, lang)}</span></div><p className="mt-3 text-[10px] leading-5 text-slate-400">{formatFilingNumber(share.numerator, lang === "pt" ? "pt-BR" : "en-US", 1)} / {formatFilingNumber(share.denominator, lang === "pt" ? "pt-BR" : "en-US", 1)} {share.unit}</p><p className="mt-1 text-[10px] text-cyan-300">{share.productScope}</p><p className="mt-2 text-[9px] text-slate-600">{share.provider} · {share.companyMatch}</p>{share.caveat && <p className="mt-2 text-[9px] leading-4 text-amber-300/70">{share.caveat}</p>}<p className="mt-3 border-t border-slate-800 pt-2 text-[9px] text-slate-600">{sourceText(share.source, lang)}</p></article>)}</div>
            </div>}
            <div className={`${filingLensTheme.surfaceRaised} rounded-2xl p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className={filingLensTheme.label}>{c.competitiveAnalysis}</p><p className="mt-1 text-xs text-slate-500">market-research-brief · cited external research · filing facts remain primary</p></div>{competitive?.status && <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase text-cyan-200">{competitive.status.replaceAll("_", " ")}</span>}</div>
              {competitive && (competitive.peerProfiles.length || competitive.findings.length || competitive.marketStructure) ? <div className="mt-4 space-y-4">
                {competitive.marketStructure && <div className={`${filingLensTheme.inset} rounded-xl p-4`}><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-600">{lang === "pt" ? "Estrutura do mercado" : "Market structure"}</p><p className="mt-2 text-sm leading-6 text-slate-300">{competitive.marketStructure.summary}</p>{competitive.marketStructure.hhi != null && <p className="mt-2 text-xs font-semibold text-cyan-200">HHI: {formatFilingNumber(competitive.marketStructure.hhi, lang === "pt" ? "pt-BR" : "en-US", 0)}</p>}<p className="mt-2 text-[9px] text-slate-600">{sourceText(competitive.marketStructure.source, lang)}</p></div>}
                <div className="grid gap-3 lg:grid-cols-2">{competitive.peerProfiles.slice(0, 8).map(peer => <article key={peer.name} className={`${filingLensTheme.inset} rounded-xl p-4`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-100">{peer.name}</p><p className="mt-1 text-[10px] text-cyan-300">{peer.relationship}</p></div><span className="rounded-full bg-amber-500/10 px-2 py-1 text-[8px] font-semibold uppercase text-amber-200">{c.external}</span></div><p className="mt-3 text-xs leading-5 text-slate-400">{peer.positioning}</p>{peer.strengths.length > 0 && <p className="mt-3 text-[10px] leading-5 text-emerald-300/80">+ {peer.strengths.join(" · ")}</p>}{peer.vulnerabilities.length > 0 && <p className="mt-1 text-[10px] leading-5 text-amber-300/80">△ {peer.vulnerabilities.join(" · ")}</p>}<p className="mt-3 border-t border-slate-800 pt-2 text-[9px] text-slate-600">{sourceText(peer.source, lang)}</p></article>)}</div>
                {competitive.findings.length > 0 && <div><p className={filingLensTheme.label}>{c.competitiveFindings}</p><div className="mt-3 grid gap-2 md:grid-cols-2">{competitive.findings.slice(0, 8).map((finding, index) => <div key={index} className={`${filingLensTheme.inset} rounded-lg p-3`}><p className="text-xs font-semibold leading-5 text-slate-200">{finding.insight}</p><p className="mt-2 text-[10px] leading-5 text-slate-500">{finding.implication}</p><p className="mt-2 text-[9px] text-slate-600">{sourceText(finding.source, lang)}</p></div>)}</div></div>}
              </div> : <p className="mt-4 text-xs leading-5 text-slate-500">{c.noCompetitive}</p>}
            </div>
          </div>
        )}

        {tab === "risks" && (
          data.risks.length ? <div><div className="mb-4 flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-300" /><h3 className="text-sm font-semibold text-white">{c.riskTitle}</h3></div><div className="grid gap-3 lg:grid-cols-2">{data.risks.slice().sort((a, b) => (a.materialityRank ?? 999) - (b.materialityRank ?? 999) || b.severity - a.severity).slice(0, 10).map((risk, index) => <article key={`${risk.title}-${index}`} className={`${filingLensTheme.surface} rounded-xl p-4`}><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-600">#{index + 1} · {risk.category}</p><h4 className="mt-1 text-sm font-semibold text-slate-100">{risk.title}</h4></div><span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${risk.severity >= 4 ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : risk.severity === 3 ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-blue-500/30 bg-blue-500/10 text-blue-200"}`}>{risk.severity}/5</span></div><p className="mt-3 text-xs leading-5 text-slate-400">{risk.summary}</p>{risk.source && <p className="mt-3 border-t border-slate-800 pt-2 text-[9px] text-slate-600">{c.source}: {sourceText(risk.source, lang)}</p>}</article>)}</div></div> : <EmptyState icon={ShieldAlert} title={c.riskTitle} text={c.noRisks} />
        )}

        {tab === "events" && (
          data.events.length || data.timeline.length ? <div><div className="mb-4 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold text-white">{c.timeline}</h3></div><div className="relative ml-3 border-l border-slate-700 pl-6">{(data.events.length ? data.events.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map(event => ({ date: event.date, title: event.title, detail: event.impact ?? event.category, external: event.sourceType === "external", source: event.source })) : data.timeline.slice(-12).reverse().map(item => ({ date: item.year, title: item.title, detail: item.detail, external: item.sourceType === "external", source: item.source }))).map((event, index) => <div key={`${event.date}-${index}`} className="relative pb-5"><span className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-[#0a111f] ${event.external ? "bg-amber-400" : "bg-cyan-400"}`} /><div className={`${filingLensTheme.surface} rounded-xl p-4`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-100">{event.title}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${event.external ? "bg-amber-500/10 text-amber-200" : "bg-cyan-500/10 text-cyan-200"}`}>{event.date} · {event.external ? c.external : c.filing}</span></div><p className="mt-2 text-xs leading-5 text-slate-400">{event.detail}</p>{event.source && <p className="mt-2 text-[9px] text-slate-600">{sourceText(event.source, lang)}</p>}</div></div>)}</div></div> : <EmptyState icon={CalendarDays} title={c.timeline} text={c.noEvents} />
        )}

        {tab === "quality" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${filingLensTheme.surfaceRaised} rounded-2xl p-5 lg:col-span-2`}><div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-emerald-300" /><h3 className="text-sm font-semibold text-white">{c.moduleCoverage}</h3></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{MODULES.map(module => { const d = data.diagnostics?.[module.key]; return <div key={module.key} className={`${filingLensTheme.inset} rounded-lg p-3`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-200">{lang === "pt" ? module.pt : module.en}</p><span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase ${qualityClasses(diagnosticTone(d))}`}>{diagnosticLabel(d, lang)}</span></div>{reasonText(d) && <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{reasonText(d)}</p>}{d?.missing?.length ? <p className="mt-2 text-[9px] leading-relaxed text-amber-300/70">{d.missing.join(" · ")}</p> : null}</div>; })}</div></div>
            <div className={`${filingLensTheme.surface} rounded-2xl p-5`}><p className={filingLensTheme.label}>{c.missingInventory}</p>{data.missingData.length ? <ul className="mt-3 space-y-2">{data.missingData.slice(0, 16).map((item, index) => <li key={index} className="flex gap-2 text-xs leading-5 text-slate-400"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />{item}</li>)}</ul> : <p className="mt-3 text-xs text-slate-500">{c.noGaps}</p>}</div>
            <div className={`${filingLensTheme.surface} rounded-2xl p-5`}><p className={filingLensTheme.label}>{c.confidence}</p>{data.confidenceNotes.length ? <div className="mt-3 space-y-2">{data.confidenceNotes.slice(0, 10).map((note, index) => <div key={index} className={`${filingLensTheme.inset} rounded-lg p-3`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-200">{note.claim}</p><span className={`rounded-full px-2 py-0.5 text-[8px] font-semibold uppercase ${note.confidence === "high" ? "bg-emerald-500/10 text-emerald-200" : note.confidence === "medium" ? "bg-amber-500/10 text-amber-200" : "bg-rose-500/10 text-rose-200"}`}>{note.confidence}</span></div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{note.reason}</p></div>)}</div> : <p className="mt-3 text-xs text-slate-500">{c.noConfidence}</p>}</div>
            <div className={`${filingLensTheme.surface} rounded-2xl p-5 lg:col-span-2`}><div className="flex gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-blue-500/25 bg-blue-500/10"><FileCheck2 className="h-4 w-4 text-blue-300" /></div><div><p className="text-xs font-semibold text-slate-200">{c.evidence}</p><p className="mt-1 text-xs leading-5 text-slate-500">{c.evidenceText}</p></div></div></div>
          </div>
        )}
      </div>
    </section>
  );
}
