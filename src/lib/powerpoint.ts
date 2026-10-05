import type { EvidenceReference, FilingAnalysis } from "@contracts/analysis";

export type PresentationLanguage = "en" | "pt";

const EMU = 914400;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const BG = "0B1020";
const PANEL = "121A2E";
const PANEL_2 = "17233D";
const BORDER = "2A3A5B";
const WHITE = "F8FAFC";
const MUTED = "A9B7CF";
const BLUE = "3B82F6";
const CYAN = "22D3EE";
const GREEN = "34D399";
const AMBER = "FBBF24";
const RED = "FB7185";
const VIOLET = "A78BFA";

const C = {
  en: {
    deck: "Company informational analysis",
    prepared: "Prepared from the uploaded regulatory filing and validated analysis outputs",
    overview: "Executive overview",
    financials: "Financial performance",
    cashDebt: "Cash flow & balance sheet",
    market: "Market position & peer landscape",
    risks: "Principal risk factors",
    timeline: "Timeline & material events",
    outlook: "Outlook, data quality & analysis controls",
    sources: "Sources, provenance & methodology",
    latest: "Latest reported",
    revenue: "Revenue",
    netIncome: "Net income",
    ebitda: "EBITDA",
    debt: "Total debt",
    cash: "Cash",
    ocf: "Operating cash flow",
    fcf: "Free cash flow",
    filing: "Filing",
    web: "Cited web research",
    peers: "Peers",
    segments: "Operating segments",
    geographies: "Geographies",
    severity: "Severity",
    guidance: "Forward guidance / disclosed outlook",
    gaps: "Data gaps",
    diagnostics: "Analysis modules",
    complete: "Complete",
    incomplete: "Incomplete",
    failed: "Failed",
    notApplicable: "N/A",
    noGuidance: "No explicit forward guidance was captured from the filing.",
    noGaps: "No material missing-data items were reported by the analysis pipeline.",
    methodology: "Methodology",
    methodText: "Filing-first extraction and validation. Web research is limited to independently cited peer identification when the filing does not name competitors. External sources do not overwrite filing-derived financial facts.",
    disclaimer: "Informational use only. Not investment advice. Verify material facts and figures against the original regulatory filing before consequential use.",
    sourceFooter: "Source: regulatory filing; external web sources only where explicitly labeled.",
    noData: "Not available in the analyzed filing",
    period: "Reporting period",
    filed: "Filed",
    jurisdiction: "Jurisdiction",
    webStatus: "Web research status",
    researchComplete: "Citation-backed peer research completed",
    researchNotNeeded: "Not needed — filing contained supported peer evidence",
    researchUnavailable: "Web research unavailable or returned no citable peers",
  },
  pt: {
    deck: "Análise informacional da companhia",
    prepared: "Preparado a partir do documento regulatório enviado e dos resultados validados da análise",
    overview: "Visão executiva",
    financials: "Desempenho financeiro",
    cashDebt: "Fluxo de caixa e balanço patrimonial",
    market: "Posicionamento de mercado e concorrentes",
    risks: "Principais fatores de risco",
    timeline: "Linha do tempo e eventos materiais",
    outlook: "Perspectivas, qualidade dos dados e controles",
    sources: "Fontes, proveniência e metodologia",
    latest: "Último período reportado",
    revenue: "Receita",
    netIncome: "Lucro líquido",
    ebitda: "EBITDA",
    debt: "Dívida total",
    cash: "Caixa",
    ocf: "Fluxo de caixa operacional",
    fcf: "Fluxo de caixa livre",
    filing: "Documento",
    web: "Pesquisa web citada",
    peers: "Concorrentes",
    segments: "Segmentos operacionais",
    geographies: "Geografias",
    severity: "Severidade",
    guidance: "Guidance / perspectivas divulgadas",
    gaps: "Lacunas de dados",
    diagnostics: "Módulos da análise",
    complete: "Completo",
    incomplete: "Incompleto",
    failed: "Falhou",
    notApplicable: "N/A",
    noGuidance: "Nenhum guidance explícito foi capturado do documento.",
    noGaps: "Nenhuma lacuna material de dados foi reportada pelo pipeline de análise.",
    methodology: "Metodologia",
    methodText: "Extração e validação priorizando o documento regulatório. A pesquisa web é limitada à identificação de concorrentes com citações independentes quando o documento não os nomeia. Fontes externas não substituem fatos financeiros extraídos do documento.",
    disclaimer: "Uso exclusivamente informacional. Não constitui recomendação de investimento. Verifique fatos e números materiais no documento regulatório original antes de uso consequencial.",
    sourceFooter: "Fonte: documento regulatório; fontes web externas somente quando explicitamente identificadas.",
    noData: "Não disponível no documento analisado",
    period: "Período reportado",
    filed: "Protocolado em",
    jurisdiction: "Jurisdição",
    webStatus: "Status da pesquisa web",
    researchComplete: "Pesquisa de concorrentes com citações concluída",
    researchNotNeeded: "Não necessária — o documento continha evidência suportada de concorrentes",
    researchUnavailable: "Pesquisa web indisponível ou sem concorrentes citáveis",
  },
} as const;

