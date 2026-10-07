import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { MarketResult } from "../contracts/analysis";
import { filingModel, marketWebSearchTool, openAIProviderOptions } from "./ai/provider";
import { marketResearchRuntimeMethodology } from "./market-research-skill";

const peerSchema = z.object({
  name: z.string().min(1).max(100),
  relationship: z.string().min(1).max(240),
  positioning: z.string().min(1).max(320),
  strengths: z.array(z.string().min(1).max(180)).max(3),
  vulnerabilities: z.array(z.string().min(1).max(180)).max(3),
  url: z.string(),
});

const peerDiscoveryOutput = z.object({
  peers: z.array(peerSchema).max(8),
});

const webResearchOutput = z.object({
  peers: z.array(peerSchema).max(8),
  findings: z.array(z.object({
    insight: z.string().min(1).max(360),
    implication: z.string().min(1).max(360),
    url: z.string(),
  })).max(8),
  marketShareProxies: z.array(z.object({
    label: z.string().min(1).max(160),
    valuePercent: z.number().min(0).max(100),
    numerator: z.number().nonnegative(),
    denominator: z.number().positive(),
    unit: z.string().min(1).max(60),
    period: z.string().min(1).max(80),
    geography: z.string().min(1).max(80),
    productScope: z.string().min(1).max(160),
    basis: z.string().min(1).max(420),
    url: z.string(),
  })).max(4),
  marketStructure: z.object({
    summary: z.string().min(1).max(420),
    hhi: z.number().nullable().optional(),
    basis: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  }).optional(),
});

type CompetitiveResearchOutput = z.infer<typeof webResearchOutput>;
type PeerDiscoveryOutput = z.infer<typeof peerDiscoveryOutput>;
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

function verifyPeersWithProfiles(
  peers: PeerDiscoveryOutput["peers"],
  sources: Array<{ url: string; title?: string }>,
  accessed = new Date().toISOString().slice(0, 10),
) {
  const citedSources = citedSourceMap(sources);
  const seen = new Set<string>();
  const peerEvidence: NonNullable<MarketResult["market"]["peerEvidence"]> = [];
  const peerProfiles: NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"] = [];

  for (const peer of peers) {
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
  return { peerEvidence, peerProfiles };
}

export function verifyCompetitiveResearch(
  output: CompetitiveResearchOutput,
  sources: Array<{ url: string; title?: string }>,
  accessed = new Date().toISOString().slice(0, 10),
): {
  peerEvidence: NonNullable<MarketResult["market"]["peerEvidence"]>;
  competitiveAnalysis: NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
} {
  const { peerEvidence, peerProfiles } = verifyPeersWithProfiles(output.peers, sources, accessed);
  const citedSources = citedSourceMap(sources);

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

  const marketShareProxies: NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["marketShareProxies"]> = [];
  for (const proxy of output.marketShareProxies) {
    const source = evidenceFrom(proxy.url, citedSources, accessed);
    if (!source || proxy.denominator <= 0 || proxy.numerator < 0) continue;
    const recomputed = (proxy.numerator / proxy.denominator) * 100;
    if (Math.abs(recomputed - proxy.valuePercent) > 0.15) continue;
    marketShareProxies.push({
      label: proxy.label.trim(),
      valuePercent: Number(recomputed.toFixed(2)),
      numerator: proxy.numerator,
      denominator: proxy.denominator,
      unit: proxy.unit.trim(),
      period: proxy.period.trim(),
      geography: proxy.geography.trim(),
      productScope: proxy.productScope.trim(),
      basis: proxy.basis.trim(),
      source,
    });
    if (marketShareProxies.length === 4) break;
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
      ...(marketShareProxies.length ? { marketShareProxies } : {}),
      ...(marketStructure ? { marketStructure } : {}),
    },
  };
}

function citedUrls(result: { sources: Array<{ sourceType: string; url?: string; title?: string }> }) {
  return result.sources
    .filter(source => source.sourceType === "url" && typeof source.url === "string")
    .map(source => ({ url: source.url as string, title: source.title }));
}

