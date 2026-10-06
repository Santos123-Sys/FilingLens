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
  type CompanyResult,
  type FilingClassification,
  type FinancialsResult,
  type HistoryResult,
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
import { runHistorianWithExternalEnrichment, runProfilerWithExternalCrossCheck } from "./web-enriched-agents";
import { applyExactTimelineValidation } from "./exact-timeline-skill";

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

function hasProfilerCrossCheck(result: CompanyResult): boolean {
  return result.kpis.some(item => item.label === "External issuer cross-check" && item.source?.kind === "citation");
}

function historianContext(
  context: { jurisdiction: Market; filingType: string; filingDate?: string | null; priorResults?: Record<string, unknown> },
) {
  const profile = context.priorResults?.profiler as CompanyResult | undefined;
  const financials = context.priorResults?.financials as FinancialsResult | undefined;
  return {
    jurisdiction: context.jurisdiction,
    filingType: context.filingType,
    filingDate: context.filingDate,
    issuerName: profile?.company?.name ?? "",
    filingPeriod: profile?.company?.periodEnd ?? "",
    currency: financials?.financials?.unit ?? "",
  };
}

/**
 * Sole authority for specialist order, skill binding, source slicing and
 * completeness checks. Browser retries remain the request-level retry boundary.
 * Profiler and Historian use one web-capable model invocation each so their
 * guide-required research enrichment does not multiply specialist stages.
 */
export const agentManager = {
  plan() {
    return {
      manager: "FilingLens Agent Manager",
      schemaVersion: "2.3",
      metadataStage: "metadata",
      agents: MANAGED_AGENT_ORDER,
      webResearchStage: {
        key: "market-research",
        trigger: "market_agent_has_no_filing_supported_peers",
        endpoint: "/api/market-research",
      },
      dashboardStage: "prebuilt-dashboard-mapping",
      retryBoundary: "browser-per-stage",
      requestPolicy: "one_primary_model_invocation_per_agent_request; provider web-search tool may execute inside profiler/historian; deterministic Python skills do not call a model",
      executionMode: "sequential_staged",
      integrations: [
        { skill: "equity-research", stage: "profiler", integration: "tear_sheet_method_and_cited_web_cross_check", mode: "filing-primary issuer identity/business-description cross-check only; no Equity Report, DCF, price target, multiples or recommendation", externalResearch: "bounded_openai_web_search" },
        { skill: "market-research-brief", stage: "market", integration: "analysis_framework_and_cited_web_search", mode: "filing-first market framework; citation-backed competitor research remains a separate optional request only when the filing names none", externalResearch: "conditional_openai_web_search" },
        { skill: "financial-ratio-toolkit", stage: "financials", integration: "exact_python_runtime_plus_filinglens_binding", mode: "exact supplied scripts/analyze.py per usable period; filing-only inputs; market-data metrics omitted; FilingLens debt/period/locale conventions override incompatible toolkit formulas" },
        { skill: "financial-statement-analyzer", stage: "financials", integration: "exact_python_runtime_plus_filinglens_binding", mode: "exact supplied scripts/analyze_financials.py for comparable-period trends and anomaly screens; TypeScript reconciliation retained" },
        { skill: "filing-timeline-extractor", stage: "historian", integration: "full_workflow_cited_web_enrichment_and_exact_python_validation", mode: "filing events plus citation-backed gap filling, dedupe/reconcile, then exact supplied validate_timeline.py at the Agent Manager boundary before events bind", externalResearch: "bounded_openai_web_search" },
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
    const subtools: string[] = [];
    let value: unknown;

    if (agent === "profiler") {
      value = await runProfilerWithExternalCrossCheck(market, input, context);
      subtools.push("equity-research-tear-sheet-method", "citation-verified-issuer-cross-check");
    } else if (agent === "historian") {
      const exactContext = historianContext(context);
      let history: HistoryResult;
      try {
        history = await runHistorianWithExternalEnrichment(market, input, exactContext);
      } catch {
        const fallback = extractDatedFilingEvents(excerpt);
        history = validateHistorianOutput({ timeline: [], events: fallback }, context.filingDate);
        history.validationFlags = [
          ...(history.validationFlags ?? []),
          {
            code: "HISTORIAN_RESEARCH_UNAVAILABLE",
            note: "Citation-backed timeline enrichment was unavailable; deterministic filing-only event extraction was preserved.",
            reason: "web_enrichment_request_failed",
          },
        ];
        history.enrichmentStatus = "skipped";
      }
      value = await applyExactTimelineValidation(history, exactContext);
      subtools.push("filing-timeline-extractor", "citation-verified-timeline-enrichment", "exact-validate_timeline.py");
    } else {
      value = await runAgent(agent, market, input, schema, context);
    }

    let result = value;
    if (agent === "financials") {
      result = await applyFinancialValidation(value as FinancialsResult);
      subtools.push("exact-financial-ratio-toolkit-python", "exact-financial-statement-analyzer-python", "filinglens-reconciliation-validator");
    }
    if (agent === "market") {
      const marketResult = validateMarketOutput(value as MarketResult);
      marketResult.market.externalResearchStatus = marketResult.market.competitors.length ? "not_needed" : "pending";
      result = marketResult;
      subtools.push("filing-source-provenance-validator", "market-research-brief-period-comparison", "market-research-brief-analysis-framework");
    }

    const diagnostic = assessCompleteness(agent, result, context);
    if (agent === "profiler") {
      const profile = result as CompanyResult;
      diagnostic.enrichmentStatus = hasProfilerCrossCheck(profile) ? "full" : "skipped";
      if (!hasProfilerCrossCheck(profile)) {
        diagnostic.warnings = [...(diagnostic.warnings ?? []), "external_issuer_cross_check_no_citable_result"];
      }
    }
    if (agent === "historian") {
      const history = result as HistoryResult;
      diagnostic.enrichmentStatus = history.enrichmentStatus ?? "skipped";
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
    if (agent === "financials") {
      const financials = result as FinancialsResult;
      if ((financials.financials.validationFlags ?? []).some(flag => flag.code.includes("SKILL_RUNTIME_UNAVAILABLE"))) {
        diagnostic.warnings = [...(diagnostic.warnings ?? []), "exact_financial_skill_runtime_degraded"];
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