type SlideShape = string;

type TextOpts = {
  fontSize?: number;
  color?: string;
  bold?: boolean;
  align?: "l" | "ctr" | "r";
  valign?: "t" | "ctr" | "b";
  fill?: string | null;
  line?: string | null;
  radius?: boolean;
  margin?: number;
  fontFace?: string;
};

function emu(value: number): number {
  return Math.round(value * EMU);
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clampText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function number(value: number | null | undefined, lang: PresentationLanguage, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(lang === "pt" ? "pt-BR" : "en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.abs(value) < 10 && value % 1 !== 0 ? 1 : 0,
  }).format(value);
}

function latest(values: Array<number | null | undefined> | null | undefined): number | null {
  if (!values?.length) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}

function sanitizeFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "company";
}

function colorFill(hex: string | null | undefined): string {
  return hex ? `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>` : "<a:noFill/>";
}

function lineFill(hex: string | null | undefined, width = 1): string {
  return hex
    ? `<a:ln w="${Math.max(1, Math.round(width * 12700))}"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
}

function paragraphXml(text: string, opts: TextOpts): string {
  const size = Math.round((opts.fontSize ?? 16) * 100);
  const align = opts.align ?? "l";
  const color = opts.color ?? WHITE;
  const face = escapeXml(opts.fontFace ?? "Arial");
  return `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${size}"${opts.bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${face}"/><a:ea typeface="${face}"/><a:cs typeface="${face}"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${size}"/></a:p>`;
}

