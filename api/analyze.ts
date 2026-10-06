import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";
import pdfParse from "./pdf";
import { filingModel, openAIProviderOptions } from "./ai/provider";
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

function findSectionStart(text: string, patterns: RegExp[]): number {
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) return m.index;
  }
  return -1;
}

function surrounding(text: string, patterns: RegExp[], radius = 10_000): string {
  const start = findSectionStart(text, patterns);
  if (start < 0) return "";
  return text.slice(Math.max(0, start - 1000), Math.min(text.length, start + radius));
}

export function createAnalysisCorpus(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  const chunks = [
    text.slice(0, 45_000),
    surrounding(text, BR_FINANCIAL_HEADINGS, 55_000),
    surrounding(text, BR_RISK_HEADINGS, 30_000),
    surrounding(text, BR_MARKET_HEADINGS, 30_000),
    surrounding(text, SEC_SECTION_HEADINGS, 55_000),
    surrounding(text, EVENT_HEADINGS, 25_000),
    text.slice(-25_000),
  ].filter(Boolean);
  return Array.from(new Set(chunks)).join("\n\n").slice(0, MAX_TEXT_CHARS);
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
  const perDocument = Math.max(8_000, Math.floor(totalChars / Math.max(1, documents.length)));
  return documents
    .map((document, index) => `## Filing bundle document ${index + 1}\n${build(document, perDocument)}`)
    .filter(Boolean)
    .join("\n\n")
    .slice(0, totalChars);
}

export function buildMetadataInput(text: string): string {
  const documents = splitDocuments(text);
  return proportionalJoin(documents, 50_000, (document, budget) => document.slice(0, budget));
}

function buildSingleAgentInput(agent: AgentName, text: string, budget: number): string {
  const first = text.slice(0, Math.min(12_000, Math.max(6_000, Math.floor(budget * 0.22))));
  const cap = (parts: string[]) => parts.filter(Boolean).join("\n\n").slice(0, budget);
  switch (agent) {
    case "financials":
      return cap([first, surrounding(text, BR_FINANCIAL_HEADINGS, Math.floor(budget * 0.68)), surrounding(text, [/item\s+8\.?\s+financial\s+statements/i], Math.floor(budget * 0.68))]);
    case "risks":
      return cap([first, surrounding(text, BR_RISK_HEADINGS, Math.floor(budget * 0.72)), surrounding(text, [/item\s+1a\.?\s+risk\s+factors/i], Math.floor(budget * 0.72))]);
    case "market":
    case "profiler":
      return cap([first, surrounding(text, BR_MARKET_HEADINGS, Math.floor(budget * 0.68)), surrounding(text, [/item\s+1\.?\s+business/i], Math.floor(budget * 0.68))]);
    case "historian":
      return cap([first, surrounding(text, EVENT_HEADINGS, Math.floor(budget * 0.62)), text.slice(-Math.min(10_000, Math.floor(budget * 0.2)))]);
    case "synthesizer":
      return text.slice(0, budget);
    default:
      return text.slice(0, budget);
  }
}

export function buildAgentInput(agent: AgentName, text: string): string {
  const totalChars = agent === "financials" ? 120_000
    : agent === "historian" ? 100_000
      : agent === "market" || agent === "profiler" ? 90_000
        : agent === "risks" ? 85_000
          : 80_000;
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
    const res = await generateObject({
      model: await model(agent),
      schema,
      system: AGENTS[agent].system(market) + contextPrompt,
      messages: [{ role: "user", content: text }],
      providerOptions: openAIProviderOptions(agent, AGENTS[agent].maxTokens),
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

export async function runMetadataAgent(market: Market, text: string, schema: z.ZodTypeAny): Promise<any> {
  try {
    const t0 = Date.now();
    const res = await generateObject({
      model: await model("metadata"),
      schema,
      system: METADATA_AGENT.system(market),
      messages: [{ role: "user", content: buildMetadataInput(text) }],
      providerOptions: openAIProviderOptions("metadata", METADATA_AGENT.maxTokens),
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
