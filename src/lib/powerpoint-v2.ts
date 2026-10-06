import type { EvidenceReference, FilingAnalysis } from "@contracts/analysis";

export type PresentationLanguage = "en" | "pt";

const EMU = 914400;
const SLIDE_W = 13.333333;
const BG = "08101D";
const PANEL = "111C30";
const PANEL_DARK = "0C1628";
const BORDER = "2B3B56";
const WHITE = "F8FAFC";
const MUTED = "94A3B8";
const BLUE = "60A5FA";
const CYAN = "22D3EE";
const GREEN = "34D399";
const AMBER = "FBBF24";
const ROSE = "FB7185";
const VIOLET = "A78BFA";

const T = {
  en: {
    deck: "Company informational analysis",
    prepared: "Prepared from uploaded regulatory filings and validated FilingLens outputs",
    executive: "Executive overview",
    financials: "Financial performance",
    market: "Market & operating context",
    risks: "Principal risk factors",
    events: "Timeline & material events",
    quality: "Data quality & controls",
    sources: "Sources & methodology",
    companyProfile: "Company profile",
    takeaways: "Executive takeaways",
    reportingPeriod: "Reporting period",
    jurisdiction: "Jurisdiction",
    filed: "Filed",
    revenue: "Revenue",
    netIncome: "Net income",
    opCash: "Operating cash flow",
    cash: "Cash",
    debt: "Total debt",
    grossMargin: "Gross margin",
    peers: "Verified peers",
    segments: "Operating segments",
    geographies: "Geographies",
    industry: "Industry",
    guidance: "Disclosed outlook / guidance",
    gaps: "Data gaps",
    modules: "Analysis modules",
    complete: "Complete",
    partial: "Partial",
    failed: "Unavailable",
    na: "N/A",
    noData: "Not available from the analyzed filing bundle",
    methodology: "Filing-first extraction and validation. External research is separately citation-bound and does not overwrite filing-derived financial facts.",
    disclaimer: "Informational use only. Not investment advice. Verify material facts against the original regulatory filing before consequential use.",
    filing: "FILING",
    external: "WEB",
    sourceFooter: "Source: uploaded regulatory filings; external sources only where explicitly labeled.",
  },
  pt: {
    deck: "Análise informacional da companhia",
    prepared: "Preparado a partir dos documentos regulatórios enviados e das saídas validadas do FilingLens",
    executive: "Visão executiva",
    financials: "Desempenho financeiro",
    market: "Mercado e contexto operacional",
    risks: "Principais fatores de risco",
    events: "Linha do tempo e eventos materiais",
    quality: "Qualidade dos dados e controles",
    sources: "Fontes e metodologia",
    companyProfile: "Perfil da companhia",
    takeaways: "Principais conclusões",
    reportingPeriod: "Período reportado",
    jurisdiction: "Jurisdição",
    filed: "Protocolado",
    revenue: "Receita",
    netIncome: "Lucro líquido",
    opCash: "Fluxo de caixa operacional",
    cash: "Caixa",
    debt: "Dívida total",
    grossMargin: "Margem bruta",
    peers: "Concorrentes verificados",
    segments: "Segmentos operacionais",
    geographies: "Geografias",
    industry: "Indústria",
    guidance: "Perspectivas / guidance divulgado",
    gaps: "Lacunas de dados",
    modules: "Módulos da análise",
    complete: "Completo",
    partial: "Parcial",
    failed: "Indisponível",
    na: "N/A",
    noData: "Não disponível no conjunto de documentos analisado",
    methodology: "Extração e validação priorizando o documento. Pesquisa externa possui fronteira própria de citações e não substitui fatos financeiros extraídos dos documentos.",
    disclaimer: "Uso informacional. Não constitui recomendação de investimento. Verifique fatos materiais nos documentos regulatórios originais antes de uso consequencial.",
    filing: "DOCUMENTO",
    external: "WEB",
    sourceFooter: "Fonte: documentos regulatórios enviados; fontes externas somente quando explicitamente rotuladas.",
  },
} as const;

type Shape = string;
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
};

