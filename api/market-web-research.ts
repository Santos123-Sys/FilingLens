import { safeErrorName, withModelExecution } from "./ai/execution";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { MarketResult } from "../contracts/analysis";
import { filingModel, marketWebSearchTool, openAIProviderOptions } from "./ai/provider";
import { marketResearchRuntimeMethodology } from "./market-research-skill";
import { crosscheckCompetitiveFacts } from "./peer-sec-crosscheck";
import { crosscheckCvmPeers } from "./cvm-peer-crosscheck";

/**
 * Wire schemas are intentionally permissive for narrative length. The model is a
 * probabilistic candidate generator; hard UI-length limits belong in deterministic
 * post-processing. Rejecting an otherwise well-sourced research object because one
 * summary is 421 characters is a reliability bug, not a data-quality safeguard.
 */
const peerWireSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  positioning: z.string().min(1),
  cnpj: z.string().optional(),
  strengths: z.array(z.string()),
  vulnerabilities: z.array(z.string()),
  dataPoints: z.array(z.object({
    label: z.string().min(1),
    value: z.string().min(1),
    period: z.string().min(1),
    context: z.string().min(1),
    url: z.string(),
  })).optional(),
  moatAssessment: z.object({
    rating: z.enum(["strong", "moderate", "limited", "unclear"]),
    summary: z.string().min(1),
    evidence: z.array(z.object({
      dimension: z.string().min(1),
      assessment: z.string().min(1),
      url: z.string(),
    })),
    counterEvidence: z.array(z.object({
      dimension: z.string().min(1),
      challenge: z.string().min(1),
      url: z.string(),
    })).optional(),
  }).nullable().optional(),
  outlook: z.object({
    stance: z.enum(["favorable", "mixed", "challenged", "unclear"]),
    horizon: z.string().min(1),
    summary: z.string().min(1),
    drivers: z.array(z.string()),
    risks: z.array(z.string()),
    url: z.string(),
  }).nullable().optional(),
  url: z.string(),
});

const peerDiscoveryOutput = z.object({
  peers: z.array(peerWireSchema),
});

const webResearchOutput = z.object({
  peers: z.array(peerWireSchema),
  findings: z.array(z.object({
    insight: z.string().min(1),
    implication: z.string().min(1),
    url: z.string(),
  })),
  marketShareProxies: z.array(z.object({
    label: z.string().min(1),
    valuePercent: z.number().min(0).max(100),
    numerator: z.number().nonnegative(),
    denominator: z.number().positive(),
    unit: z.string().min(1),
    period: z.string().min(1),
    geography: z.string().min(1),
    productScope: z.string().min(1),
    basis: z.string().min(1),
    url: z.string(),
  })),
  marketStructure: z.object({
    summary: z.string().min(1),
    hhi: z.number().nullable().optional(),
    basis: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  }).nullable().optional(),
});

type CompetitiveResearchOutput = z.infer<typeof webResearchOutput>;
type PeerDiscoveryOutput = z.infer<typeof peerDiscoveryOutput>;
type ResearchPeer = { name: string; url: string; reason?: string };
type CitedSource = { url: string; title?: string };

