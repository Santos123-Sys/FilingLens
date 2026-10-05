import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";
import pdfParse from "./pdf";
import { filingModel } from "./ai/provider";
import { AiMisconfigured, classifyAiError } from "./lib/ai-client";
import { AGENTS, METADATA_AGENT, type AgentName } from "./engines";
import type { Jurisdiction, Market } from "../contracts/analysis";

const MAX_TEXT_CHARS = 220_000;
const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

const BR_FINANCIAL_HEADINGS = [
  /demonstra(?:ç|c)(?:ão|ao)\s+(?:do|de)\s+resultado(?:\s+do\s+exerc[ií]cio)?/i,
  /balan(?:ç|c)o\s+patrimonial/i,
  /demonstra(?:ç|c)(?:ão|ao)\s+dos?\s+fluxos?\s+de\s+caixa/i,
  /demonstra(?:ç|c)(?:ão|ao)\s+das?\s+muta(?:ç|c)(?:ões|oes)\s+do\s+patrim[oô]nio\s+l[ií]quido/i,
  /informa(?:ç|c)(?:ões|oes)\s+financeiras\s+selecionadas/i,
  /informa(?:ç|c)(?:ões|oes)\s+por\s+segmento/i,
];
const BR_RISK_HEADINGS = [
  /fatores\s+de\s+risco/i,
  /principais\s+riscos/i,
  /gest[aã]o\s+de\s+riscos/i,
];
const BR_MARKET_HEADINGS = [
  /segmentos?\s+(?:operacionais|de\s+neg[oó]cios)/i,
  /informa(?:ç|c)(?:ões|oes)\s+por\s+segmento/i,
  /concorr(?:e|ê)ncia|concorrentes/i,
  /(?:vis[aã]o\s+geral\s+do\s+)?mercado\s+(?:de|e|em|no|na)\s+(?:atua(?:ç|c)(?:ão|ao)|opera(?:ç|c)(?:ão|ao)|neg[oó]cios|combust[ií]veis|lubrificantes)/i,
  /ambiente\s+(?:de\s+)?neg[oó]cios/i,
  /ambiente\s+concorrencial/i,
  /setor\s+de\s+atua(?:ç|c)(?:ão|ao)/i,
  /principais\s+mercados/i,
  /participa(?:ç|c)(?:ão|ao)\s+(?:de\s+)?mercado/i,
];
const SEC_SECTION_HEADINGS = [
  /item\s+1\.?\s+business/i,
  /item\s+1a\.?\s+risk\s+factors/i,
  /item\s+7\.?\s+management'?s\s+discussion/i,
  /item\s+8\.?\s+financial\s+statements/i,
  /item\s+2\.?\s+management'?s\s+discussion/i,
];
const EVENT_HEADINGS = [
  /fato\s+relevante/i,
  /eventos?\s+subsequentes?/i,
  /item\s+[125]\.0[1258]/i,
  /current\s+report\s+on\s+form\s+8-k/i,
];

export class BadFiling extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadFiling";
  }
}

/** Step 0 — pure CPU: pull the text out of the PDF. */
export async function extractFilingText(buf: Buffer): Promise<string> {
  let text: string;
  try {
    const data = await pdfParse(buf);
    text = (data.text || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    throw new BadFiling("unreadable_pdf");
  }
  if (text.length < 2000) throw new BadFiling("too_little_text");
  return createAnalysisCorpus(text);
}

/* ------------------------------------------------------------------ */
/* Focused excerpts — each agent reads only the slice it needs,        */
/* so every request stays well inside the platform's duration limit.   */
/* ------------------------------------------------------------------ */

/** Locate the start of a filing section ("Item 1.", "Item 7.", ...). */
function findSectionStart(text: string, patterns: RegExp[]): number {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m.index;
  }
  return -1;
}

/** Slice a section: find start, cut at the first end-pattern after it, hard-cap. */
function sliceSection(
  text: string,
  startPatterns: RegExp[],
  endPatterns: RegExp[],
  maxChars: number,
): string {
  const start = findSectionStart(text, startPatterns);
  if (start < 0) return "";
  let end = -1;
  for (const re of endPatterns) {
    re.lastIndex = 0;
    const m = re.exec(text.slice(start + 50));
    if (m && (end < 0 || start + 50 + m.index < end)) end = start + 50 + m.index;
  }
  const stop = end > start ? Math.min(end, start + maxChars) : start + maxChars;
  return text.slice(start, stop);
}