function researchSystem(methodology: string) {
  return [
    "You are a cautious institutional competitive-intelligence researcher executing the exact market-research-brief analytical framework loaded by FilingLens.",
    "Use web search now; do not answer from memory. The uploaded filing is authoritative for issuer identity and business scope. External sources are used to independently map the current competitive landscape.",
    "A direct peer must overlap materially with the issuer in product/service, customer set, geography, asset type, or operating segment. For diversified issuers, segment peers are valid when the relationship is clearly stated; do not require identical conglomerate structures.",
    "Apply the skill's competitive-analysis and data-to-insight modules: identify direct peers, characterize positioning, surface source-supported strengths/vulnerabilities, compare against a benchmark, and keep only decision-useful findings that pass the 'so what?' test.",
    "Prefer government/regulator data, official company investor-relations pages and filings, exchanges, industry associations, then high-quality research sources, in that order.",
    "Actively search for a public, auditable way to estimate issuer market share. Prefer regulator/open-data datasets; otherwise use a close public proxy only when numerator and denominator use the same period, geography and product basis.",
    "For any market-share proxy, return the raw numerator and denominator and let the application recompute the percentage. Never infer a denominator from narrative language.",
    "Do not manufacture TAM, concentration, CR3/CR5 or HHI. Calculate concentration only when cited share data are sufficient.",
    "Every peer, finding, market-share proxy, and market-structure claim must carry the exact HTTPS URL actually returned by web search. Omit claims with ambiguous evidence.",
    "Do not provide investment recommendations, target prices, or uncited financial figures.",
    "",
    "Loaded market-research-brief framework:",
    methodology,
  ].join("\n");
}

async function peerOnlyRecovery(input: {
  jurisdiction: "us" | "br";
  issuerName: string;
  ticker?: string | null;
  industry: string;
  businessDescription?: string | null;
  filingExcerpt: string;
  methodology: string;
}) {
  const result = await generateText({
    model: filingModel("market"),
    output: Output.object({ schema: peerDiscoveryOutput }),
    tools: { web_search: marketWebSearchTool() as never },
    stopWhen: stepCountIs(2),
    maxRetries: 0,
    maxOutputTokens: 4_500,
    providerOptions: openAIProviderOptions("market", 7_500, "low"),
    system: [
      researchSystem(input.methodology),
      "RECOVERY MODE: return peers only. Keep each field concise so the JSON always completes. Find 3-6 verified direct or segment peers before doing anything else.",
    ].join("\n\n"),
    prompt: [
      `Jurisdiction: ${input.jurisdiction === "br" ? "Brazil / CVM" : "United States / SEC"}`,
      `Issuer: ${input.issuerName || "not identified"}`,
      `Ticker: ${input.ticker || "not available"}`,
      `Filing-described industry: ${input.industry || "not identified"}`,
      `Business description: ${input.businessDescription || "not separately available"}`,
      "",
      "Filing excerpt for business-scope disambiguation:",
      input.filingExcerpt.slice(0, 10_000),
      "",
      "Return 3-6 source-verified direct or segment peers. Do not return market commentary outside the schema.",
    ].join("\n"),
  });

  const { peerEvidence, peerProfiles } = verifyPeersWithProfiles(result.output.peers, citedUrls(result));
  return {
    peerEvidence,
    competitiveAnalysis: {
      status: peerProfiles.length >= 2 ? "partial" as const : "no_citable_results" as const,
      methodology: "market-research-brief" as const,
      peerProfiles,
      findings: [],
    },
  };
}

export async function researchCompetitiveLandscape(input: {
  jurisdiction: "us" | "br";
  issuerName: string;
  ticker?: string | null;
  industry: string;
  businessDescription?: string | null;
  filingExcerpt: string;
}): Promise<{
  peerEvidence: NonNullable<MarketResult["market"]["peerEvidence"]>;
  competitiveAnalysis: NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
}> {
  const methodology = marketResearchRuntimeMethodology();

  try {
    const result = await generateText({
      model: filingModel("market"),
      output: Output.object({ schema: webResearchOutput }),
      tools: { web_search: marketWebSearchTool() as never },
      stopWhen: stepCountIs(3),
      maxRetries: 0,
      maxOutputTokens: 8_000,
      providerOptions: openAIProviderOptions("market", 12_000, "low"),
      system: researchSystem(methodology),
      prompt: [
        `Jurisdiction: ${input.jurisdiction === "br" ? "Brazil / CVM" : "United States / SEC"}`,
        `Issuer: ${input.issuerName || "not identified"}`,
        `Ticker: ${input.ticker || "not available"}`,
        `Filing-described industry: ${input.industry || "not identified"}`,
        `Business description: ${input.businessDescription || "not separately available"}`,
        "",
        "Filing excerpt for identity and business context only:",
        input.filingExcerpt.slice(0, 12_000),
        "",
        "Produce a source-verified competitive landscape with 3-6 direct or segment peers, up to 5 concise insight → implication findings, and public market-share evidence when defensible.",
      ].join("\n"),
    });

    const verified = verifyCompetitiveResearch(result.output, citedUrls(result));
    if (verified.peerEvidence.length > 0) return verified;

    console.warn("[market-research] full research returned no verified peers; running peer-only recovery");
    return await peerOnlyRecovery({ ...input, methodology });
  } catch (error) {
    console.warn("[market-research] full structured research failed; running peer-only recovery", error);
    return await peerOnlyRecovery({ ...input, methodology });
  }
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