function emu(inches: number) { return Math.round(inches * EMU); }
function xml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function clamp(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
function latest(values: Array<number | null | undefined> | null | undefined): number | null {
  if (!values?.length) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}
function num(value: number | null | undefined, lang: PresentationLanguage, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(lang === "pt" ? "pt-BR" : "en-US", { maximumFractionDigits: digits }).format(value);
}
function fill(hex: string | null | undefined) {
  return hex ? `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>` : "<a:noFill/>";
}
function line(hex: string | null | undefined, width = 1) {
  return hex ? `<a:ln w="${Math.round(width * 12700)}"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
}
function para(text: string, opts: TextOpts) {
  const size = Math.round((opts.fontSize ?? 14) * 100);
  return `<a:p><a:pPr algn="${opts.align ?? "l"}"/><a:r><a:rPr lang="en-US" sz="${size}"${opts.bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${opts.color ?? WHITE}"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Aptos"/><a:cs typeface="Aptos"/></a:rPr><a:t>${xml(text)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${size}"/></a:p>`;
}
function shape(id: number, name: string, x: number, y: number, w: number, h: number, text = "", opts: TextOpts = {}): Shape {
  const margin = emu(opts.margin ?? 0.08);
  const tx = text ? `<p:txBody><a:bodyPr wrap="square" lIns="${margin}" rIns="${margin}" tIns="${margin}" bIns="${margin}" anchor="${opts.valign ?? "t"}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${text.split("\n").map(item => para(item, opts)).join("")}</p:txBody>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr${text ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="${opts.radius ? "roundRect" : "rect"}"><a:avLst/></a:prstGeom>${fill(opts.fill)}${line(opts.line)}</p:spPr>${tx}</p:sp>`;
}
function panel(shapes: Shape[], id: { value: number }, x: number, y: number, w: number, h: number, accent?: string) {
  shapes.push(shape(id.value++, "Panel", x, y, w, h, "", { fill: PANEL, line: BORDER, radius: true }));
  if (accent) shapes.push(shape(id.value++, "Panel accent", x, y, 0.055, h, "", { fill: accent }));
}
function title(shapes: Shape[], id: { value: number }, heading: string, kicker: string) {
  shapes.push(shape(id.value++, "Top rule", 0, 0, SLIDE_W, 0.055, "", { fill: CYAN }));
  shapes.push(shape(id.value++, "Kicker", 0.66, 0.34, 12, 0.24, kicker.toUpperCase(), { fontSize: 8.5, color: CYAN, bold: true }));
  shapes.push(shape(id.value++, "Title", 0.66, 0.67, 12, 0.55, heading, { fontSize: 25, color: WHITE, bold: true }));
}
function footer(shapes: Shape[], id: { value: number }, text: string, page: number) {
  shapes.push(shape(id.value++, "Footer line", 0.66, 7.04, 12.0, 0.01, "", { fill: BORDER }));
  shapes.push(shape(id.value++, "Footer", 0.66, 7.09, 10.9, 0.2, clamp(text, 165), { fontSize: 7.2, color: MUTED }));
  shapes.push(shape(id.value++, "Page", 11.8, 7.09, 0.85, 0.2, String(page), { fontSize: 7.2, color: MUTED, align: "r" }));
}
function metric(shapes: Shape[], id: { value: number }, x: number, y: number, w: number, label: string, value: string, detail: string, accent: string) {
  panel(shapes, id, x, y, w, 1.05, accent);
  shapes.push(shape(id.value++, `${label} label`, x + 0.18, y + 0.13, w - 0.32, 0.18, label.toUpperCase(), { fontSize: 7.8, color: MUTED, bold: true }));
  shapes.push(shape(id.value++, `${label} value`, x + 0.18, y + 0.36, w - 0.32, 0.32, value, { fontSize: 19, color: WHITE, bold: true }));
  shapes.push(shape(id.value++, `${label} detail`, x + 0.18, y + 0.75, w - 0.32, 0.16, clamp(detail, 55), { fontSize: 7.2, color: MUTED }));
}
function bullets(shapes: Shape[], id: { value: number }, items: string[], x: number, y: number, w: number, max: number, accent: string, fontSize = 11) {
  items.slice(0, max).forEach((item, index) => {
    const top = y + index * 0.65;
    shapes.push(shape(id.value++, `Bullet ${index}`, x, top + 0.11, 0.085, 0.085, "", { fill: accent, radius: true }));
    shapes.push(shape(id.value++, `Bullet text ${index}`, x + 0.2, top, w - 0.2, 0.53, clamp(item, 210), { fontSize, color: WHITE }));
  });
}
function barChart(shapes: Shape[], id: { value: number }, x: number, y: number, w: number, h: number, heading: string, periods: string[], values: number[], lang: PresentationLanguage, accent: string) {
  panel(shapes, id, x, y, w, h);
  shapes.push(shape(id.value++, "Chart title", x + 0.2, y + 0.15, w - 0.4, 0.25, heading, { fontSize: 11, color: WHITE, bold: true }));
  const rows = periods.map((period, index) => ({ period, value: values[index] })).filter(row => Number.isFinite(row.value));
  if (!rows.length) {
    shapes.push(shape(id.value++, "Chart empty", x + 0.2, y + 1.1, w - 0.4, 0.3, T[lang].noData, { fontSize: 9, color: MUTED, align: "ctr" }));
    return;
  }
  const max = Math.max(...rows.map(row => Math.abs(row.value)), 1);
  const slot = (w - 0.55) / rows.length;
  const chartH = h - 1.22;
  rows.forEach((row, index) => {
    const bh = Math.max(0.08, chartH * Math.abs(row.value) / max);
    const bx = x + 0.28 + index * slot + slot * 0.16;
    const bw = slot * 0.68;
    const by = y + 0.62 + chartH - bh;
    shapes.push(shape(id.value++, `Bar ${index}`, bx, by, bw, bh, "", { fill: row.value >= 0 ? accent : ROSE, radius: true }));
    shapes.push(shape(id.value++, `Bar value ${index}`, bx - 0.12, Math.max(y + 0.48, by - 0.27), bw + 0.24, 0.18, num(row.value, lang), { fontSize: 6.8, color: WHITE, bold: true, align: "ctr" }));
    shapes.push(shape(id.value++, `Bar period ${index}`, bx - 0.12, y + h - 0.35, bw + 0.24, 0.18, clamp(row.period, 13), { fontSize: 6.7, color: MUTED, align: "ctr" }));
  });
}
function sourceLabel(source: EvidenceReference, lang: PresentationLanguage) {
  if (source.url) return `${source.publisher ?? T[lang].external} · ${source.url}`;
  return [source.sourceForm, source.item, source.section, source.page ? `p. ${source.page}` : null].filter(Boolean).join(" · ") || T[lang].filing;
}
function collectSources(data: FilingAnalysis) {
  const list: EvidenceReference[] = [];
  const add = (source?: EvidenceReference | null) => { if (source) list.push(source); };
  data.metadata.sources.forEach(add);
  data.kpis.forEach(item => add(item.source));
  data.market.peerEvidence?.forEach(item => add(item.source));
  data.market.segments.forEach(item => add(item.source));
  data.market.geographies.forEach(item => add(item.source));
  data.risks.forEach(item => add(item.source));
  data.financials.evidence?.forEach(item => add(item.source));
  data.financials.forwardGuidance?.forEach(item => add(item.source));
  data.events.forEach(item => add(item.source));
  const seen = new Set<string>();
  return list.filter(source => {
    const key = source.url ?? `${source.sourceForm ?? ""}|${source.item ?? ""}|${source.section}|${source.page ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cover(data: FilingAnalysis, lang: PresentationLanguage): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 };
  s.push(shape(id.value++, "Right field", 8.55, -0.2, 5.0, 7.9, "", { fill: "0D2140" }));
  s.push(shape(id.value++, "Accent", 0.75, 1.1, 1.0, 0.07, "", { fill: CYAN }));
  s.push(shape(id.value++, "Type", 0.75, 1.42, 7.2, 0.3, c.deck.toUpperCase(), { fontSize: 9, color: CYAN, bold: true }));
  s.push(shape(id.value++, "Company", 0.75, 1.84, 7.2, 1.15, clamp(data.company.name, 72), { fontSize: 34, color: WHITE, bold: true }));
  s.push(shape(id.value++, "Identity", 0.75, 3.16, 7.2, 0.32, [data.company.ticker, data.company.exchange, data.company.filingType].filter(Boolean).join(" · "), { fontSize: 12, color: MUTED }));
  s.push(shape(id.value++, "Prepared", 0.75, 4.0, 7.1, 0.7, c.prepared, { fontSize: 13, color: WHITE }));
  metric(s, id, 8.95, 1.42, 3.7, c.reportingPeriod, data.metadata.reportingPeriod || data.company.periodEnd || "—", data.financials.unit, CYAN);
  metric(s, id, 8.95, 2.72, 3.7, c.jurisdiction, data.jurisdiction === "br" ? "CVM / Brasil" : "SEC / United States", data.metadata.filingType, BLUE);
  metric(s, id, 8.95, 4.02, 3.7, c.filed, data.metadata.filedAt || data.company.filedAt || "—", data.company.filingReference || "", VIOLET);
  s.push(shape(id.value++, "Disclaimer", 0.75, 6.35, 7.2, 0.55, c.disclaimer, { fontSize: 8, color: MUTED }));
  return s;
}

function executive(data: FilingAnalysis, lang: PresentationLanguage, page: number): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 };
  title(s, id, c.executive, `${data.company.name} · ${data.company.filingType}`);
  panel(s, id, 0.66, 1.38, 5.25, 2.05, CYAN);
  s.push(shape(id.value++, "Profile label", 0.9, 1.62, 4.75, 0.2, c.companyProfile.toUpperCase(), { fontSize: 8, color: CYAN, bold: true }));
  s.push(shape(id.value++, "Profile", 0.9, 1.94, 4.72, 1.14, clamp(data.company.description || c.noData, 430), { fontSize: 11.5, color: WHITE }));
  panel(s, id, 6.16, 1.38, 6.54, 2.05, GREEN);
  s.push(shape(id.value++, "Summary label", 6.4, 1.62, 6.05, 0.2, c.takeaways.toUpperCase(), { fontSize: 8, color: GREEN, bold: true }));
  bullets(s, id, data.summary.length ? data.summary : [c.noData], 6.4, 1.92, 6.0, 3, GREEN, 10.1);
  const kp = data.kpis.slice(0, 4);
  const fallbacks = [
    [c.revenue, num(latest(data.financials.revenue), lang), data.financials.unit],
    [c.netIncome, num(latest(data.financials.netIncome), lang), data.financials.unit],
  ];
  for (let i = 0; i < 4; i++) {
    const item = kp[i]; const fb = fallbacks[i];
    metric(s, id, 0.66 + i * 3.03, 3.82, 2.78, item?.label ?? fb?.[0] ?? "—", item?.value ?? fb?.[1] ?? "—", item?.delta ?? fb?.[2] ?? c.noData, [BLUE, GREEN, CYAN, VIOLET][i]);
  }
  footer(s, id, c.sourceFooter, page); return s;
}

function financials(data: FilingAnalysis, lang: PresentationLanguage, page: number): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 }; const f = data.financials;
  title(s, id, c.financials, `${data.company.name} · ${f.unit}`);
  metric(s, id, 0.66, 1.35, 2.32, c.revenue, num(latest(f.revenue), lang), f.years.at(-1) ?? c.noData, BLUE);
  metric(s, id, 3.10, 1.35, 2.32, c.netIncome, num(latest(f.netIncome), lang), f.years.at(-1) ?? c.noData, GREEN);
  metric(s, id, 5.54, 1.35, 2.32, c.opCash, num(latest(f.operatingCashFlow), lang), f.unit, CYAN);
  metric(s, id, 7.98, 1.35, 2.32, c.debt, num(latest(f.totalDebt), lang), f.unit, VIOLET);
  metric(s, id, 10.42, 1.35, 2.28, c.cash, num(latest(f.cash), lang), f.unit, AMBER);
  barChart(s, id, 0.66, 2.75, 5.88, 3.85, c.revenue, f.years, f.revenue, lang, BLUE);
  barChart(s, id, 6.78, 2.75, 5.92, 3.85, c.netIncome, f.years, f.netIncome, lang, GREEN);
  footer(s, id, c.sourceFooter, page); return s;
}

function market(data: FilingAnalysis, lang: PresentationLanguage, page: number): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 };
  title(s, id, c.market, `${data.company.name} · ${data.market.industry || c.noData}`);
  panel(s, id, 0.66, 1.4, 3.7, 4.95, CYAN);
  s.push(shape(id.value++, "Industry label", 0.9, 1.68, 3.2, 0.2, c.industry.toUpperCase(), { fontSize: 8, color: CYAN, bold: true }));
  s.push(shape(id.value++, "Industry", 0.9, 1.98, 3.2, 0.55, clamp(data.market.industry || c.noData, 100), { fontSize: 16, color: WHITE, bold: true }));
  s.push(shape(id.value++, "Peers label", 0.9, 2.82, 3.2, 0.2, c.peers.toUpperCase(), { fontSize: 8, color: GREEN, bold: true }));
  const peers = data.market.competitors.slice(0, 8);
  (peers.length ? peers : [c.noData]).forEach((peer, index) => {
    const evidence = data.market.peerEvidence?.find(item => item.name.toLowerCase() === peer.toLowerCase());
    const web = evidence?.sourceType === "external";
    s.push(shape(id.value++, `Peer ${index}`, 0.9, 3.15 + index * 0.36, 3.16, 0.28, `${web ? c.external : c.filing} · ${clamp(peer, 34)}`, { fontSize: 8.1, color: web ? AMBER : WHITE, fill: web ? "312815" : PANEL_DARK, line: web ? "705820" : BORDER, radius: true, valign: "ctr" }));
  });
  panel(s, id, 4.61, 1.4, 3.86, 4.95, BLUE);
  s.push(shape(id.value++, "Segments label", 4.87, 1.68, 3.35, 0.2, c.segments.toUpperCase(), { fontSize: 8, color: BLUE, bold: true }));
  const segments = data.market.segments.slice(0, 7).map(item => `${item.name}${latest(item.revenue) == null ? "" : ` · ${num(latest(item.revenue), lang)} ${data.financials.unit}`}`);
  bullets(s, id, segments.length ? segments : [c.noData], 4.87, 2.05, 3.3, 7, BLUE, 9.1);
  panel(s, id, 8.72, 1.4, 3.98, 4.95, VIOLET);
  s.push(shape(id.value++, "Geo label", 8.98, 1.68, 3.45, 0.2, c.geographies.toUpperCase(), { fontSize: 8, color: VIOLET, bold: true }));
  const geos = data.market.geographies.slice(0, 7).map(item => `${item.name}${latest(item.values) == null ? "" : ` · ${num(latest(item.values), lang)} ${data.financials.unit}`}`);
  bullets(s, id, geos.length ? geos : [c.noData], 8.98, 2.05, 3.4, 7, VIOLET, 9.1);
  footer(s, id, c.sourceFooter, page); return s;
}

function risks(data: FilingAnalysis, lang: PresentationLanguage, page: number): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 };
  title(s, id, c.risks, `${data.company.name} · ${data.risks.length} ${lang === "pt" ? "riscos estruturados" : "structured risks"}`);
  const items = data.risks.slice().sort((a, b) => (a.materialityRank ?? 999) - (b.materialityRank ?? 999) || b.severity - a.severity).slice(0, 6);
  if (!items.length) {
    panel(s, id, 0.66, 1.55, 12.04, 4.75, AMBER);
    s.push(shape(id.value++, "No risks", 1.0, 3.2, 11.3, 0.5, c.noData, { fontSize: 17, color: MUTED, align: "ctr" }));
  } else items.forEach((risk, index) => {
    const y = 1.43 + index * 0.84;
    panel(s, id, 0.66, y, 12.04, 0.68, risk.severity >= 4 ? ROSE : risk.severity === 3 ? AMBER : BLUE);
    s.push(shape(id.value++, `Risk rank ${index}`, 0.88, y + 0.15, 0.38, 0.34, String(index + 1), { fontSize: 11, color: WHITE, bold: true, fill: risk.severity >= 4 ? ROSE : risk.severity === 3 ? AMBER : BLUE, radius: true, align: "ctr", valign: "ctr" }));
    s.push(shape(id.value++, `Risk title ${index}`, 1.43, y + 0.08, 3.15, 0.26, clamp(risk.title, 68), { fontSize: 10, color: WHITE, bold: true }));
    s.push(shape(id.value++, `Risk cat ${index}`, 1.43, y + 0.37, 3.15, 0.17, clamp(risk.category, 45), { fontSize: 7, color: MUTED }));
    s.push(shape(id.value++, `Risk detail ${index}`, 4.73, y + 0.08, 6.18, 0.48, clamp(risk.summary, 175), { fontSize: 8.7, color: WHITE }));
    s.push(shape(id.value++, `Risk severity ${index}`, 11.12, y + 0.19, 1.25, 0.24, `${risk.severity}/5`, { fontSize: 9, color: risk.severity >= 4 ? ROSE : risk.severity === 3 ? AMBER : BLUE, bold: true, align: "ctr" }));
  });
  footer(s, id, c.sourceFooter, page); return s;
}

function events(data: FilingAnalysis, lang: PresentationLanguage, page: number): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 };
  title(s, id, c.events, `${data.company.name} · ${data.company.filingType}`);
  const items = data.events.length
    ? data.events.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(item => ({ date: item.date, title: item.title, detail: item.impact ?? item.category, external: item.sourceType === "external" }))
    : data.timeline.slice(-6).reverse().map(item => ({ date: item.year, title: item.title, detail: item.detail, external: item.sourceType === "external" }));
  if (!items.length) {
    panel(s, id, 0.66, 1.55, 12.04, 4.75, CYAN);
    s.push(shape(id.value++, "No events", 1.0, 3.2, 11.3, 0.5, c.noData, { fontSize: 17, color: MUTED, align: "ctr" }));
  } else {
    s.push(shape(id.value++, "Rail", 2.03, 1.68, 0.035, 4.55, "", { fill: BORDER }));
    items.forEach((item, index) => {
      const y = 1.5 + index * 0.82;
      s.push(shape(id.value++, `Dot ${index}`, 1.91, y + 0.23, 0.28, 0.28, "", { fill: item.external ? AMBER : CYAN, radius: true }));
      s.push(shape(id.value++, `Date ${index}`, 0.7, y + 0.13, 1.04, 0.26, item.date, { fontSize: 9.5, color: item.external ? AMBER : CYAN, bold: true, align: "r" }));
      panel(s, id, 2.48, y, 10.22, 0.63, item.external ? AMBER : CYAN);
      s.push(shape(id.value++, `Event title ${index}`, 2.74, y + 0.09, 3.35, 0.22, `${item.external ? c.external : c.filing} · ${clamp(item.title, 65)}`, { fontSize: 9.5, color: WHITE, bold: true }));
      s.push(shape(id.value++, `Event detail ${index}`, 6.23, y + 0.08, 6.05, 0.4, clamp(item.detail || c.noData, 175), { fontSize: 8.4, color: MUTED }));
    });
  }
  footer(s, id, c.sourceFooter, page); return s;
}

function quality(data: FilingAnalysis, lang: PresentationLanguage, page: number): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 };
  title(s, id, c.quality, `${data.company.name} · ${data.metadata.filingType}`);
  panel(s, id, 0.66, 1.4, 6.0, 4.95, GREEN);
  s.push(shape(id.value++, "Guidance label", 0.92, 1.69, 5.45, 0.2, c.guidance.toUpperCase(), { fontSize: 8, color: GREEN, bold: true }));
  const guidance = data.financials.forwardGuidance?.slice(0, 5).map(item => `${item.metric} · ${item.period} · ${item.range}`) ?? [];
  bullets(s, id, guidance.length ? guidance : [c.noData], 0.92, 2.03, 5.45, 5, GREEN, 9.7);
  s.push(shape(id.value++, "Gaps label", 0.92, 5.12, 5.45, 0.2, c.gaps.toUpperCase(), { fontSize: 8, color: AMBER, bold: true }));
  s.push(shape(id.value++, "Gaps", 0.92, 5.43, 5.45, 0.58, clamp(data.missingData.length ? data.missingData.slice(0, 6).join(" · ") : c.noData, 250), { fontSize: 8.4, color: MUTED }));
  panel(s, id, 6.91, 1.4, 5.79, 4.95, BLUE);
  s.push(shape(id.value++, "Modules label", 7.18, 1.69, 5.2, 0.2, c.modules.toUpperCase(), { fontSize: 8, color: BLUE, bold: true }));
  const modules: Array<[keyof NonNullable<FilingAnalysis["diagnostics"]>, string]> = [
    ["metadata", lang === "pt" ? "Metadados" : "Metadata"], ["profiler", lang === "pt" ? "Perfil" : "Profile"],
    ["financials", lang === "pt" ? "Financeiro" : "Financials"], ["market", lang === "pt" ? "Mercado" : "Market"],
    ["risks", lang === "pt" ? "Riscos" : "Risks"], ["historian", lang === "pt" ? "Eventos" : "Events"],
    ["synthesizer", lang === "pt" ? "Síntese" : "Synthesis"],
  ];
  modules.forEach(([key, label], index) => {
    const status = data.diagnostics?.[key]?.status ?? "incomplete";
    const localized = status === "complete" ? c.complete : status === "failed" ? c.failed : status === "not_applicable" ? c.na : c.partial;
    const color = status === "complete" ? GREEN : status === "failed" ? ROSE : status === "not_applicable" ? MUTED : AMBER;
    const y = 2.11 + index * 0.48;
    s.push(shape(id.value++, `Module ${index}`, 7.18, y, 3.5, 0.29, label, { fontSize: 9.2, color: WHITE }));
    s.push(shape(id.value++, `Module status ${index}`, 10.72, y, 1.55, 0.29, localized.toUpperCase(), { fontSize: 7.2, color, bold: true, align: "r" }));
  });
  footer(s, id, c.sourceFooter, page); return s;
}

function sources(data: FilingAnalysis, lang: PresentationLanguage, page: number): Shape[] {
  const c = T[lang]; const s: Shape[] = []; const id = { value: 2 };
  title(s, id, c.sources, `${data.company.name} · ${data.metadata.filingType}`);
  panel(s, id, 0.66, 1.4, 7.55, 4.95, CYAN);
  s.push(shape(id.value++, "Sources label", 0.92, 1.68, 7.0, 0.2, (lang === "pt" ? "EVIDÊNCIAS" : "EVIDENCE SOURCES"), { fontSize: 8, color: CYAN, bold: true }));
  const sourceLines = collectSources(data).slice(0, 10).map((source, index) => `${index + 1}. ${sourceLabel(source, lang)}`);
  (sourceLines.length ? sourceLines : [c.noData]).forEach((entry, index) => s.push(shape(id.value++, `Source ${index}`, 0.92, 2.0 + index * 0.4, 6.95, 0.31, clamp(entry, 142), { fontSize: 8, color: entry.includes("http") ? AMBER : WHITE })));
  panel(s, id, 8.46, 1.4, 4.24, 4.95, GREEN);
  s.push(shape(id.value++, "Method label", 8.73, 1.68, 3.7, 0.2, (lang === "pt" ? "METODOLOGIA" : "METHODOLOGY"), { fontSize: 8, color: GREEN, bold: true }));
  s.push(shape(id.value++, "Method", 8.73, 2.06, 3.7, 1.65, c.methodology, { fontSize: 10, color: WHITE }));
  s.push(shape(id.value++, "Divider", 8.73, 3.94, 3.7, 0.015, "", { fill: BORDER }));
  s.push(shape(id.value++, "Limit label", 8.73, 4.2, 3.7, 0.2, (lang === "pt" ? "LIMITAÇÕES" : "LIMITATIONS"), { fontSize: 8, color: AMBER, bold: true }));
  s.push(shape(id.value++, "Disclaimer", 8.73, 4.55, 3.7, 1.2, c.disclaimer, { fontSize: 9, color: MUTED }));
  footer(s, id, c.sourceFooter, page); return s;
}

function groupBase() {
  return `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
}
function slideXml(shapes: Shape[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${groupBase()}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FilingLens v2"><a:themeElements><a:clrScheme name="FilingLens"><a:dk1><a:srgbClr val="${BG}"/></a:dk1><a:lt1><a:srgbClr val="${WHITE}"/></a:lt1><a:dk2><a:srgbClr val="1E293B"/></a:dk2><a:lt2><a:srgbClr val="E2E8F0"/></a:lt2><a:accent1><a:srgbClr val="${BLUE}"/></a:accent1><a:accent2><a:srgbClr val="${CYAN}"/></a:accent2><a:accent3><a:srgbClr val="${GREEN}"/></a:accent3><a:accent4><a:srgbClr val="${AMBER}"/></a:accent4><a:accent5><a:srgbClr val="${VIOLET}"/></a:accent5><a:accent6><a:srgbClr val="${ROSE}"/></a:accent6><a:hlink><a:srgbClr val="4EA5FF"/></a:hlink><a:folHlink><a:srgbClr val="9B7FDB"/></a:folHlink></a:clrScheme><a:fontScheme name="Aptos"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="FilingLens"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}
function masterXml() {
  const style = `<a:lvl1pPr algn="l"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:srgbClr val="${WHITE}"/></a:solidFill><a:latin typeface="Aptos"/></a:defRPr></a:lvl1pPr>`;
  // ECMA-376: sldLayoutId values must be >= 2^31. Microsoft PowerPoint is
  // stricter here than LibreOffice/python-pptx, which is why the legacy export
  // could be ZIP-readable but still rejected by PowerPoint.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="FilingLens Master"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${BG}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${groupBase()}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="dk1" bg2="dk2" folHlink="folHlink" hlink="hlink" tx1="lt1" tx2="lt2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${style}</p:titleStyle><p:bodyStyle>${style}</p:bodyStyle><p:otherStyle>${style}</p:otherStyle></p:txStyles></p:sldMaster>`;
}
function layoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${groupBase()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}
function presentationXml(count: number) {
  const slideIds = Array.from({ length: count }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr/><a:lvl1pPr marL="0" algn="l" defTabSz="914400"><a:defRPr sz="1800" kern="1200"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`;
}
function presentationRels(count: number) {
  const slides = Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}</Relationships>`;
}
function contentTypes(count: number) {
  const slides = Array.from({ length: count }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}
function coreProps(data: FilingAnalysis) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(data.company.name)} — FilingLens analysis</dc:title><dc:creator>FilingLens</dc:creator><cp:lastModifiedBy>FilingLens</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}
function appProps(count: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${count}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><Company>FilingLens</Company><AppVersion>16.0000</AppVersion></Properties>`;
}
function utf8(value: string) { return new TextEncoder().encode(value); }
const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function u16(v: number) { return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff); }
function u32(v: number) { return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
function join(chunks: Uint8Array[]) { const total = chunks.reduce((n, part) => n + part.length, 0); const out = new Uint8Array(total); let offset = 0; for (const part of chunks) { out.set(part, offset); offset += part.length; } return out; }
type ZipEntry = { name: string; data: Uint8Array };
function zipStore(entries: ZipEntry[]) {
  const locals: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name); const crc = crc32(entry.data);
    const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name]);
    locals.push(local, entry.data);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length + entry.data.length;
  }
  const directory = join(central);
  const end = join([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
  return join([...locals, directory, end]);
}
function packagePptx(data: FilingAnalysis, slides: Shape[][]) {
  const entries: ZipEntry[] = []; const add = (name: string, content: string) => entries.push({ name, data: utf8(content) });
  add("[Content_Types].xml", contentTypes(slides.length));
  add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  add("docProps/core.xml", coreProps(data)); add("docProps/app.xml", appProps(slides.length));
  add("ppt/presentation.xml", presentationXml(slides.length)); add("ppt/_rels/presentation.xml.rels", presentationRels(slides.length));
  add("ppt/slideMasters/slideMaster1.xml", masterXml());
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  add("ppt/slideLayouts/slideLayout1.xml", layoutXml());
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  add("ppt/theme/theme1.xml", themeXml());
  slides.forEach((slide, index) => {
    add(`ppt/slides/slide${index + 1}.xml`, slideXml(slide));
    add(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  });
  return zipStore(entries);
}
function sanitize(value: string) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "company"; }

export function buildCompanyPowerPointV2(data: FilingAnalysis, lang: PresentationLanguage) {
  const slides = [cover(data, lang), executive(data, lang, 2), financials(data, lang, 3), market(data, lang, 4), risks(data, lang, 5), events(data, lang, 6), quality(data, lang, 7), sources(data, lang, 8)];
  return { bytes: packagePptx(data, slides), fileName: `${sanitize(data.company.name)}-${data.jurisdiction.toUpperCase()}-FilingLens-Analysis.pptx`, slideCount: slides.length };
}