function shape(
  id: number,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  text = "",
  opts: TextOpts = {},
): SlideShape {
  const margin = emu(opts.margin ?? 0.08);
  const geometry = opts.radius ? "roundRect" : "rect";
  const textXml = text
    ? `<p:txBody><a:bodyPr wrap="square" lIns="${margin}" rIns="${margin}" tIns="${margin}" bIns="${margin}" anchor="${opts.valign ?? "t"}"><a:normAutofit fontScale="95000" lnSpcReduction="10000"/></a:bodyPr><a:lstStyle/>${text.split("\n").map(line => paragraphXml(line, opts)).join("")}</p:txBody>`
    : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr${text ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${colorFill(opts.fill)}${lineFill(opts.line)}</p:spPr>${textXml}</p:sp>`;
}

function title(shapes: SlideShape[], id: { value: number }, heading: string, kicker?: string) {
  shapes.push(shape(id.value++, "Top accent", 0, 0, SLIDE_W, 0.07, "", { fill: CYAN }));
  if (kicker) shapes.push(shape(id.value++, "Kicker", 0.65, 0.35, 12, 0.28, kicker.toUpperCase(), { fontSize: 9, color: CYAN, bold: true }));
  shapes.push(shape(id.value++, "Slide title", 0.65, 0.67, 12, 0.58, heading, { fontSize: 26, color: WHITE, bold: true }));
}

function footer(shapes: SlideShape[], id: { value: number }, text: string, page: number) {
  shapes.push(shape(id.value++, "Footer line", 0.65, 7.06, 12.03, 0.01, "", { fill: BORDER }));
  shapes.push(shape(id.value++, "Footer source", 0.65, 7.1, 10.9, 0.2, clampText(text, 150), { fontSize: 7.5, color: MUTED }));
  shapes.push(shape(id.value++, "Page number", 11.8, 7.1, 0.85, 0.2, String(page), { fontSize: 7.5, color: MUTED, align: "r" }));
}

function panel(shapes: SlideShape[], id: { value: number }, x: number, y: number, w: number, h: number) {
  shapes.push(shape(id.value++, "Panel", x, y, w, h, "", { fill: PANEL, line: BORDER, radius: true }));
}

function metricCard(
  shapes: SlideShape[], id: { value: number }, x: number, y: number, w: number,
  label: string, value: string, detail: string, accent = BLUE,
) {
  panel(shapes, id, x, y, w, 1.08);
  shapes.push(shape(id.value++, `${label} accent`, x, y, 0.06, 1.08, "", { fill: accent }));
  shapes.push(shape(id.value++, `${label} label`, x + 0.18, y + 0.14, w - 0.35, 0.2, label.toUpperCase(), { fontSize: 8.5, color: MUTED, bold: true }));
  shapes.push(shape(id.value++, `${label} value`, x + 0.18, y + 0.38, w - 0.35, 0.34, value, { fontSize: 20, color: WHITE, bold: true }));
  shapes.push(shape(id.value++, `${label} detail`, x + 0.18, y + 0.76, w - 0.35, 0.18, detail, { fontSize: 7.7, color: MUTED }));
}

function bulletList(
  shapes: SlideShape[], id: { value: number }, items: string[], x: number, y: number, w: number,
  max = 5, fontSize = 13, accent = CYAN,
) {
  items.slice(0, max).forEach((item, index) => {
    const top = y + index * 0.62;
    shapes.push(shape(id.value++, `Bullet ${index + 1}`, x, top + 0.08, 0.09, 0.09, "", { fill: accent, radius: true }));
    shapes.push(shape(id.value++, `Bullet text ${index + 1}`, x + 0.2, top, w - 0.2, 0.52, clampText(item, 190), { fontSize, color: WHITE }));
  });
}

function barChart(
  shapes: SlideShape[], id: { value: number }, x: number, y: number, w: number, h: number,
  heading: string, periods: string[], values: Array<number | null | undefined>, lang: PresentationLanguage, accent: string,
) {
  panel(shapes, id, x, y, w, h);
  shapes.push(shape(id.value++, `${heading} heading`, x + 0.22, y + 0.16, w - 0.44, 0.28, heading, { fontSize: 12, color: WHITE, bold: true }));
  const clean = periods.map((period, index) => ({ period, value: values[index] ?? null })).filter(item => item.value !== null && Number.isFinite(item.value));
  if (!clean.length) {
    shapes.push(shape(id.value++, `${heading} empty`, x + 0.22, y + 0.85, w - 0.44, 0.35, C[lang].noData, { fontSize: 10, color: MUTED, align: "ctr" }));
    return;
  }
  const maxAbs = Math.max(...clean.map(item => Math.abs(item.value as number)), 1);
  const chartY = y + 0.72;
  const chartH = h - 1.25;
  const slot = (w - 0.6) / clean.length;
  clean.forEach((item, index) => {
    const value = item.value as number;
    const ratio = Math.max(0.04, Math.abs(value) / maxAbs);
    const bh = chartH * ratio;
    const bx = x + 0.32 + index * slot + slot * 0.19;
    const bw = slot * 0.62;
    const by = chartY + chartH - bh;
    shapes.push(shape(id.value++, `${heading} bar ${index}`, bx, by, bw, bh, "", { fill: value >= 0 ? accent : RED, radius: true }));
    shapes.push(shape(id.value++, `${heading} value ${index}`, bx - slot * 0.1, Math.max(chartY - 0.03, by - 0.3), bw + slot * 0.2, 0.22, number(value, lang, 1), { fontSize: 7.5, color: WHITE, bold: true, align: "ctr" }));
    shapes.push(shape(id.value++, `${heading} period ${index}`, bx - slot * 0.17, y + h - 0.38, bw + slot * 0.34, 0.2, clampText(item.period, 12), { fontSize: 7.2, color: MUTED, align: "ctr" }));
  });
}

function severityColor(value: number) {
  if (value >= 5) return RED;
  if (value >= 4) return "F97316";
  if (value >= 3) return AMBER;
  if (value >= 2) return BLUE;
  return GREEN;
}

function sourceLabel(source: EvidenceReference, lang: PresentationLanguage): string {
  if (source.kind === "citation" || source.url) {
    const publisher = source.publisher ? `${source.publisher} · ` : "";
    return `${publisher}${source.url ?? source.section}${source.accessed ? ` · ${source.accessed}` : ""}`;
  }
  const parts = [source.sourceForm, source.item, source.section, source.page ? `p. ${source.page}` : null].filter(Boolean);
  return parts.join(" · ") || (lang === "pt" ? "Referência no documento" : "Filing reference");
}

function collectSources(data: FilingAnalysis): EvidenceReference[] {
  const sources: EvidenceReference[] = [];
  const add = (source: EvidenceReference | null | undefined) => { if (source) sources.push(source); };
  data.metadata.sources.forEach(add);
  data.kpis.forEach(item => add(item.source));
  data.market.peerEvidence?.forEach(item => add(item.source));
  data.market.segments.forEach(item => add(item.source));
  data.market.geographies.forEach(item => add(item.source));
  data.risks.forEach(item => add(item.source));
  data.financials.evidence?.forEach(item => add(item.source));
  data.financials.forwardGuidance?.forEach(item => add(item.source));
  data.financials.computed?.forEach(item => item.sources.forEach(add));
  data.timeline.forEach(item => add(item.source));
  data.events.forEach(item => add(item.source));
  data.confidenceNotes.forEach(item => add(item.source));
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = source.url
      ? `url:${source.url}`
      : `filing:${source.sourceForm ?? ""}|${source.item ?? ""}|${source.section}|${source.page ?? ""}|${source.quote?.slice(0, 80) ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceFooter(data: FilingAnalysis, lang: PresentationLanguage): string {
  const c = C[lang];
  const web = data.market.peerEvidence?.some(peer => peer.sourceType === "external");
  return web ? `${c.sourceFooter} ${c.web}: ${data.market.peerEvidence?.filter(peer => peer.sourceType === "external").length ?? 0}.` : c.sourceFooter;
}

function coverSlide(data: FilingAnalysis, lang: PresentationLanguage): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  shapes.push(shape(id.value++, "Background accent", 8.5, -0.4, 5.2, 8.3, "", { fill: "101F3F" }));
  shapes.push(shape(id.value++, "Accent line", 0.75, 1.15, 1.1, 0.08, "", { fill: CYAN }));
  shapes.push(shape(id.value++, "Deck type", 0.75, 1.48, 7.2, 0.35, c.deck.toUpperCase(), { fontSize: 10, color: CYAN, bold: true }));
  shapes.push(shape(id.value++, "Company", 0.75, 1.93, 7.4, 1.15, clampText(data.company.name, 72), { fontSize: 34, color: WHITE, bold: true }));
  const identity = [data.company.ticker, data.company.exchange, data.company.filingType].filter(Boolean).join(" · ");
  shapes.push(shape(id.value++, "Identity", 0.75, 3.23, 7.3, 0.38, identity || data.company.filingType, { fontSize: 13, color: MUTED }));
  shapes.push(shape(id.value++, "Prepared", 0.75, 4.08, 7.15, 0.75, c.prepared, { fontSize: 14, color: WHITE }));
  metricCard(shapes, id, 8.93, 1.45, 3.7, c.period, data.metadata.reportingPeriod || data.company.periodEnd || "—", data.financials.unit, CYAN);
  metricCard(shapes, id, 8.93, 2.75, 3.7, c.jurisdiction, data.jurisdiction === "br" ? "CVM / Brasil" : "SEC / United States", data.metadata.filingType, BLUE);
  metricCard(shapes, id, 8.93, 4.05, 3.7, c.filed, data.metadata.filedAt || data.company.filedAt || "—", data.company.filingReference || "", VIOLET);
  shapes.push(shape(id.value++, "Disclaimer", 0.75, 6.35, 7.4, 0.55, c.disclaimer, { fontSize: 8.5, color: MUTED }));
  return shapes;
}

function overviewSlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.overview, `${data.company.name} · ${data.company.filingType}`);
  panel(shapes, id, 0.65, 1.4, 7.25, 2.0);
  shapes.push(shape(id.value++, "Description label", 0.9, 1.64, 6.75, 0.24, lang === "pt" ? "PERFIL DA COMPANHIA" : "COMPANY PROFILE", { fontSize: 8.5, color: CYAN, bold: true }));
  shapes.push(shape(id.value++, "Description", 0.9, 1.96, 6.72, 1.18, clampText(data.company.description || c.noData, 520), { fontSize: 12.5, color: WHITE }));
  panel(shapes, id, 8.15, 1.4, 4.55, 2.0);
  shapes.push(shape(id.value++, "Summary label", 8.4, 1.64, 4.05, 0.24, lang === "pt" ? "SÍNTESE EXECUTIVA" : "EXECUTIVE TAKEAWAYS", { fontSize: 8.5, color: GREEN, bold: true }));
  bulletList(shapes, id, data.summary.length ? data.summary : [c.noData], 8.4, 1.97, 4.0, 3, 10.4, GREEN);

  const cards = data.kpis.slice(0, 4);
  const fallback = [
    { label: c.revenue, value: number(latest(data.financials.revenue), lang), detail: data.financials.unit },
    { label: c.netIncome, value: number(latest(data.financials.netIncome), lang), detail: data.financials.unit },
  ];
  const metrics = cards.length ? cards.map(kpi => ({ label: kpi.label, value: kpi.value, detail: kpi.delta ?? c.latest })) : fallback;
  for (let i = 0; i < 4; i++) {
    const item = metrics[i];
    const x = 0.65 + i * 3.02;
    metricCard(shapes, id, x, 3.75, 2.78, item?.label ?? "—", item?.value ?? "—", item?.detail ?? c.noData, [BLUE, CYAN, GREEN, VIOLET][i]);
  }
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function financialSlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.financials, `${data.company.name} · ${data.financials.unit}`);
  const f = data.financials;
  const computed = (key: string) => f.computed?.find(item => item.key === key);
  const ebitdaMargin = latest(computed("ebitdaMargin")?.values);
  const growth = latest(computed("revenueGrowth")?.values);
  metricCard(shapes, id, 0.65, 1.35, 2.9, c.revenue, number(latest(f.revenue), lang), growth == null ? f.unit : `${number(growth, lang)}% vs. prior comparable period`, BLUE);
  metricCard(shapes, id, 3.72, 1.35, 2.9, c.netIncome, number(latest(f.netIncome), lang), f.unit, GREEN);
  metricCard(shapes, id, 6.79, 1.35, 2.9, c.ebitda, number(latest(f.ebitda), lang), ebitdaMargin == null ? f.unit : `${number(ebitdaMargin, lang)}% margin`, CYAN);
  const leverage = latest(computed("netDebtToEbitda")?.values);
  metricCard(shapes, id, 9.86, 1.35, 2.84, lang === "pt" ? "Dívida líquida / EBITDA" : "Net debt / EBITDA", leverage == null ? "—" : `${number(leverage, lang, 2)}x`, leverage == null ? c.noData : c.latest, VIOLET);
  barChart(shapes, id, 0.65, 2.75, 5.92, 3.9, c.revenue, f.years, f.revenue, lang, BLUE);
  barChart(shapes, id, 6.78, 2.75, 5.92, 3.9, c.netIncome, f.years, f.netIncome, lang, GREEN);
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function cashDebtSlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.cashDebt, `${data.company.name} · ${data.financials.unit}`);
  const f = data.financials;
  const computed = (key: string) => f.computed?.find(item => item.key === key);
  const fcf = latest(f.freeCashFlow) ?? latest(computed("freeCashFlowCalculated")?.values);
  metricCard(shapes, id, 0.65, 1.35, 2.9, c.ocf, number(latest(f.operatingCashFlow), lang), f.unit, BLUE);
  metricCard(shapes, id, 3.72, 1.35, 2.9, c.fcf, number(fcf, lang), f.unit, CYAN);
  metricCard(shapes, id, 6.79, 1.35, 2.9, c.debt, number(latest(f.totalDebt), lang), f.unit, VIOLET);
  metricCard(shapes, id, 9.86, 1.35, 2.84, c.cash, number(latest(f.cash), lang), f.unit, GREEN);
  barChart(shapes, id, 0.65, 2.75, 5.92, 3.9, c.ocf, f.years, f.operatingCashFlow ?? [], lang, BLUE);
  const debtNet = f.years.map((_, index) => {
    const debt = f.totalDebt?.[index];
    const cash = f.cash?.[index];
    return debt == null ? null : debt - (cash ?? 0);
  });
  barChart(shapes, id, 6.78, 2.75, 5.92, 3.9, lang === "pt" ? "Dívida líquida (proxy)" : "Net debt (proxy)", f.years, debtNet, lang, VIOLET);
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function marketSlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.market, `${data.company.name} · ${data.market.industry || c.noData}`);
  panel(shapes, id, 0.65, 1.4, 4.0, 4.95);
  shapes.push(shape(id.value++, "Industry label", 0.9, 1.68, 3.5, 0.22, lang === "pt" ? "INDÚSTRIA" : "INDUSTRY", { fontSize: 8.5, color: CYAN, bold: true }));
  shapes.push(shape(id.value++, "Industry", 0.9, 2.0, 3.5, 0.52, clampText(data.market.industry || c.noData, 110), { fontSize: 17, color: WHITE, bold: true }));
  shapes.push(shape(id.value++, "Peers label", 0.9, 2.82, 3.5, 0.22, c.peers.toUpperCase(), { fontSize: 8.5, color: GREEN, bold: true }));
  const peers = data.market.competitors.slice(0, 8);
  if (!peers.length) {
    shapes.push(shape(id.value++, "No peers", 0.9, 3.15, 3.5, 0.35, c.noData, { fontSize: 10, color: MUTED }));
  } else {
    peers.forEach((peer, index) => {
      const evidence = data.market.peerEvidence?.find(item => item.name.toLowerCase() === peer.toLowerCase());
      const web = evidence?.sourceType === "external";
      shapes.push(shape(id.value++, `Peer ${index}`, 0.9, 3.13 + index * 0.37, 3.5, 0.29, `${web ? "WEB" : "FILING"} · ${clampText(peer, 36)}`, { fontSize: 8.7, color: web ? AMBER : WHITE, fill: web ? "332A18" : PANEL_2, line: web ? "6B5423" : BORDER, radius: true, valign: "ctr" }));
    });
  }
  const researchStatus = data.market.externalResearchStatus;
  const researchText = researchStatus === "complete" ? c.researchComplete : researchStatus === "not_needed" ? c.researchNotNeeded : c.researchUnavailable;
  shapes.push(shape(id.value++, "Research status", 0.9, 6.02, 3.5, 0.2, `${c.webStatus}: ${researchText}`, { fontSize: 7.2, color: MUTED }));

  panel(shapes, id, 4.9, 1.4, 3.75, 4.95);
  shapes.push(shape(id.value++, "Segments label", 5.15, 1.68, 3.25, 0.22, c.segments.toUpperCase(), { fontSize: 8.5, color: BLUE, bold: true }));
  const segItems = data.market.segments.slice(0, 6).map(segment => {
    const value = latest(segment.revenue);
    return `${segment.name}${value == null ? "" : ` · ${number(value, lang)} ${data.financials.unit}`}`;
  });
  bulletList(shapes, id, segItems.length ? segItems : [c.noData], 5.15, 2.05, 3.15, 6, 9.7, BLUE);

  panel(shapes, id, 8.9, 1.4, 3.8, 4.95);
  shapes.push(shape(id.value++, "Geographies label", 9.15, 1.68, 3.3, 0.22, c.geographies.toUpperCase(), { fontSize: 8.5, color: VIOLET, bold: true }));
  const geoItems = data.market.geographies.slice(0, 6).map(geo => {
    const value = latest(geo.values);
    return `${geo.name}${value == null ? "" : ` · ${number(value, lang)} ${data.financials.unit}`}`;
  });
  bulletList(shapes, id, geoItems.length ? geoItems : [c.noData], 9.15, 2.05, 3.15, 6, 9.7, VIOLET);
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function riskSlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.risks, `${data.company.name} · ${data.risks.length} ${lang === "pt" ? "riscos estruturados" : "structured risks"}`);
  const risks = data.risks.slice().sort((a, b) => (a.materialityRank ?? 999) - (b.materialityRank ?? 999) || b.severity - a.severity).slice(0, 6);
  if (!risks.length) {
    panel(shapes, id, 0.65, 1.6, 12.05, 4.7);
    shapes.push(shape(id.value++, "No risks", 1.0, 3.2, 11.35, 0.5, c.noData, { fontSize: 18, color: MUTED, align: "ctr" }));
  } else {
    risks.forEach((risk, index) => {
      const y = 1.45 + index * 0.83;
      panel(shapes, id, 0.65, y, 12.05, 0.68);
      shapes.push(shape(id.value++, `Risk rank ${index}`, 0.85, y + 0.14, 0.42, 0.36, String(index + 1), { fontSize: 13, color: WHITE, bold: true, fill: severityColor(risk.severity), radius: true, align: "ctr", valign: "ctr" }));
      shapes.push(shape(id.value++, `Risk title ${index}`, 1.45, y + 0.08, 3.1, 0.27, clampText(risk.title, 66), { fontSize: 10.5, color: WHITE, bold: true }));
      shapes.push(shape(id.value++, `Risk category ${index}`, 1.45, y + 0.36, 3.1, 0.18, clampText(risk.category, 42), { fontSize: 7.4, color: MUTED }));
      shapes.push(shape(id.value++, `Risk summary ${index}`, 4.72, y + 0.08, 5.95, 0.46, clampText(risk.summary, 165), { fontSize: 9.1, color: WHITE }));
      shapes.push(shape(id.value++, `Risk severity label ${index}`, 10.9, y + 0.09, 1.45, 0.18, `${c.severity}: ${risk.severity}/5`, { fontSize: 7.4, color: MUTED, align: "r" }));
      for (let s = 0; s < 5; s++) {
        shapes.push(shape(id.value++, `Severity ${index}-${s}`, 10.95 + s * 0.27, y + 0.36, 0.2, 0.12, "", { fill: s < risk.severity ? severityColor(risk.severity) : BORDER, radius: true }));
      }
    });
  }
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function timelineSlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.timeline, `${data.company.name} · ${data.company.filingType}`);
  const events = data.events.length
    ? data.events.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(event => ({ date: event.date, title: event.title, detail: event.impact || event.category, external: event.sourceType === "external" }))
    : data.timeline.slice(-6).reverse().map(event => ({ date: event.year, title: event.title, detail: event.detail, external: event.sourceType === "external" }));
  if (!events.length) {
    panel(shapes, id, 0.65, 1.6, 12.05, 4.7);
    shapes.push(shape(id.value++, "No timeline", 1.0, 3.2, 11.35, 0.5, c.noData, { fontSize: 18, color: MUTED, align: "ctr" }));
  } else {
    shapes.push(shape(id.value++, "Timeline rail", 2.08, 1.65, 0.035, 4.65, "", { fill: BORDER }));
    events.forEach((event, index) => {
      const y = 1.52 + index * 0.82;
      shapes.push(shape(id.value++, `Timeline dot ${index}`, 1.94, y + 0.23, 0.31, 0.31, "", { fill: event.external ? AMBER : CYAN, radius: true }));
      shapes.push(shape(id.value++, `Timeline date ${index}`, 0.72, y + 0.13, 1.05, 0.26, event.date, { fontSize: 10, color: event.external ? AMBER : CYAN, bold: true, align: "r" }));
      panel(shapes, id, 2.52, y, 10.18, 0.63);
      shapes.push(shape(id.value++, `Timeline title ${index}`, 2.78, y + 0.09, 3.25, 0.22, clampText(event.title, 70), { fontSize: 10.5, color: WHITE, bold: true }));
      shapes.push(shape(id.value++, `Timeline detail ${index}`, 6.12, y + 0.08, 6.25, 0.4, clampText(event.detail || c.noData, 180), { fontSize: 8.8, color: MUTED }));
    });
  }
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function qualitySlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.outlook, `${data.company.name} · ${data.metadata.filingType}`);
  panel(shapes, id, 0.65, 1.4, 6.0, 4.95);
  shapes.push(shape(id.value++, "Guidance label", 0.92, 1.7, 5.45, 0.24, c.guidance.toUpperCase(), { fontSize: 8.5, color: GREEN, bold: true }));
  const guidance = data.financials.forwardGuidance?.slice(0, 5).map(item => `${item.metric} · ${item.period} · ${item.range}`) ?? [];
  bulletList(shapes, id, guidance.length ? guidance : [c.noGuidance], 0.92, 2.08, 5.45, 5, 10.2, GREEN);
  shapes.push(shape(id.value++, "Gaps label", 0.92, 5.15, 5.45, 0.22, c.gaps.toUpperCase(), { fontSize: 8.5, color: AMBER, bold: true }));
  shapes.push(shape(id.value++, "Gaps", 0.92, 5.47, 5.45, 0.58, clampText(data.missingData.length ? data.missingData.slice(0, 5).join(" · ") : c.noGaps, 240), { fontSize: 8.8, color: MUTED }));

  panel(shapes, id, 6.9, 1.4, 5.8, 4.95);
  shapes.push(shape(id.value++, "Diagnostics label", 7.18, 1.7, 5.2, 0.24, c.diagnostics.toUpperCase(), { fontSize: 8.5, color: BLUE, bold: true }));
  const labels: Array<[string, string]> = [
    ["metadata", lang === "pt" ? "Metadados" : "Metadata"],
    ["profiler", lang === "pt" ? "Perfil" : "Company profile"],
    ["market", lang === "pt" ? "Mercado" : "Market"],
    ["risks", lang === "pt" ? "Riscos" : "Risks"],
    ["financials", lang === "pt" ? "Financeiro" : "Financials"],
    ["historian", lang === "pt" ? "Histórico" : "Timeline"],
    ["synthesizer", lang === "pt" ? "Síntese" : "Synthesis"],
  ];
  labels.forEach(([key, label], index) => {
    const status = data.diagnostics?.[key as keyof typeof data.diagnostics]?.status ?? "incomplete";
    const localized = status === "complete" ? c.complete : status === "failed" ? c.failed : status === "not_applicable" ? c.notApplicable : c.incomplete;
    const statusColor = status === "complete" ? GREEN : status === "failed" ? RED : status === "not_applicable" ? MUTED : AMBER;
    const y = 2.13 + index * 0.48;
    shapes.push(shape(id.value++, `Diagnostic ${index}`, 7.18, y, 3.45, 0.3, label, { fontSize: 9.5, color: WHITE }));
    shapes.push(shape(id.value++, `Diagnostic status ${index}`, 10.75, y, 1.55, 0.3, localized.toUpperCase(), { fontSize: 7.8, color: statusColor, bold: true, align: "r" }));
  });
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function sourcesSlide(data: FilingAnalysis, lang: PresentationLanguage, page: number): string[] {
  const c = C[lang];
  const shapes: SlideShape[] = [];
  const id = { value: 2 };
  title(shapes, id, c.sources, `${data.company.name} · ${data.metadata.filingType}`);
  panel(shapes, id, 0.65, 1.4, 7.55, 4.95);
  shapes.push(shape(id.value++, "Sources label", 0.92, 1.68, 7.0, 0.24, (lang === "pt" ? "FONTES UTILIZADAS" : "EVIDENCE SOURCES").toUpperCase(), { fontSize: 8.5, color: CYAN, bold: true }));
  const sources = collectSources(data).slice(0, 10);
  const sourceLines = sources.length ? sources.map((source, index) => `${index + 1}. ${sourceLabel(source, lang)}`) : [c.noData];
  sourceLines.forEach((line, index) => {
    shapes.push(shape(id.value++, `Source ${index}`, 0.92, 2.03 + index * 0.39, 6.96, 0.32, clampText(line, 135), { fontSize: 8.3, color: line.includes("http") ? AMBER : WHITE }));
  });

  panel(shapes, id, 8.45, 1.4, 4.25, 4.95);
  shapes.push(shape(id.value++, "Method label", 8.72, 1.68, 3.7, 0.24, c.methodology.toUpperCase(), { fontSize: 8.5, color: GREEN, bold: true }));
  shapes.push(shape(id.value++, "Method text", 8.72, 2.06, 3.7, 1.65, c.methodText, { fontSize: 10.5, color: WHITE }));
  shapes.push(shape(id.value++, "Divider", 8.72, 3.93, 3.7, 0.015, "", { fill: BORDER }));
  shapes.push(shape(id.value++, "Disclaimer label", 8.72, 4.2, 3.7, 0.22, (lang === "pt" ? "LIMITAÇÕES" : "LIMITATIONS").toUpperCase(), { fontSize: 8.5, color: AMBER, bold: true }));
  shapes.push(shape(id.value++, "Disclaimer", 8.72, 4.57, 3.7, 1.12, c.disclaimer, { fontSize: 9.5, color: MUTED }));
  footer(shapes, id, sourceFooter(data, lang), page);
  return shapes;
}

