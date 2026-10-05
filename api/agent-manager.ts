import type { z } from "zod";
import {
  companySchema,
  financialsSchema,
  historySchema,
  marketSchema,
  metadataSchema,
  risksSchema,
  summarySchema,
  type AgentName,
  type FilingClassification,
  type FinancialsResult,
  type MarketResult,
  type MetadataResult,
  type Market,
} from "../contracts/analysis";
import { buildAgentInput, buildMetadataInput, runAgent, runMetadataAgent } from "./analyze";
import { assessCompleteness, assessMetadataCompleteness } from "./completeness";
import { applyFinancialValidation } from "./financial-validation";
import { validateHistorianOutput } from "./historian-validation";
import { validateMarketOutput } from "./market-validation";
import { extractDatedFilingEvents } from "./timeline-skill-extraction";
import { researchMarketPeers } from "./market-web-research";

const AGENT_SCHEMAS = {
  profiler: companySchema,
  market: marketSchema,
  risks: risksSchema,
  financials: financialsSchema,
  historian: historySchema,
  synthesizer: summarySchema,
} as const;

export const MANAGED_AGENT_ORDER: AgentName[] = [
  "profiler",
  "market",
  "risks",
  "financials",
  "historian",
  "synthesizer",
];

type ManagedRun = {
  result: unknown;
  diagnostic: ReturnType<typeof assessCompleteness>;
  manager: {
    stage: number;
    totalStages: number;
    agent: AgentName;
    excerptChars: number;
    attempts: number;
    subtools: string[];
  };
  evaluation: {
    schemaValid: true;
    completeness: ReturnType<typeof assessCompleteness>["status"];
  };
};

export function synthesisInput(excerpt: string, priorResults?: Record<string, unknown>): string {
  if (!priorResults) return excerpt;
  const allowed = Object.fromEntries(
    ["profiler", "market", "risks", "financials", "historian"]
      .filter(key => Object.hasOwn(priorResults, key))
      .map(key => [key, priorResults[key]]),
  );
  return `${excerpt}\n\n[Earlier specialist outputs; summarize filing-supported facts only and identify gaps]\n${JSON.stringify(allowed).slice(0, 24_000)}`;
}

export function mergeMarketResearchPeers(
  input: MarketResult,
  externalPeers: NonNullable<MarketResult["market"]["peerEvidence"]>,
): MarketResult {
  const validated = validateMarketOutput(input);
  const market = validated.market;
  if (market.competitors.length > 0) {
    return { market: { ...market, externalResearchStatus: "not_needed" } };
  }
  const filingPeerNames = new Set(market.competitors.map(name => name.trim().toLowerCase()));
  const uniqueExternal = externalPeers.filter(peer => !filingPeerNames.has(peer.name.trim().toLowerCase()));
  return {
    market: {
      ...market,
      peerEvidence: [...(market.peerEvidence ?? []), ...uniqueExternal].slice(0, 12),
      competitors: [...market.competitors, ...uniqueExternal.map(peer => peer.name)].slice(0, 12),
      externalResearchStatus: uniqueExternal.length ? "complete" : "no_citable_results",
    },
  };
}

/**
 * The sole authority for specialist order, schema selection, source slicing
 * and completeness checks. Every method performs at most one expensive model
 * call. Retries are browser-orchestrated so a hosted request never contains a
 * hidden multi-attempt loop or more than one model/tool invocation.
 */
