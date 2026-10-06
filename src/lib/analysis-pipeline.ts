import type {
  AgentName,
  AnalysisDiagnostics,
  FilingAnalysis,
  FilingClassification,
  MarketResult,
  MetadataResult,
  ModuleDiagnostic,
} from "@contracts/analysis";

export type PipelineLanguage = "en" | "pt";
export type PipelineStage = "metadata" | AgentName | "marketResearch";
export type PipelineStatus = "queued" | "running" | "retrying" | "complete" | "partial" | "failed" | "skipped";

export type PipelineStageState = {
  status: PipelineStatus;
  attempt: number;
  maxAttempts: number;
  detail?: string;
};

export type PipelineExecution = Record<PipelineStage, PipelineStageState>;

export type PipelineResult = {
  analysis: FilingAnalysis;
  failed: string[];
};

export class PipelineCancelled extends Error {
  constructor() {
    super("pipeline_cancelled");
    this.name = "PipelineCancelled";
  }
}

export class PipelineError extends Error {
  code: string;
  terminal: boolean;

  constructor(code: string, terminal = false) {
    super(code);
    this.name = "PipelineError";
    this.code = code;
    this.terminal = terminal;
  }
}

const CORE_AGENTS: AgentName[] = ["profiler", "financials", "market", "risks"];
const ALL_STAGES: PipelineStage[] = [
  "metadata",
  "profiler",
  "financials",
  "market",
  "risks",
  "marketResearch",
  "historian",
  "synthesizer",
];

export function initialPipelineExecution(): PipelineExecution {
  return Object.fromEntries(ALL_STAGES.map(stage => [stage, {
    status: "queued",
    attempt: 0,
    maxAttempts: 2,
  }])) as PipelineExecution;
}

function timeoutFor(stage: PipelineStage): number {
  if (stage === "financials" || stage === "historian" || stage === "synthesizer") return 240_000;
  if (stage === "marketResearch") return 180_000;
  return 150_000;
}

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function friendlyReason(reason: string | undefined, lang: PipelineLanguage): string | undefined {
  if (!reason) return undefined;
  const messages: Record<string, [string, string]> = {
    profile_data_not_found: [
      "Issuer identity was found, but this filing did not provide enough profile/KPI evidence.",
      "A identidade do emissor foi encontrada, mas o documento não trouxe evidência suficiente de perfil/KPIs.",
    ],
    market_detail_not_found: [
      "No filing-supported peers, segment or geographic detail was captured.",
      "Não foram capturados concorrentes, segmentos ou geografias com suporte no documento.",
    ],
    risk_factors_not_found: [
      "No structured risk-factor list was captured from the supplied filing evidence.",
      "Nenhuma lista estruturada de fatores de risco foi capturada das evidências fornecidas.",
    ],
    sec_10q_financials_incomplete: [
      "The 10-Q did not yield the required comparable quarter and balance-sheet set.",
      "O 10-Q não forneceu o conjunto exigido de trimestre comparável e balanço patrimonial.",
    ],
    sec_10k_financials_incomplete: [
      "The 10-K did not yield the required historical statements.",
      "O 10-K não forneceu as demonstrações históricas exigidas.",
    ],
    historical_financials_not_found: [
      "Comparable historical financial series were not established.",
      "Não foi possível estabelecer séries financeiras históricas comparáveis.",
    ],
    timeline_events_not_found: [
      "No validated dated events were captured.",
      "Nenhum evento datado validado foi capturado.",
    ],
    summary_not_found: [
      "Executive synthesis returned no supported summary.",
      "A síntese executiva não retornou resumo suportado.",
    ],
    agent_request_failed: [
      "This module remained unavailable after bounded attempts.",
      "Este módulo permaneceu indisponível após tentativas limitadas.",
    ],
  };
  return messages[reason]?.[lang === "pt" ? 1 : 0] ?? reason.replaceAll("_", " ");
}