/** Return small, non-overlapping windows around relevant headings. */
function headingWindows(
  text: string,
  patterns: RegExp[],
  windowChars: number,
  maxWindows = 6,
): string[] {
  const starts: number[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(re)) starts.push(match.index ?? 0);
  }
  starts.sort((a, b) => a - b);
  const distinct = starts.filter((start, index) => index === 0 || start - starts[index - 1] > 2_000);
  return distinct.slice(0, maxWindows).map(start => text.slice(start, start + windowChars));
}

/** Keep long filings practical for browser round trips without losing late tables. */
function createAnalysisCorpus(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  const sections = [text.slice(0, 32_000)];
  const prioritized = [
    ...headingWindows(text, BR_FINANCIAL_HEADINGS, 30_000),
    ...headingWindows(text, BR_RISK_HEADINGS, 26_000),
    ...headingWindows(text, BR_MARKET_HEADINGS, 22_000),
    ...headingWindows(text, SEC_SECTION_HEADINGS, 26_000),
    ...headingWindows(text, EVENT_HEADINGS, 18_000, 4),
  ];
  for (const section of prioritized) {
    const candidate = `${sections.join("\n\n[... filing section ...]\n\n")}\n\n[... filing section ...]\n\n${section}`;
    if (candidate.length > MAX_TEXT_CHARS) break;
    sections.push(section);
  }
  return `${sections.join("\n\n[... filing section ...]\n\n")}\n\n[... filing text selectively condensed for analysis ...]`;
}

/** Extract just the section the agent needs, capped hard.
 *  Handles both 10-K (Item 1/7/8) and 10-Q (Item 1/2/3) layouts. */