function cleanNarrative(value: string | null | undefined, max = 900): string {
  if (!value) return "";
  const cleaned = value
    // The evidence URL is carried separately. Keeping generated Markdown citations
    // inside prose creates duplicate URLs and was the cause of a production
    // marketStructure.summary length failure.
    .replace(/\s*\(\[[^\]]{1,160}\]\(https?:\/\/[^)]+\)\)\s*/gi, " ")
    .replace(/\[[^\]]{1,160}\]\(https?:\/\/[^)]+\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  const head = cleaned.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "), head.lastIndexOf(": "));
  return `${head.slice(0, sentence > Math.floor(max * 0.55) ? sentence + 1 : max).trim()}…`;
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let pathname = url.pathname.replace(/\/{2,}/g, "/");
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep the encoded path when malformed percent escapes are present.
    }
    pathname = pathname.replace(/\/index\.html?$/i, "").replace(/\/$/, "") || "/";
    return `${host}${pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

function citedSourceMap(sources: CitedSource[]) {
  const citedSources = new Map<string, CitedSource>();
  for (const source of sources) {
    const key = canonicalUrl(source.url);
    if (key) citedSources.set(key, source);
  }
  return citedSources;
}

function evidenceFrom(
  url: string,
  citedSources: Map<string, CitedSource>,
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

function sourceQuality(url: string): number {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host.endsWith(".gov") || host.includes(".gov.") || host.includes("sec.gov") || host.includes("cvm.gov.br")) return 30;
    if (host.includes("b3.com.br") || host.includes("nasdaq.com") || host.includes("nyse.com")) return 28;
    if (host.startsWith("ir.") || host.includes("investor") || host.includes("investors")) return 24;
    return 16;
  } catch {
    return 0;
  }
}

function relationshipQuality(text: string): number {
  const value = text.toLowerCase();
  let score = 18;
  if (/\bdirect\b/.test(value)) score = 52;
  else if (/\bsegment\b|same (?:market|product|customer)|overlap|compete/.test(value)) score = 42;
  else if (/adjacent|broad|partial/.test(value)) score = 24;
  if (/not (?:an? )?(?:automotive|direct|core)?\s*peer|only at the broad|does not establish comparable/.test(value)) score -= 18;
  return Math.max(0, score);
}

function peerScore(peer: PeerDiscoveryOutput["peers"][number], sourceUrl: string): number {
  return relationshipQuality(`${peer.relationship} ${peer.positioning}`) + sourceQuality(sourceUrl);
}

/** Backward-compatible peer verifier retained for deterministic unit tests. */
export function verifyMarketResearchPeers(
  peers: ResearchPeer[],
  sources: CitedSource[],
  accessed = new Date().toISOString().slice(0, 10),
): NonNullable<MarketResult["market"]["peerEvidence"]> {
  const citedSources = citedSourceMap(sources);
  const seen = new Set<string>();
  const verified: NonNullable<MarketResult["market"]["peerEvidence"]> = [];
  for (const peer of peers) {
    const name = cleanNarrative(peer.name, 140);
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
  sources: CitedSource[],
  accessed = new Date().toISOString().slice(0, 10),
) {
  const citedSources = citedSourceMap(sources);
  const seen = new Set<string>();
  const accepted: Array<{
    score: number;
    evidence: NonNullable<MarketResult["market"]["peerEvidence"]>[number];
    profile: NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"][number];
  }> = [];
  let droppedDeepClaims = 0;

  for (const peer of peers) {
    const name = cleanNarrative(peer.name, 140);
    if (!name || seen.has(name.toLowerCase())) continue;
    const source = evidenceFrom(peer.url, citedSources, accessed);
    if (!source) continue;
    seen.add(name.toLowerCase());

    const candidateDataPoints = peer.dataPoints ?? [];
    const dataPoints = candidateDataPoints.slice(0, 10).flatMap(point => {
      const pointSource = evidenceFrom(point.url, citedSources, accessed);
      const label = cleanNarrative(point.label, 120);
      const value = cleanNarrative(point.value, 120);
      const period = cleanNarrative(point.period, 80);
      const context = cleanNarrative(point.context, 280);
      return pointSource && label && value && period && context
        ? [{ label, value, period, context, source: pointSource }]
        : [];
    }).slice(0, 6);
    droppedDeepClaims += Math.max(0, candidateDataPoints.length - dataPoints.length);

    const moatEvidence = (peer.moatAssessment?.evidence ?? []).slice(0, 8).flatMap(item => {
      const itemSource = evidenceFrom(item.url, citedSources, accessed);
      const dimension = cleanNarrative(item.dimension, 100);
      const assessment = cleanNarrative(item.assessment, 360);
      return itemSource && dimension && assessment
        ? [{ dimension, assessment, source: itemSource }]
        : [];
    }).slice(0, 5);
    droppedDeepClaims += Math.max(0, (peer.moatAssessment?.evidence.length ?? 0) - moatEvidence.length);
    const counterEvidence = (peer.moatAssessment?.counterEvidence ?? []).slice(0,8).flatMap(item=>{
      const itemSource=evidenceFrom(item.url,citedSources,accessed);
      const dimension=cleanNarrative(item.dimension,100);
      const challenge=cleanNarrative(item.challenge,360);
      return itemSource&&dimension&&challenge?[{dimension,challenge,source:itemSource}]:[];
    }).slice(0,5);
    droppedDeepClaims += Math.max(0,(peer.moatAssessment?.counterEvidence?.length??0)-counterEvidence.length);
    const moatAssessment = peer.moatAssessment && moatEvidence.length
      ? {
          rating: peer.moatAssessment.rating,
          confidence: (moatEvidence.length >= 3 && counterEvidence.length >= 1 ? "high" :
            moatEvidence.length >= 2 && counterEvidence.length >= 1 ? "medium" : "low") as "high" | "medium" | "low",
          summary: cleanNarrative(peer.moatAssessment.summary, 600),
          evidence: moatEvidence,
          ...(counterEvidence.length?{counterEvidence}:{}),
        }
      : undefined;
    if (peer.moatAssessment && !moatAssessment) droppedDeepClaims += 1;

    const outlookSource = peer.outlook ? evidenceFrom(peer.outlook.url, citedSources, accessed) : null;
    const outlook = peer.outlook && outlookSource
      ? {
          stance: peer.outlook.stance,
          horizon: cleanNarrative(peer.outlook.horizon, 80),
          summary: cleanNarrative(peer.outlook.summary, 600),
          drivers: peer.outlook.drivers.map(item => cleanNarrative(item, 260)).filter(Boolean).slice(0, 4),
          risks: peer.outlook.risks.map(item => cleanNarrative(item, 260)).filter(Boolean).slice(0, 4),
          source: outlookSource,
        }
      : undefined;
    if (peer.outlook && !outlook) droppedDeepClaims += 1;

    accepted.push({
      score: peerScore(peer, source.url ?? peer.url),
      evidence: { name, sourceType: "external", source },
      profile: {
        name,
        ...(peer.cnpj && /^\d{14}$/.test(peer.cnpj.replace(/\D/g,""))
          ? {candidateCnpj:peer.cnpj.replace(/\D/g,"")} : {}),
        relationship: cleanNarrative(peer.relationship, 480),
        positioning: cleanNarrative(peer.positioning, 700),
        strengths: peer.strengths.map(item => cleanNarrative(item, 360)).filter(Boolean).slice(0, 3),
        vulnerabilities: peer.vulnerabilities.map(item => cleanNarrative(item, 360)).filter(Boolean).slice(0, 3),
        ...(dataPoints.length ? { dataPoints } : {}),
        ...(moatAssessment?.summary ? { moatAssessment } : {}),
        ...(outlook?.summary && outlook.horizon ? { outlook } : {}),
        source,
      },
    });
  }

  accepted.sort((a, b) => b.score - a.score || a.profile.name.localeCompare(b.profile.name));
  const top = accepted.slice(0, 8);
  return {
    peerEvidence: top.map(item => item.evidence),
    peerProfiles: top.map(item => item.profile),
    droppedPeers: Math.max(0, peers.length - top.length),
    droppedDeepClaims,
  };
}

export function verifyCompetitiveResearch(
  output: CompetitiveResearchOutput,
  sources: CitedSource[],
  accessed = new Date().toISOString().slice(0, 10),
  recoveryUsed = false,
): {
  peerEvidence: NonNullable<MarketResult["market"]["peerEvidence"]>;
  competitiveAnalysis: NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
} {
  const { peerEvidence, peerProfiles, droppedPeers, droppedDeepClaims } = verifyPeersWithProfiles(output.peers.slice(0, 16), sources, accessed);
  const citedSources = citedSourceMap(sources);

  const findings: NonNullable<MarketResult["market"]["competitiveAnalysis"]>["findings"] = [];
  for (const finding of output.findings.slice(0, 12)) {
    const source = evidenceFrom(finding.url, citedSources, accessed);
    if (!source) continue;
    const insight = cleanNarrative(finding.insight, 720);
    const implication = cleanNarrative(finding.implication, 600);
    if (!insight || !implication) continue;
    findings.push({ insight, implication, source });
    if (findings.length === 8) break;
  }

  const marketShareProxies: NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["marketShareProxies"]> = [];
  for (const proxy of output.marketShareProxies.slice(0, 8)) {
    const source = evidenceFrom(proxy.url, citedSources, accessed);
    if (!source || proxy.denominator <= 0 || proxy.numerator < 0) continue;
    const recomputed = (proxy.numerator / proxy.denominator) * 100;
    if (Math.abs(recomputed - proxy.valuePercent) > 0.15) continue;
    marketShareProxies.push({
      label: cleanNarrative(proxy.label, 220),
      valuePercent: Number(recomputed.toFixed(2)),
      numerator: proxy.numerator,
      denominator: proxy.denominator,
      unit: cleanNarrative(proxy.unit, 80),
      period: cleanNarrative(proxy.period, 100),
      geography: cleanNarrative(proxy.geography, 120),
      productScope: cleanNarrative(proxy.productScope, 260),
      basis: cleanNarrative(proxy.basis, 700),
      source,
    });
    if (marketShareProxies.length === 4) break;
  }

  let marketStructure: NonNullable<MarketResult["market"]["competitiveAnalysis"]>["marketStructure"];
  if (output.marketStructure?.url) {
    const source = evidenceFrom(output.marketStructure.url, citedSources, accessed);
    if (source) {
      marketStructure = {
        summary: cleanNarrative(output.marketStructure.summary, 900),
        hhi: output.marketStructure.hhi ?? null,
        basis: cleanNarrative(output.marketStructure.basis, 700) || null,
        source,
      };
    }
  }

  const deepDivePeers = peerProfiles.filter(
    peer => (peer.dataPoints?.length ?? 0) > 0 && peer.moatAssessment && peer.outlook,
  ).length;
  const status = peerProfiles.length || findings.length || marketStructure
    ? (peerProfiles.length >= 2 && findings.length >= 1 && deepDivePeers >= 2 ? "complete" : "partial")
    : "no_citable_results";
  const droppedClaims = droppedPeers
    + droppedDeepClaims
    + Math.max(0, output.findings.length - findings.length)
    + Math.max(0, output.marketShareProxies.length - marketShareProxies.length)
    + (output.marketStructure && !marketStructure ? 1 : 0);

  return {
    peerEvidence,
    competitiveAnalysis: {
      status,
      methodology: "market-research-brief",
      peerProfiles,
      findings,
      ...(marketShareProxies.length ? { marketShareProxies } : {}),
      ...(marketStructure ? { marketStructure } : {}),
      researchDiagnostics: {
        candidatePeers: output.peers.length,
        verifiedPeers: peerProfiles.length,
        deepDivePeers,
        citedSources: new Set(sources.map(source => canonicalUrl(source.url)).filter(Boolean)).size,
        droppedClaims,
        recoveryUsed,
        strategy: "deterministic-citation-ranking-v1",
      },
    },
  };
}

function citedUrls(result: { sources: Array<{ sourceType: string; url?: string; title?: string }> }): CitedSource[] {
  const seen = new Set<string>();
  const out: CitedSource[] = [];
  for (const source of result.sources) {
    if (source.sourceType !== "url" || typeof source.url !== "string") continue;
    const key = canonicalUrl(source.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ url: source.url, title: source.title });
  }
  return out;
}

function researchSystem(methodology: string) {
  return [
    "You are a cautious institutional competitive-intelligence researcher executing the exact market-research-brief analytical framework loaded by FilingLens.",
    "Use web search now; do not answer from memory. The uploaded filing is authoritative for issuer identity and business scope. External sources are used to independently map the current competitive landscape.",
    "A direct peer must overlap materially with the issuer in product/service, customer set, geography, asset type, or operating segment. For diversified issuers, segment peers are valid when the relationship is clearly stated; do not require identical conglomerate structures.",
    "Apply the skill's competitive-analysis and data-to-insight modules: identify direct peers, characterize positioning, surface source-supported strengths/vulnerabilities, compare against a benchmark, and keep only decision-useful findings that pass the 'so what?' test.",
    "For each peer, perform a compact deep dive: capture 3-6 material financial or operating data points with period and context; assess the competitive moat across evidence-backed dimensions such as scale, cost position, switching costs, network effects, brand, distribution, scarce assets, regulation, IP or data; and give a 12-24 month competitive outlook with drivers and risks.",
    "Moat ratings and outlook stances are analytical assessments, not company-reported facts or investment recommendations. Use 'unclear' when evidence is insufficient and do not force a moat conclusion.",
    "For every asserted moat, search for counter-evidence of durability erosion (customer churn, competitor scale, pricing pressure, loss of exclusivity, margin compression or entry). Report actual cited counterEvidence items in dimensions aligned to the claimed advantages. If none found, do not imply that no contrary evidence exists or that the moat is strong. Never invent contrary evidence or sources.",
    "Prefer government/regulator data, official company investor-relations pages and filings, exchanges, industry associations, then high-quality research sources, in that order.",
    "For US peers with annual reported numbers, seek the exact SEC EDGAR annual filing URL under https://www.sec.gov/Archives/edgar/data/{CIK}/{accession}/{document}. The peer financial amount cannot be treated as a confirmed benchmark merely because an IR page or search result cites it. Never invent an EDGAR accession or CIK; use actual returned sources.",
    "For Brazilian companies seek the exact 14-digit CNPJ from official CVM filing or registry pages. Put the candidate as cnpj on the peer only when found in the cited original source. FilingLens independently validates that number, legal company name and financial facts against the CVM DFP open-data service. Never infer or invent a CNPJ.",
    "Actively search for a public, auditable way to estimate issuer market share. Prefer regulator/open-data datasets; otherwise use a close public proxy only when numerator and denominator use the same period, geography and product basis.",
    "For any market-share proxy, return the raw numerator and denominator and let the application recompute the percentage. Never infer a denominator from narrative language.",
    "Do not manufacture TAM, concentration, CR3/CR5 or HHI. Calculate concentration only when cited share data are sufficient.",
    "Every peer, peer data point, moat evidence item, outlook, finding, market-share proxy, and market-structure claim must carry one HTTPS URL actually returned by web search. Put that URL only in the url field; do not repeat Markdown citations inside narrative fields.",
    "Do not provide investment recommendations, target prices, or uncited financial figures.",
    "",
    "Loaded market-research-brief framework:",
    methodology,
  ].join("\n");
}

/**
 * Recovery uses computational decomposition instead of asking one model call to
 * search, reason, structure and cite simultaneously:
 * 1) search/discover sources in plain text;
 * 2) classify only those source-catalog entries into peers;
 * 3) bind citations and rank peers deterministically.
 */
async function catalogRecovery(input: {
  jurisdiction: "us" | "br";
  issuerName: string;
  ticker?: string | null;
  industry: string;
  businessDescription?: string | null;
  filingExcerpt: string;
}) {
  const discovery = await withModelExecution("market", signal => generateText({
    abortSignal: signal,
    model: filingModel("market"),
    tools: { web_search: marketWebSearchTool() as never },
    stopWhen: stepCountIs(2),
    maxRetries: 0,
    maxOutputTokens: 2_500,
    providerOptions: openAIProviderOptions("market", 3_500, "low"),
    system: [
      "You are the source-discovery stage of a competitive-intelligence pipeline.",
      "Use web search. Find authoritative pages that establish direct or segment competition for the issuer.",
      "For each candidate, also seek official financial or operating data, evidence of durable competitive advantages or erosion risks, and current guidance or industry evidence relevant to a 12-24 month outlook.",
      "Prefer regulator/government data, official investor-relations/company pages, exchanges and industry associations.",
      "For US peer annual revenue and net income prioritize official SEC EDGAR 10-K filing URLs with genuine CIK and accession, so primary SEC CompanyFacts may corroborate numbers independently.",
      "Do not attempt JSON. Return a concise research memo naming candidate peers, material data points, moat evidence and outlook evidence.",
    ].join(" "),
    prompt: [
      `Jurisdiction: ${input.jurisdiction === "br" ? "Brazil / CVM" : "United States / SEC"}`,
      `Issuer: ${input.issuerName || "not identified"}`,
      `Ticker: ${input.ticker || "not available"}`,
      `Industry: ${input.industry || "not identified"}`,
      `Business description: ${input.businessDescription || "not separately available"}`,
      "",
      "Filing context:",
      input.filingExcerpt.slice(0, 6_000),
      "",
      "Find evidence for 3-6 direct or segment peers. Diversified issuers may have different peer sets by segment.",
    ].join("\n"),
  }), 40_000);

  const sources = citedUrls(discovery);
  if (!sources.length) {
    return {
      peerEvidence: [] as NonNullable<MarketResult["market"]["peerEvidence"]>,
      competitiveAnalysis: {
        status: "no_citable_results" as const,
        methodology: "market-research-brief" as const,
        peerProfiles: [],
        findings: [],
        researchDiagnostics: {
          candidatePeers: 0,
          verifiedPeers: 0,
          citedSources: 0,
          droppedClaims: 0,
          recoveryUsed: true,
          strategy: "deterministic-citation-ranking-v1" as const,
        },
      },
    };
  }

  const catalog = sources.slice(0, 16).map((source, index) =>
    `[${index + 1}] ${source.title ?? "Untitled source"} | ${source.url}`
  ).join("\n");

  const classified = await withModelExecution("market", signal => generateText({
    abortSignal: signal,
    model: filingModel("market"),
    output: Output.object({ schema: peerDiscoveryOutput }),
    maxRetries: 0,
    maxOutputTokens: 3_200,
    providerOptions: openAIProviderOptions("market", 4_500, "low"),
    system: [
      "You are the deterministic classification stage after web discovery.",
      "Use only the supplied discovery memo and source catalog. Do not use memory.",
      "Return 3-6 direct or segment peers when supported.",
      "The url field MUST be copied exactly from one source-catalog line. Do not invent, shorten, canonicalize or add query parameters.",
      "Keep relationship/positioning concise. Populate dataPoints, moatAssessment and outlook only from the memo and catalog; use empty dataPoints and null assessments when the catalog lacks support. Do not place Markdown links in narrative fields.",
      "For Brazilian peers, provide an exact 14-digit official CNPJ as cnpj only when present in the cited discovery catalog. Never manufacture identifiers.",
      "Include sourced counterEvidence (moat erosion, disconfirming metrics and challenged assumptions) when the discovery catalog supports it. Never manufacture sources or challenge narratives.",
      "When cited source material explicitly provides company-wide financial figures, format at most 3 dataPoints per peer with exact labels Revenue, Net income, Operating income or Gross profit; values as ISO currency and decimal US scale (e.g. USD 1,234.5 millions), period as FY2025, and context stating consolidated US GAAP/IFRS/BR GAAP and exact period end YYYY-MM-DD. Only include scope, currency, reporting basis and end date when explicitly present in that SAME cited source. Never guess or normalize absent fields; otherwise retain original disclosure wording or omit.",
    ].join(" "),
    prompt: [
      `Issuer: ${input.issuerName || "not identified"}`,
      `Business description: ${input.businessDescription || "not separately available"}`,
      "",
      "Discovery memo:",
      discovery.text.slice(0, 8_000),
      "",
      "Allowed source catalog:",
      catalog,
    ].join("\n"),
  }), 30_000);

  const synthetic: CompetitiveResearchOutput = {
    peers: classified.output.peers,
    findings: [],
    marketShareProxies: [],
  };
  const verified = verifyCompetitiveResearch(synthetic, sources, undefined, true);
  console.info(
    `[market-research] recovery candidates=${synthetic.peers.length} verified=${verified.peerEvidence.length} sources=${sources.length}`,
  );
  return input.jurisdiction==="br"?crosscheckCvmPeers(verified):crosscheckCompetitiveFacts(verified);
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
    const result = await withModelExecution("market", signal => generateText({
    abortSignal: signal,
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
        "Produce a source-verified competitive landscape with 3-6 direct or segment peers, a cited data/moat/outlook deep dive for each peer, up to 5 concise insight → implication findings, and public market-share evidence when defensible.",
      ].join("\n"),
    }), 80_000);

    const sources = citedUrls(result);
    const verified = verifyCompetitiveResearch(result.output, sources);
    console.info(
      `[market-research] full candidates=${result.output.peers.length} verified=${verified.peerEvidence.length} sources=${sources.length} dropped=${verified.competitiveAnalysis.researchDiagnostics?.droppedClaims ?? 0}`,
    );
    if (verified.peerEvidence.length > 0) return input.jurisdiction==="br"?crosscheckCvmPeers(verified):crosscheckCompetitiveFacts(verified);

    console.warn("[market-research] full research returned no verified peers; using catalog recovery");
  } catch (error) {
    console.warn("[market-research] full structured research failed; using catalog recovery", safeErrorName(error));
  }
  // Exactly one recovery lane: a failure inside recovery must not restart it.
  return catalogRecovery(input);
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
