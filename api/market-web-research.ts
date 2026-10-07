import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { MarketResult } from "../contracts/analysis";
import { filingModel, marketWebSearchTool, openAIProviderOptions } from "./ai/provider";

const webResearchOutput = z.object({
  peers: z.array(z.object({
    name: z.string().min(1).max(100),
    relationship: z.string().min(1).max(240),
    positioning: z.string().min(1).max(320),
    strengths: z.array(z.string().min(1).max(180)).max(3),
    vulnerabilities: z.array(z.string().min(1).max(180)).max(3),
    url: z.string(),
  })).max(8),
  findings: z.array(z.object({
    insight: z.string().min(1).max(360),
    implication: z.string().min(1).max(360),
    url: z.string(),
  })).max(8),
  marketStructure: z.object({
    summary: z.string().min(1).max(420),
    hhi: z.number().nullable().optional(),
    basis: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
});

type CompetitiveResearchOutput = z.infer<typeof webResearchOutput>;
type ResearchPeer = { name: string; url: string; reason?: string };

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    url.search = "";
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

function citedSourceMap(sources: Array<{ url: string; title?: string }>) {
  const citedSources = new Map<string, { url: string; title?: string }>();
  for (const source of sources) {
    const key = canonicalUrl(source.url);
    if (key) citedSources.set(key, source);
  }
  return citedSources;
}

function evidenceFrom(
  url: string,
  citedSources: Map<string, { url: string; title?: string }>,
  accessed: string,
) {
  const key = canonicalUrl(url);
  if (!key) return null;
  const cited = citedSources.get(key);
  if (!cited) return null;
  let publisher = cited.title?.trim();
  try {
    publisher ||= new URL(cited.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return {
    section: "Independent competitive research",
    kind: "citation" as const,
    url: cited.url,
    publisher,
    accessed,
  };
}

/** Backward-compatible peer verifier retained for deterministic unit tests. */
export function verifyMarketResearchPeers(
  peers: ResearchPeer[],
  sources: Array<{ url: string; title?: string }>,
  accessed = new Date().toISOString().slice(0, 10),
): NonNullable<MarketResult["market"]["peerEvidence"]> {
  const citedSources = citedSourceMap(sources);
  const seen = new Set<string>();
  const verified: NonNullable<MarketResult["market"]["peerEvidence"]> = [];
  for (const peer of peers) {
    const name = peer.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    const source = evidenceFrom(peer.url, citedSources, accessed);
    if (!source) continue;
    seen.add(name.toLowerCase());
    verified.push({ name, sourceType: "external", source });
    if (verified.length === 8) break;
  }
  return verified;
}

export function verifyCompetitiveResearch(
  output: CompetitiveResearchOutput,
  sources: Array<{ url: string; title?: string }>,
  accessed = new Date().toISOString().slice(0, 10),
): {
  peerEvidence: NonNullable<MarketResult["market"]["peerEvidence"]>;
  competitiveAnalysis: NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
} {
  const citedSources = citedSourceMap(sources);
  const seen = new Set<string>();
  const peerEvidence: NonNullable<MarketResult["market"]["peerEvidence"]> = [];
  const peerProfiles: NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"] = [];

  for (const peer of output.peers) {
    const name = peer.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    const source = evidenceFrom(peer.url, citedSources, accessed);
    if (!source) continue;
    seen.add(name.toLowerCase());
    peerEvidence.push({ name, sourceType: "external", source });
    peerProfiles.push({
      name,
      relationship: peer.relationship.trim(),
      positioning: peer.positioning.trim(),
      strengths: peer.strengths.map(item => item.trim()).filter(Boolean).slice(0, 3),
      vulnerabilities: peer.vulnerabilities.map(item => item.trim()).filter(Boolean).slice(0, 3),
      source,
    });
    if (peerProfiles.length === 8) break;
  }

  const findings: NonNullable<MarketResult["market"]["competitiveAnalysis"]>["findings"] = [];
  for (const finding of output.findings) {
    const source = evidenceFrom(finding.url, citedSources, accessed);
    if (!source) continue;
    findings.push({
      insight: finding.insight.trim(),
      implication: finding.implication.trim(),
      source,
    });
    if (findings.length === 8) break;
  }

  let marketStructure: NonNullable<MarketResult["market"]["competitiveAnalysis"]>["marketStructure"];
  if (output.marketStructure?.url) {
    const source = evidenceFrom(output.marketStructure.url, citedSources, accessed);
    if (source) {
      marketStructure = {
        summary: output.marketStructure.summary.trim(),
        hhi: output.marketStructure.hhi ?? null,
        basis: output.marketStructure.basis?.trim() || null,
        source,
      };
    }
  }

  const status = peerProfiles.length || findings.length || marketStructure
    ? (peerProfiles.length >= 2 && findings.length >= 1 ? "complete" : "partial")
    : "no_citable_results";

  return {
    peerEvidence,
    competitiveAnalysis: {
      status,
      methodology: "market-research-brief",
      peerProfiles,
      findings,
      ...(marketStructure ? { marketStructure } : {}),
    },
  };
}

export async function researchCompetitiveLandscape(input: {
  jurisdiction: "us" | "br";
  issuerName: string;
  ticker?: string | null;
  industry: string;
  filingExcerpt: string;
}): Promise<{
  peerEvidence: NonNullable<MarketResult["market"]["peerEvidence"]>;
  competitiveAnalysis: NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
}> {
  const result = await generateText({
    model: filingModel("market"),
    output: Output.object({ schema: webResearchOutput }),
    tools: { web_search: marketWebSearchTool() as never },
    stopWhen: stepCountIs(4),
    maxRetries: 0,
    maxOutputTokens: 3_200,
    providerOptions: openAIProviderOptions("market"),
    system: [
      "You are a cautious institutional competitive-intelligence researcher using the market-research-brief methodology supplied to FilingLens.",
      "Use web search now; do not answer from memory. The uploaded filing is authoritative for issuer identity, while external sources are used to independently map the current competitive landscape.",
      "Apply the competition module: identify direct peers, characterize positioning, surface source-supported strengths and vulnerabilities, and synthesize only decision-useful findings that pass a concise 'so what?' test.",
      "Prefer regulator filings, official company investor-relations pages, exchanges, industry associations, and high-quality research sources.",
      "Do not manufacture market shares, TAM, concentration, or HHI. Return hhi only when the cited source provides sufficient market-share evidence; otherwise use null and describe the market structure qualitatively.",
      "Every peer, finding, and market-structure claim must carry the exact HTTPS URL that the web-search tool actually cited. Claims with ambiguous evidence should be omitted.",
      "Do not provide investment recommendations, target prices, or uncited financial figures.",
    ].join(" "),
    prompt: [
      `Jurisdiction: ${input.jurisdiction === "br" ? "Brazil / CVM" : "United States / SEC"}`,
      `Issuer: ${input.issuerName || "not identified"}`,
      `Ticker: ${input.ticker || "not available"}`,
      `Filing-described industry: ${input.industry || "not identified"}`,
      "",
      "Filing excerpt for identity and business context only:",
      input.filingExcerpt.slice(0, 18_000),
      "",
      "Produce a source-verified competitive landscape with up to 8 direct peers and up to 8 concise insight → implication findings.",
    ].join("\n"),
  });

  return verifyCompetitiveResearch(
    result.output,
    result.sources
      .filter(source => source.sourceType === "url")
      .map(source => ({ url: source.url, title: source.title })),
  );
}

/** Compatibility wrapper used by older callers. */
export async function researchMarketPeers(input: {
  jurisdiction: "us" | "br";
  industry: string;
  filingExcerpt: string;
}): Promise<NonNullable<MarketResult["market"]["peerEvidence"]>> {
  const result = await researchCompetitiveLandscape({
    ...input,
    issuerName: "",
  });
  return result.peerEvidence;
}
