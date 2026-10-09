import { createHash } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";
import pdfParse from "./pdf";
import { filingModel, openAIProviderOptions } from "./ai/provider";
import { AiMisconfigured, classifyAiError } from "./lib/ai-client";
import { withModelExecution } from "./ai/execution";
import { AGENTS, METADATA_AGENT, type AgentName } from "./engines";
import type { Jurisdiction, Market } from "../contracts/analysis";

const MAX_TEXT_CHARS = 320_000;
const MIN_SECTION_SPACING = 8_000;
type ExcerptPart = string | string[];

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
  /4(?:\.\d+)?\s*[-–—:]?\s*(?:descri(?:ç|c)(?:ão|ao)\s+dos?\s+)?fatores\s+de\s+risco/i,
  /riscos?\s+relacionad[oa]s?\s+(?:ao|aos|à|às)\s+(?:emissor|controlador|controladores|atividade|setor)/i,
  /riscos?\s+(?:ambientais|sociais|clim[aá]ticos|regulat[oó]rios|operacionais|financeiros)/i,
];
const BR_SEGMENT_HEADINGS = [
  /segmentos?\s+(?:operacionais|de\s+neg[oó]cios)/i,
  /informa(?:ç|c)(?:ões|oes)\s+(?:cont[aá]beis?\s+)?por\s+segmento/i,
  /resultados?\s+por\s+segmento(?:\s+de\s+neg[oó]cios?)?/i,
  /receita(?:\s+l[ií]quida)?\s+por\s+segmento/i,
  /desempenho\s+por\s+segmento/i,
  /segmento\s+de\s+neg[oó]cios?\s*[-–—:]?\s*(?:receita|resultado|informa(?:ç|c)(?:ões|oes))/i,
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
const SEC_FINANCIAL_HEADINGS = [
  /part\s+i[,.]?\s*item\s+1\.?\s+financial\s+statements/i,
  /item\s+1\.?\s+financial\s+statements/i,
  /condensed\s+consolidated\s+statements?\s+of\s+(?:income|operations|earnings)/i,
  /condensed\s+consolidated\s+balance\s+sheets?/i,
  /condensed\s+consolidated\s+statements?\s+of\s+cash\s+flows?/i,
  /item\s+8\.?\s+financial\s+statements/i,
];
const SEC_RISK_HEADINGS = [
  /item\s+1a\.?\s+risk\s+factors/i,
  /no\s+material\s+changes?.{0,140}risk\s+factors/i,
  /risk\s+factors?\s+(?:set\s+forth|described|disclosed)/i,
];
const SEC_SEGMENT_HEADINGS = [
  /(?:quarterly\s+)?business\s+unit\s+financial\s+results/i,
  /segment\s+information/i,
  /reportable\s+segments?/i,
  /segment(?:ed)?\s+(?:net\s+)?sales/i,
  /revenue\s+by\s+(?:specialized\s+market|market\s+platform|segment|geograph)/i,
  /operating\s+segments?/i,
];
const SEC_MARKET_HEADINGS = [
  /(?:quarterly\s+)?business\s+unit\s+financial\s+results/i,
  /segment\s+information/i,
  /reportable\s+segments?/i,
  /revenue\s+by\s+(?:specialized\s+market|market\s+platform|segment|geograph)/i,
  /geographic\s+(?:revenue|information)/i,
  /item\s+2\.?\s+management'?s\s+discussion/i,
  /item\s+1\.?\s+business/i,
  /exhibit\s+99\.?1/i,
];
const SEC_PROFILE_HEADINGS = [
  /item\s+1\.?\s+business/i,
  /business\s+overview/i,
  /company\s+overview/i,
  /item\s+2\.?\s+management'?s\s+discussion/i,
  /exhibit\s+99\.?1/i,
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

function cloneGlobal(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

function matchStarts(text: string, patterns: RegExp[]): number[] {
  const starts: number[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(cloneGlobal(pattern))) {
      if (typeof match.index === "number") starts.push(match.index);
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

/**
 * Collapse nearby aliases that point to the same filing section. Without this,
 * headings such as "Part I Item 1" and "Condensed Consolidated Statements of
 * Income" can consume separate windows while a distant balance sheet or cash
 * flow statement is starved from the bounded prompt.
 */
function spacedSectionStarts(starts: number[], minSpacing = MIN_SECTION_SPACING): number[] {
  const spaced: number[] = [];
  for (const start of starts) {
    const previous = spaced.at(-1);
    if (previous === undefined || start - previous >= minSpacing) spaced.push(start);
  }
  return spaced;
}

/**
 * Retrieve multiple matching filing windows, not only the first section heading.
 * This matters for 10-Qs where income statement, balance sheet, segment notes,
 * MD&A and risk updates are separated by tens or hundreds of pages.
 */
function surroundingMatches(
  text: string,
  patterns: RegExp[],
  totalBudget: number,
  maxMatches = 5,
  preferLast = false,
  minSpacing = MIN_SECTION_SPACING,
  minWindowChars = 4_000,
): string[] {
  const starts = spacedSectionStarts(matchStarts(text, patterns), minSpacing);
  if (!starts.length) return [];
  // Keep coverage across the document when aliases/contents listings exceed the cap.
  // In particular, a late body section must not be starved by early TOC aliases.
  const selected = preferLast ? starts.slice(-maxMatches)
    : starts.length <= maxMatches ? starts
      : Array.from({ length: maxMatches }, (_, index) => starts[Math.round(index * (starts.length - 1) / Math.max(1, maxMatches - 1))]);
  const perMatch = Math.max(minWindowChars, Math.floor(totalBudget / selected.length));
  return selected
    .map(start => text.slice(Math.max(0, start - 1_200), Math.min(text.length, start + perMatch - 1_200)));
}

/**
 * Fairly distribute a hard character budget across evidence families. Sequential
 * join-then-slice semantics can silently drop the final evidence family, which is
 * exactly how a 10-Q balance sheet was lost after being successfully retrieved.
 */
function boundedJoin(parts: ExcerptPart[], budget: number): string {
  const unique: ExcerptPart[] = [];
  const seen = new Set<string>();
  for (const part of parts.filter(part => part.length > 0)) {
    const key = JSON.stringify(part);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  if (!unique.length) return "";

  const separator = "\n\n";
  let remaining = Math.max(0, budget - separator.length * (unique.length - 1));
  let remainingParts = unique.length;
  const output: string[] = [];
  for (const part of unique) {
    const quota = Math.max(0, Math.floor(remaining / remainingParts));
    // Preserve each selected window when its evidence family receives a quota.
    const slice = typeof part === "string" ? part.slice(0, quota) : boundedJoin(part, quota);
    output.push(slice);
    remaining -= slice.length;
    remainingParts -= 1;
  }
  return output.join(separator).slice(0, budget);
}

export function createAnalysisCorpus(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return boundedJoin([
    text.slice(0, 40_000),
    surroundingMatches(text, BR_FINANCIAL_HEADINGS, 45_000, 4),
    surroundingMatches(text, SEC_FINANCIAL_HEADINGS, 85_000, 6),
    surroundingMatches(text, BR_RISK_HEADINGS, 35_000, 3, true),
    surroundingMatches(text, SEC_RISK_HEADINGS, 45_000, 4, true),
    surroundingMatches(text, BR_MARKET_HEADINGS, 40_000, 4),
    surroundingMatches(text, SEC_MARKET_HEADINGS, 55_000, 5),
    surroundingMatches(text, EVENT_HEADINGS, 25_000, 4, true),
    text.slice(-35_000),
  ], MAX_TEXT_CHARS);
}

/**
 * Multi-document bundles are delimited by /api/extract. Keep each document as an
 * independent retrieval unit so a long first filing cannot starve later filings.
 */
function splitDocuments(text: string): string[] {
  const marker = /\[FILINGLENS_DOCUMENT \d+\/\d+: [^\]]+\]\n([\s\S]*?)\n\[\/FILINGLENS_DOCUMENT \d+\]/g;
  const documents: string[] = [];
  for (const match of text.matchAll(marker)) {
    const body = match[1]?.trim();
    if (body) documents.push(body);
  }
  return documents.length > 0 ? documents : [text];
}

function proportionalJoin(documents: string[], totalChars: number, build: (document: string, budget: number) => string): string {
  const separator = "\n\n";
  const headers = documents.map((document, index) => {
    const id = createHash("sha256").update(document).digest("hex");
    return `## Filing bundle document ${index + 1} [normalized-text-sha256:${id}]\n`;
  });
  // Reserve label/separator overhead before distributing body budgets. Never
  // truncate a completed bundle and silently remove the final document's tail.
  let remaining = Math.max(0, totalChars - headers.reduce((sum, header) => sum + header.length, 0)
    - separator.length * Math.max(0, documents.length - 1));
  return documents.map((document, index) => {
    const quota = Math.floor(remaining / (documents.length - index));
    const body = build(document, quota).slice(0, quota);
    remaining -= body.length;
    return headers[index] + body;
  }).join(separator).slice(0, totalChars);
}

export function buildMetadataInput(text: string): string {
  const documents = splitDocuments(text);
  return proportionalJoin(documents, 60_000, (document, budget) => document.slice(0, budget));
}

function buildSingleAgentInput(agent: AgentName, text: string, budget: number): string {
  // A bounded document already fits; avoid duplicating overlapping sections.
  if (text.length <= budget) return text;
  const first = text.slice(0, Math.min(12_000, Math.max(6_000, Math.floor(budget * 0.18))));
  const cap = (parts: ExcerptPart[]) => boundedJoin(parts, budget);
  switch (agent) {
    case "financials":
      return cap([
        first,
        surroundingMatches(text, SEC_FINANCIAL_HEADINGS, Math.floor(budget * 0.76), 6),
        surroundingMatches(text, BR_FINANCIAL_HEADINGS, Math.floor(budget * 0.62), 5),
        text.slice(-Math.min(8_000, Math.floor(budget * 0.08))),
      ]);
    case "risks":
      return cap([
        first,
        surroundingMatches(text, SEC_RISK_HEADINGS, Math.floor(budget * 0.76), 5, true),
        surroundingMatches(text, BR_RISK_HEADINGS, Math.floor(budget * 0.70), 4, true),
        text.slice(-Math.min(9_000, Math.floor(budget * 0.1))),
      ]);
    case "market":
      return cap([
        first,
        surroundingMatches(
          text,
          [...SEC_SEGMENT_HEADINGS, ...BR_SEGMENT_HEADINGS],
          Math.floor(budget * 0.76),
          4,
          false,
          1_500,
          12_000,
        ),
        surroundingMatches(text, [...SEC_MARKET_HEADINGS, ...BR_MARKET_HEADINGS], Math.floor(budget * 0.64), 6),
      ]);
    case "profiler":
      return cap([
        first,
        surroundingMatches(text, SEC_PROFILE_HEADINGS, Math.floor(budget * 0.54), 4),
        surroundingMatches(text, SEC_MARKET_HEADINGS, Math.floor(budget * 0.42), 4),
        surroundingMatches(text, BR_MARKET_HEADINGS, Math.floor(budget * 0.50), 4),
      ]);
    case "historian":
      return cap([
        first,
        surroundingMatches(text, EVENT_HEADINGS, Math.floor(budget * 0.64), 6, true),
        text.slice(-Math.min(12_000, Math.floor(budget * 0.18))),
      ]);
    case "synthesizer":
      return text.slice(0, budget);
    default:
      return text.slice(0, budget);
  }
}

export function buildRiskRecoveryInput(text: string): string {
  const documents = splitDocuments(text);
  return proportionalJoin(documents, 145_000, (document, budget) => boundedJoin([
    document.slice(0, Math.min(10_000, budget)),
    surroundingMatches(document, BR_RISK_HEADINGS, Math.floor(budget * 0.86), 10, false),
    document.slice(-Math.min(12_000, Math.floor(budget * 0.10))),
  ], budget));
}

export function buildAgentInput(agent: AgentName, text: string): string {
  const totalChars = agent === "financials" ? 145_000
    : agent === "historian" ? 110_000
      : agent === "market" || agent === "profiler" ? 105_000
        : agent === "risks" ? 100_000
          : 90_000;
  const documents = splitDocuments(text);
  return proportionalJoin(documents, totalChars, (document, budget) => buildSingleAgentInput(agent, document, budget));
}

function requireConfigured(): void {
  if (!process.env.OPENAI_API_KEY) throw new AiMisconfigured("OPENAI_API_KEY is not configured");
}

async function model(stage: AgentName | "metadata"): Promise<LanguageModel> {
  requireConfigured();
  return filingModel(stage);
}

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
      ? `\n## Confirmed filing context\n- Jurisdiction: ${context.jurisdiction}\n- Filing type: ${context.filingType}\nApply the matching regulator and filing-type contract. For filing bundles, reconcile the documents without inventing values; prefer the most specific filing disclosure and retain period labels.\n`
      : "";
    const res = await withModelExecution(agent, async signal => generateObject({
      model: await model(agent),
      schema,
      system: AGENTS[agent].system(market) + contextPrompt,
      messages: [{ role: "user", content: text }],
      providerOptions: openAIProviderOptions(
        agent,
        AGENTS[agent].maxTokens,
        agent === "market" ? "low" : undefined,
      ),
      maxRetries: 0,
      abortSignal: signal,
    }));
    console.log(`[agent:${agent}] OK in ${((Date.now() - t0) / 1000).toFixed(0)}s, tokens=${res.usage?.totalTokens}`);
    return res.object;
  } catch (err) {
    const mapped = classifyAiError(err);
    console.warn(`[agent:${agent}] failed:`, mapped.name, mapped.message);
    throw mapped;
  }
}

export async function runMetadataAgent(market: Market, text: string, schema: z.ZodTypeAny): Promise<any> {
  try {
    const t0 = Date.now();
    const res = await withModelExecution("metadata", async signal => generateObject({
      model: await model("metadata"),
      schema,
      system: METADATA_AGENT.system(market),
      messages: [{ role: "user", content: buildMetadataInput(text) }],
      providerOptions: openAIProviderOptions("metadata", METADATA_AGENT.maxTokens),
      maxRetries: 0,
      abortSignal: signal,
    }));
    console.log(`[agent:metadata] OK in ${((Date.now() - t0) / 1000).toFixed(0)}s, tokens=${res.usage?.totalTokens}`);
    return res.object;
  } catch (err) {
    const mapped = classifyAiError(err);
    console.warn("[agent:metadata] failed:", mapped.name, mapped.message);
    throw mapped;
  }
}