function groupBase(): string {
  return `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
}

function slideXml(shapes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${groupBase()}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function themeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FilingLens"><a:themeElements><a:clrScheme name="FilingLens"><a:dk1><a:srgbClr val="${BG}"/></a:dk1><a:lt1><a:srgbClr val="${WHITE}"/></a:lt1><a:dk2><a:srgbClr val="1E293B"/></a:dk2><a:lt2><a:srgbClr val="E2E8F0"/></a:lt2><a:accent1><a:srgbClr val="${BLUE}"/></a:accent1><a:accent2><a:srgbClr val="${CYAN}"/></a:accent2><a:accent3><a:srgbClr val="${GREEN}"/></a:accent3><a:accent4><a:srgbClr val="${AMBER}"/></a:accent4><a:accent5><a:srgbClr val="${VIOLET}"/></a:accent5><a:accent6><a:srgbClr val="${RED}"/></a:accent6><a:hlink><a:srgbClr val="4EA5FF"/></a:hlink><a:folHlink><a:srgbClr val="9B7FDB"/></a:folHlink></a:clrScheme><a:fontScheme name="FilingLens"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="FilingLens"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function masterXml(): string {
  const defaultStyle = `<a:lvl1pPr algn="l"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:srgbClr val="${WHITE}"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="FilingLens Master"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${BG}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${groupBase()}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="dk1" bg2="dk2" folHlink="folHlink" hlink="hlink" tx1="lt1" tx2="lt2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${defaultStyle}</p:titleStyle><p:bodyStyle>${defaultStyle}</p:bodyStyle><p:otherStyle>${defaultStyle}</p:otherStyle></p:txStyles></p:sldMaster>`;
}

function layoutXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${groupBase()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function presentationXml(slideCount: number): string {
  const ids = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12191695" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr/><a:lvl1pPr marL="0" algn="l" defTabSz="914400"><a:defRPr sz="1800" kern="1200"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`;
}

function presentationRels(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}</Relationships>`;
}

function contentTypes(slideCount: number): string {
  const slideOverrides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function coreProps(data: FilingAnalysis): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(data.company.name)} — FilingLens analysis</dc:title><dc:creator>FilingLens</dc:creator><cp:lastModifiedBy>FilingLens</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function appProps(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>FilingLens</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><Company>FilingLens</Company><AppVersion>1.0</AppVersion></Properties>`;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function join(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

type ZipInput = { name: string; data: Uint8Array };

/** Minimal ZIP writer using the STORE method; OOXML readers accept uncompressed parts. */
function zipStore(entries: ZipInput[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const localHeader = join([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name,
    ]);
    localChunks.push(localHeader, entry.data);
    const centralHeader = join([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    centralChunks.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }
  const central = join(centralChunks);
  const end = join([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return join([...localChunks, central, end]);
}

function packagePresentation(data: FilingAnalysis, slides: string[][]): Uint8Array {
  const entries: ZipInput[] = [];
  const add = (name: string, value: string) => entries.push({ name, data: utf8(value) });
  add("[Content_Types].xml", contentTypes(slides.length));
  add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  add("docProps/core.xml", coreProps(data));
  add("docProps/app.xml", appProps(slides.length));
  add("ppt/presentation.xml", presentationXml(slides.length));
  add("ppt/_rels/presentation.xml.rels", presentationRels(slides.length));
  add("ppt/slideMasters/slideMaster1.xml", masterXml());
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  add("ppt/slideLayouts/slideLayout1.xml", layoutXml());
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  add("ppt/theme/theme1.xml", themeXml());
  slides.forEach((slideShapes, index) => {
    add(`ppt/slides/slide${index + 1}.xml`, slideXml(slideShapes));
    add(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  });
  return zipStore(entries);
}

export function buildCompanyPowerPoint(data: FilingAnalysis, lang: PresentationLanguage) {
  const slides = [
    coverSlide(data, lang),
    overviewSlide(data, lang, 2),
    financialSlide(data, lang, 3),
    cashDebtSlide(data, lang, 4),
    marketSlide(data, lang, 5),
    riskSlide(data, lang, 6),
    timelineSlide(data, lang, 7),
    qualitySlide(data, lang, 8),
    sourcesSlide(data, lang, 9),
  ];
  return {
    bytes: packagePresentation(data, slides),
    fileName: `${sanitizeFileName(data.company.name)}-${data.jurisdiction.toUpperCase()}-FilingLens-Analysis.pptx`,
    slideCount: slides.length,
  };
}