export function buildAgentInput(agent: AgentName, text: string): string {
  const lower = text.toLowerCase();

  // Start patterns carry `(?!\s*\d)` so table-of-contents entries
  // ("Item 1A. Risk Factors51") don't shadow the real section header.
  const business = sliceSection(
    text,
    [/item\s+1\.?\s+business(?!\s*\d)/i, /item\s+1\.\s+descri(?!\s*\d)/i, /descri(?:ç|c)(?:ão|ao)\s+(?:das?\s+)?atividades/i],
    [/item\s+1a/i, /item\s+2\.?\s+propert/i, /item\s+1b/i],
    40_000,
  );
  const risks = sliceSection(
    text,
    [/item\s+1a(?!\s*\d)/i, ...BR_RISK_HEADINGS],
    [/item\s+2\.?\s+unregistered/i, /item\s+2\.?\s+propert/i, /item\s+1b/i, /controles?\s+internos?/i],
    70_000,
  );
  const mdna = sliceSection(
    text,
    [/item\s+[27]\.?\s+management'?s\s+discussion(?!\s*\d)/i, /item\s+7\.\s+coment/i, /coment[aá]rio\s+da\s+administra(?:ç|c)(?:ão|ao)/i, /an[aá]lise\s+e\s+discuss[aã]o\s+da\s+administra(?:ç|c)(?:ão|ao)/i],
    [/item\s+[38]\.?\s+(quantitative|financial)/i, /item\s+4\.?\s+controls/i],
    40_000,
  );
  const statements = sliceSection(
    text,
    [/item\s+1\.?\s+financial\s+statements(?!\s*\d)/i, /item\s+8\.?\s+financial(?!\s*\d)/i, /demonstra(?:ç|c)(?:ões|oes)\s+financeiras/i, ...BR_FINANCIAL_HEADINGS],
    [/item\s+[23]\.?\s+management/i, /item\s+9/i, /notas?\s+explicativas?/i],
    40_000,
  );

  // Fallbacks when section detection fails (scanned PDFs, non-SEC layouts)
  const head = text.slice(0, 45_000);
  const riskFallback = (() => {
    const i = Math.max(lower.indexOf("risk factors"), lower.indexOf("fatores de risco"));
    return i < 0 ? "" : text.slice(i, i + 70_000);
  })();
  const brFinancials = headingWindows(text, BR_FINANCIAL_HEADINGS, 18_000, 5);
  const brMarket = headingWindows(text, BR_MARKET_HEADINGS, 16_000, 3);

  let out = "";
  switch (agent) {
    case "profiler":
      out = (business || head).slice(0, 45_000);
      break;
    case "market":
      // Market evidence can be in Item 1, MD&A, or a Brazilian market/segment heading.
      // Include all relevant slices so a short Item 1 section does not shadow later disclosures.
      out = [business, mdna, ...brMarket, business || head]
        .filter((section, index, sections) => Boolean(section) && sections.indexOf(section) === index)
        .filter(Boolean)
        .join("\n\n[... market disclosure ...]\n\n")
        .slice(0, 55_000);
      break;
    case "risks":
      out = (risks || riskFallback || head).slice(0, 70_000);
      break;
    case "financials":
      out = [mdna, statements, ...brFinancials]
        .filter(Boolean)
        .join("\n\n[... financial statements ...]\n\n")
        .slice(0, 90_000);
      if (!statements && !brFinancials.length) out = (mdna || head).slice(0, 75_000);
      break;
    case "historian":
      out = [
        business.slice(0, 24_000) || head.slice(0, 24_000),
        mdna.slice(0, 18_000),
        ...headingWindows(text, EVENT_HEADINGS, 15_000, 4),
      ]
        .filter(Boolean)
        .join("\n\n[... later sections ...]\n\n")
        .slice(0, 70_000);
      break;
    case "synthesizer":
      out = [text.slice(0, 12_000), mdna.slice(0, 30_000)].filter(Boolean).join("\n\n[... management discussion ...]\n\n").slice(0, 40_000);
      break;
  }

  if (out.length < 2000) out = text.slice(0, 60_000);
  if (out.length < 2000) out = text;
  return out;
}

export function buildMetadataInput(text: string): string {
  return text.slice(0, 50_000);
}

const modelCache = new Map<string, LanguageModel>();
async function model(stage: AgentName | "metadata"): Promise<LanguageModel> {
  if (!process.env.OPENAI_API_KEY) {
    throw new AiMisconfigured("OPENAI_API_KEY is not configured");
  }
  const cached = modelCache.get(stage);
  if (cached) return cached;
  const selected = filingModel(stage);
  modelCache.set(stage, selected);
  return selected;
}

/** One agent step: a single short, focused, schema-validated LLM call.
 *  No server-side retries — each HTTP request must stay inside the platform's
 *  duration limit; the client retries the request instead. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAgent(
  agent: AgentName,
  market: Market,
  text: string,
  schema: z.ZodTypeAny,
  context?: { jurisdiction: Jurisdiction; filingType: string },
): Promise<any> {
  try {
    const t0 = Date.now();
    const contextPrompt = context
      ? `\n## Confirmed filing context\n- Jurisdiction: ${context.jurisdiction}\n- Filing type: ${context.filingType}\nApply the matching regulator and filing-type contract.\n`
      : "";
    const res = await generateObject({
      model: await model(agent),
      schema,
      system: AGENTS[agent].system(market) + contextPrompt,
      messages: [{ role: "user", content: text }],
      providerOptions: { openai: { maxCompletionTokens: AGENTS[agent].maxTokens } },
      abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    console.log(`[agent:${agent}] OK in ${((Date.now() - t0) / 1000).toFixed(0)}s, tokens=${res.usage?.totalTokens}`);
    return res.object;
  } catch (err) {
    const mapped = classifyAiError(err);
    console.warn(`[agent:${agent}] failed:`, mapped.name, mapped.message);
    throw mapped;
  }
}

export async function runMetadataAgent(
  market: Market,
  text: string,
  schema: z.ZodTypeAny,
): Promise<any> {
  try {
    const t0 = Date.now();
    const res = await generateObject({
      model: await model("metadata"),
      schema,
      system: METADATA_AGENT.system(market),
      messages: [{ role: "user", content: buildMetadataInput(text) }],
      providerOptions: { openai: { maxCompletionTokens: METADATA_AGENT.maxTokens } },
      abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    console.log(`[agent:metadata] OK in ${((Date.now() - t0) / 1000).toFixed(0)}s, tokens=${res.usage?.totalTokens}`);
    return res.object;
  } catch (err) {
    const mapped = classifyAiError(err);
    console.warn("[agent:metadata] failed:", mapped.name, mapped.message);
    throw mapped;
  }
}