export const agentManager = {
  plan() {
    return {
      manager: "FilingLens Agent Manager",
      schemaVersion: "2.1",
      metadataStage: "metadata",
      agents: MANAGED_AGENT_ORDER,
      webResearchStage: {
        key: "market-research",
        trigger: "market_agent_has_no_filing_supported_peers",
        endpoint: "/api/market-research",
      },
      dashboardStage: "prebuilt-dashboard-mapping",
      retryBoundary: "browser-per-stage",
      requestPolicy: "one_expensive_model_call_per_http_request",
      executionMode: "sequential_staged",
      integrations: [
        { skill: "equity-research", stage: "profiler", integration: "prompt_method_only", mode: "tear-sheet identity checks; external cross-check skipped", externalResearch: "unavailable" },
        { skill: "market-research-brief", stage: "market", integration: "prompt_method_typescript_and_cited_web_search", mode: "filing-first peer checks; citation-backed competitor research runs as a separate optional request only when the filing names none", externalResearch: "conditional_openai_web_search" },
        { skill: "financial-ratio-toolkit", stage: "financials", integration: "typescript_calculation", mode: "mapped filing-only ratios; market-data metrics omitted" },
        { skill: "financial-statement-analyzer", stage: "financials", integration: "typescript_calculation", mode: "comparable-period trends and ten anomaly screens" },
        { skill: "filing-timeline-extractor", stage: "historian", integration: "typescript_extraction_and_validation", mode: "filing-only dated-excerpt fallback and timeline validation; Python CLI not invoked", externalResearch: "unavailable" },
      ],
    };
  },

  async runMetadata(
    market: Market,
    filingText: string,
    classification: FilingClassification,
  ) {
    const excerpt = buildMetadataInput(filingText);
    const value = await runMetadataAgent(market, excerpt, metadataSchema);
    const result = value as MetadataResult;
    result.metadata.jurisdiction = classification.jurisdiction;
    if (!result.metadata.filingType) result.metadata.filingType = classification.filingType;
    result.metadata.confidence = Math.min(result.metadata.confidence, classification.confidence);
    const diagnostic = assessMetadataCompleteness(result);
    return {
      result,
      diagnostic,
      manager: {
        stage: 0,
        totalStages: MANAGED_AGENT_ORDER.length + 1,
        agent: "metadata" as const,
        excerptChars: excerpt.length,
        attempts: 1,
      },
      evaluation: {
        schemaValid: true as const,
        completeness: diagnostic.status,
      },
    };
  },

  async run(
    agent: AgentName,
    market: Market,
    filingText: string,
    context: { jurisdiction: Market; filingType: string; filingDate?: string | null; priorResults?: Record<string, unknown> },
  ): Promise<ManagedRun> {
    const schema: z.ZodTypeAny = AGENT_SCHEMAS[agent];
    const excerpt = buildAgentInput(agent, filingText);
    const input = agent === "synthesizer" ? synthesisInput(excerpt, context.priorResults) : excerpt;
    const value = await runAgent(agent, market, input, schema, context);
    const subtools: string[] = [];
    let result = value;
    if (agent === "financials") {
      result = applyFinancialValidation(value as FinancialsResult);
      subtools.push("financial-ratio-toolkit", "financial-statement-analyzer");
    }
    if (agent === "historian") {
      const history = value as import("../contracts/analysis").HistoryResult;
      const validated = validateHistorianOutput(history, context.filingDate);
      if (!validated.timeline.length && !validated.events.length) {
        const fallback = extractDatedFilingEvents(excerpt);
        result = validateHistorianOutput({ ...history, events: fallback }, context.filingDate);
      } else result = validated;
      subtools.push("filing-timeline-extractor", "filing-timeline-extractor-validator");
    }
    if (agent === "market") {
      const marketResult = validateMarketOutput(value as MarketResult);
      marketResult.market.externalResearchStatus = marketResult.market.competitors.length ? "not_needed" : "pending";
      result = marketResult;
      subtools.push("filing-source-provenance-validator", "market-research-brief-period-comparison", "market-research-brief-analysis-framework");
    }
    if (agent === "profiler") subtools.push("equity-research-tear-sheet-method");
    const diagnostic = assessCompleteness(agent, result, context);
    if (["profiler", "historian"].includes(agent)) {
      diagnostic.enrichmentStatus = "skipped";
      diagnostic.warnings = ["external_enrichment_unavailable"];
    }
    if (agent === "historian") {
      const history = result as import("../contracts/analysis").HistoryResult;
      if ((history.validationFlags?.length ?? 0) > 0) {
        diagnostic.warnings = [...(diagnostic.warnings ?? []), "historian_validation_flags"];
      }
    }
    if (agent === "market") {
      const marketResult = result as MarketResult;
      diagnostic.enrichmentStatus = marketResult.market.externalResearchStatus === "not_needed" ? "none" : "skipped";
      if ((marketResult.market.validationFlags?.length ?? 0) > 0) {
        diagnostic.warnings = [...(diagnostic.warnings ?? []), "market_validation_flags"];
      }
    }
    const stage = MANAGED_AGENT_ORDER.indexOf(agent) + 1;
    return {
      result,
      diagnostic,
      manager: {
        stage,
        totalStages: MANAGED_AGENT_ORDER.length + 1,
        agent,
        excerptChars: excerpt.length,
        attempts: 1,
        subtools,
      },
      evaluation: {
        schemaValid: true,
        completeness: diagnostic.status,
      },
    };
  },

  async runMarketResearch(
    jurisdiction: Market,
    filingText: string,
    input: MarketResult,
  ) {
    const validated = validateMarketOutput(input);
    if (validated.market.competitors.length > 0) {
      const result = mergeMarketResearchPeers(validated, []);
      return {
        result,
        diagnostic: assessCompleteness("market", result, { jurisdiction }),
        manager: { stage: "market-research", attempts: 0, excerptChars: 0, subtools: [] },
      };
    }
    const excerpt = buildAgentInput("market", filingText);
    const peers = await researchMarketPeers({
      jurisdiction,
      industry: validated.market.industry,
      filingExcerpt: excerpt,
    });
    const result = mergeMarketResearchPeers(validated, peers);
    const diagnostic = assessCompleteness("market", result, { jurisdiction });
    diagnostic.enrichmentStatus = result.market.externalResearchStatus === "complete" ? "full" : "skipped";
    if (result.market.externalResearchStatus === "no_citable_results") {
      diagnostic.warnings = [...(diagnostic.warnings ?? []), "external_market_research_no_citations"];
    }
    return {
      result,
      diagnostic,
      manager: {
        stage: "market-research",
        attempts: 1,
        excerptChars: excerpt.length,
        subtools: ["cited-web-market-research"],
      },
    };
  },
};