async function requestJson(
  url: string,
  init: RequestInit,
  stage: PipelineStage,
  signal: AbortSignal,
  onStage: (stage: PipelineStage, patch: Partial<PipelineStageState>) => void,
  lang: PipelineLanguage,
  maxAttempts = 2,
): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) throw new PipelineCancelled();
    const controller = new AbortController();
    const onAbort = () => controller.abort("pipeline_cancelled");
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = window.setTimeout(() => controller.abort("stage_timeout"), timeoutFor(stage));
    onStage(stage, { status: attempt > 1 ? "retrying" : "running", attempt, maxAttempts });

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return body;

      const code = typeof body.error === "string" ? body.error : "internal";
      const terminal = ["ai_unavailable", "ai_misconfigured", "content_rejected"].includes(code);
      const transient = code === "ai_transient" || response.status >= 500;
      if (terminal) throw new PipelineError(code, true);
      if (transient && attempt < maxAttempts) {
        onStage(stage, {
          status: "retrying",
          detail: lang === "pt"
            ? "Falha transitória; uma nova chamada limitada será iniciada."
            : "Transient failure; starting one fresh bounded request.",
        });
        await wait(650 * attempt);
        continue;
      }
      throw new PipelineError(code, false);
    } catch (error) {
      if (signal.aborted) throw new PipelineCancelled();
      if (error instanceof PipelineError) throw error;
      if (attempt < maxAttempts) {
        onStage(stage, {
          status: "retrying",
          detail: lang === "pt"
            ? "A requisição expirou; iniciando uma tentativa nova e limitada."
            : "The request timed out; starting one fresh bounded attempt.",
        });
        await wait(650 * attempt);
        continue;
      }
      throw new PipelineError("ai_transient", false);
    } finally {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
  throw new PipelineError("ai_transient", false);
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function stageStatus(diagnostic: ModuleDiagnostic | undefined): PipelineStatus {
  if (!diagnostic) return "partial";
  if (diagnostic.status === "complete" || diagnostic.status === "not_applicable") return "complete";
  if (diagnostic.status === "failed") return "failed";
  return "partial";
}

export async function executeAnalysisPipeline(input: {
  text: string;
  classification: FilingClassification;
  fileName: string;
  lang: PipelineLanguage;
  signal: AbortSignal;
  onStage: (stage: PipelineStage, patch: Partial<PipelineStageState>) => void;
}): Promise<PipelineResult> {
  const { text, classification, fileName, lang, signal, onStage } = input;
  const market = classification.jurisdiction;
  const diagnostics: AnalysisDiagnostics = {};
  const parts: Record<string, unknown> = {};
  const failed = new Set<string>();

  const metadataBody = await requestJson("/api/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, classification }),
  }, "metadata", signal, onStage, lang, 2);

  const fallbackMetadata: MetadataResult["metadata"] = {
    jurisdiction: market,
    filingType: classification.filingType,
    reportingPeriod: null,
    filedAt: null,
    confidence: classification.confidence,
    cnpj: null,
    cvmDocumentClass: market === "br" ? classification.filingType : null,
    registryData: null,
    cik: null,
    sicCode: null,
    fiscalYearEnd: null,
    stateOfIncorporation: null,
    sources: [],
  };
  const metadata = (metadataBody.result as MetadataResult | undefined)?.metadata ?? fallbackMetadata;
  diagnostics.metadata = (metadataBody.diagnostic as ModuleDiagnostic | undefined) ?? {
    status: "incomplete",
    reason: "metadata_diagnostic_missing",
  };
  onStage("metadata", {
    status: stageStatus(diagnostics.metadata),
    detail: friendlyReason(diagnostics.metadata.reason, lang),
  });

  const runAgent = async (agent: AgentName, priorResults?: Record<string, unknown>) => {
    try {
      const body = await requestJson("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          market,
          filingType: metadata.filingType || classification.filingType,
          filingDate: metadata.filedAt,
          text,
          priorResults,
        }),
      }, agent, signal, onStage, lang, 2);
      parts[agent] = body.result;
      diagnostics[agent] = (body.diagnostic as ModuleDiagnostic | undefined)?.status
        ? body.diagnostic as ModuleDiagnostic
        : { status: "incomplete", reason: "response_diagnostic_missing" };
      onStage(agent, {
        status: stageStatus(diagnostics[agent]),
        detail: friendlyReason(diagnostics[agent]?.reason, lang),
      });
    } catch (error) {
      if (error instanceof PipelineCancelled || (error instanceof PipelineError && error.terminal)) throw error;
      failed.add(agent);
      diagnostics[agent] = { status: "failed", reason: "agent_request_failed" };
      onStage(agent, { status: "failed", detail: friendlyReason("agent_request_failed", lang) });
    }
  };

  // Core evidence extraction. Two concurrent model calls keeps latency reasonable
  // without recreating broad parallel fan-out and provider saturation.
  await runPool(CORE_AGENTS, 2, agent => runAgent(agent));

  // Validation/enrichment phase: historian receives its real upstream context;
  // cited peer research is conditional and may run alongside it.
  const historianPromise = runAgent("historian", {
    profiler: parts.profiler,
    financials: parts.financials,
  });

  const marketResult = parts.market as MarketResult | undefined;
  const researchPromise = (async () => {
    if (!marketResult?.market) {
      onStage("marketResearch", {
        status: "skipped",
        attempt: 0,
        detail: lang === "pt" ? "Ignorada porque o módulo Mercado não retornou contexto utilizável." : "Skipped because the Market module returned no usable context.",
      });
      return;
    }
    if ((marketResult.market.competitors?.length ?? 0) > 0) {
      marketResult.market.externalResearchStatus = "not_needed";
      onStage("marketResearch", {
        status: "skipped",
        attempt: 0,
        detail: lang === "pt" ? "O documento já contém concorrentes com evidência verificável." : "The filing already contains peers with verifiable evidence.",
      });
      return;
    }
    try {
      const body = await requestJson("/api/market-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jurisdiction: market, text, marketResult }),
      }, "marketResearch", signal, onStage, lang, 2);
      const enriched = body.result as MarketResult;
      parts.market = enriched;
      if ((body.diagnostic as ModuleDiagnostic | undefined)?.status) diagnostics.market = body.diagnostic as ModuleDiagnostic;
      onStage("marketResearch", {
        status: enriched.market.externalResearchStatus === "complete" ? "complete" : "partial",
        detail: enriched.market.externalResearchStatus === "complete"
          ? (lang === "pt" ? "Concorrentes externos aceitos somente com URLs citadas." : "External peers accepted only with cited URLs.")
          : (lang === "pt" ? "A pesquisa terminou sem concorrentes externos citáveis." : "Research finished without citable external peers."),
      });
    } catch (error) {
      if (error instanceof PipelineCancelled || (error instanceof PipelineError && error.terminal)) throw error;
      marketResult.market.externalResearchStatus = "unavailable";
      parts.market = marketResult;
      onStage("marketResearch", {
        status: "partial",
        detail: lang === "pt" ? "Pesquisa web indisponível; a evidência do documento foi preservada." : "Web research unavailable; filing evidence was preserved.",
      });
    }
  })();

  await Promise.all([historianPromise, researchPromise]);

  await runAgent("synthesizer", parts);

  const profiler = parts.profiler as { company: FilingAnalysis["company"]; kpis: FilingAnalysis["kpis"] } | undefined;
  const summaryPart = parts.synthesizer as {
    summary: FilingAnalysis["summary"];
    confidenceNotes?: FilingAnalysis["confidenceNotes"];
    missingData?: string[];
  } | undefined;

  const companyFallback: FilingAnalysis["company"] = {
    name: fileName.replace(/\.pdf$/i, "") || "Filing",
    ticker: null,
    exchange: null,
    filingType: metadata.filingType || classification.filingType,
    periodEnd: metadata.reportingPeriod ?? "",
    filedAt: metadata.filedAt,
    description: lang === "pt"
      ? "O documento não repetiu uma descrição completa do negócio."
      : "This filing did not repeat a full business description.",
  };
  const financialsFallback: FilingAnalysis["financials"] = {
    unit: market === "br" ? "R$ milhões" : "USD millions",
    years: [],
    revenue: [],
    netIncome: [],
    eps: null,
    grossMargin: null,
    operatingMargin: null,
    operatingCashFlow: null,
    capex: null,
    freeCashFlow: null,
    dividends: null,
    buybacks: null,
    totalAssets: null,
    totalLiabilities: null,
    totalEquity: null,
    totalDebt: null,
    cash: null,
    forwardGuidance: [],
    evidence: [],
  };
  const marketFallback: FilingAnalysis["market"] = {
    industry: "",
    competitors: [],
    geographies: [],
    segments: [],
    externalResearchStatus: "unavailable",
  };
  const diagnosticMissing = Object.values(diagnostics).flatMap(item => item?.missing ?? []);
  const assembled: FilingAnalysis = {
    schemaVersion: "2.0",
    jurisdiction: market,
    metadata,
    company: profiler?.company ?? companyFallback,
    kpis: profiler?.kpis ?? [],
    market: (parts.market as MarketResult | undefined)?.market ?? marketFallback,
    risks: (parts.risks as { risks: FilingAnalysis["risks"] } | undefined)?.risks ?? [],
    financials: (parts.financials as { financials: FilingAnalysis["financials"] } | undefined)?.financials ?? financialsFallback,
    timeline: (parts.historian as { timeline: FilingAnalysis["timeline"] } | undefined)?.timeline ?? [],
    events: (parts.historian as { events: FilingAnalysis["events"] } | undefined)?.events ?? [],
    historyValidationFlags: (parts.historian as { validationFlags?: FilingAnalysis["historyValidationFlags"] } | undefined)?.validationFlags ?? [],
    summary: summaryPart?.summary ?? [],
    confidenceNotes: summaryPart?.confidenceNotes ?? [],
    missingData: [...new Set([...(summaryPart?.missingData ?? []), ...diagnosticMissing])],
    diagnostics,
  };

  try {
    const dashboardResponse = await fetch("/api/dashboard-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: assembled }),
      signal,
    });
    if (dashboardResponse.ok) {
      const body = await dashboardResponse.json();
      if (body.dashboard) assembled.prebuiltDashboard = body.dashboard;
    }
  } catch {
    // Dashboard binding is an optimization; the analysis contract remains usable.
  }

  return { analysis: assembled, failed: [...failed] };
}
