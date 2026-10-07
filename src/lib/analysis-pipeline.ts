import type {
  AgentName,
  AnalysisDiagnostics,
  FilingAnalysis,
  FilingClassification,
  MarketResult,
  MetadataResult,
  ModuleDiagnostic,
} from "@contracts/analysis";
import type { RegulatoryDataSnapshot } from "@contracts/regulatory-data";
import { attachRegulatoryAnnualHistory } from "./regulatory-financial-history";

export type PipelineLanguage = "en" | "pt";
export type PipelineStage = "metadata" | "regulatoryData" | AgentName | "marketResearch";
export type PipelineStatus = "queued" | "running" | "retrying" | "complete" | "partial" | "failed" | "skipped";

export type PipelineStageState = {
  status: PipelineStatus;
  attempt: number;
  maxAttempts: number;
  detail?: string;
};

export type PipelineExecution = Record<PipelineStage, PipelineStageState>;
export type PipelineResult = { analysis: FilingAnalysis & { regulatoryData?: RegulatoryDataSnapshot }; failed: string[] };

export class PipelineCancelled extends Error {
  constructor() { super("pipeline_cancelled"); this.name = "PipelineCancelled"; }
}

export class PipelineError extends Error {
  code: string;
  terminal: boolean;
  constructor(code: string, terminal = false) { super(code); this.name = "PipelineError"; this.code = code; this.terminal = terminal; }
}

const CORE_AGENTS: AgentName[] = ["profiler", "financials", "market", "risks"];
const ALL_STAGES: PipelineStage[] = ["metadata", "regulatoryData", "profiler", "financials", "market", "risks", "marketResearch", "historian", "synthesizer"];

export function initialPipelineExecution(): PipelineExecution {
  return Object.fromEntries(ALL_STAGES.map(stage => [stage, { status: "queued", attempt: 0, maxAttempts: stage === "regulatoryData" ? 1 : 2 }])) as PipelineExecution;
}

function timeoutFor(stage: PipelineStage): number {
  if (stage === "regulatoryData") return 60_000;
  if (stage === "financials" || stage === "historian" || stage === "synthesizer") return 240_000;
  if (stage === "marketResearch") return 180_000;
  return 150_000;
}

function wait(ms: number) { return new Promise(resolve => window.setTimeout(resolve, ms)); }

function friendlyReason(reason: string | undefined, lang: PipelineLanguage): string | undefined {
  if (!reason) return undefined;
  const messages: Record<string, [string, string]> = {
    profile_data_not_found: ["Issuer identity was found, but this filing did not provide enough profile/KPI evidence.", "A identidade do emissor foi encontrada, mas o documento não trouxe evidência suficiente de perfil/KPIs."],
    market_detail_not_found: ["No filing-supported peers, segment or geographic detail was captured.", "Não foram capturados concorrentes, segmentos ou geografias com suporte no documento."],
    risk_factors_not_found: ["No structured risk-factor list was captured from the supplied filing evidence.", "Nenhuma lista estruturada de fatores de risco foi capturada das evidências fornecidas."],
    risk_section_not_expected_for_filing: ["This filing type does not normally contain a standalone risk-factor inventory; use the annual/reference filing for that module.", "Este tipo de documento normalmente não contém um inventário autônomo de fatores de risco; use o documento anual/de referência para esse módulo."],
    sec_10q_financials_incomplete: ["The 10-Q did not yield the required comparable quarter and balance-sheet set.", "O 10-Q não forneceu o conjunto exigido de trimestre comparável e balanço patrimonial."],
    sec_10k_financials_incomplete: ["The 10-K did not yield the required historical statements.", "O 10-K não forneceu as demonstrações históricas exigidas."],
    historical_financials_not_found: ["Comparable historical financial series were not established.", "Não foi possível estabelecer séries financeiras históricas comparáveis."],
    external_financial_history_partial: ["Official regulatory history was recovered, but fewer than five annual periods were available.", "O histórico regulatório oficial foi recuperado, mas havia menos de cinco períodos anuais disponíveis."],
    timeline_events_not_found: ["No validated dated events were captured.", "Nenhum evento datado validado foi capturado."],
    summary_not_found: ["Executive synthesis returned no supported summary.", "A síntese executiva não retornou resumo suportado."],
    agent_request_failed: ["This module remained unavailable after bounded attempts.", "Este módulo permaneceu indisponível após tentativas limitadas."],
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
        onStage(stage, { status: "retrying", detail: lang === "pt" ? "Falha transitória; uma nova chamada limitada será iniciada." : "Transient failure; starting one fresh bounded request." });
        await wait(650 * attempt);
        continue;
      }
      throw new PipelineError(code, false);
    } catch (error) {
      if (signal.aborted) throw new PipelineCancelled();
      if (error instanceof PipelineError) throw error;
      if (attempt < maxAttempts) {
        onStage(stage, { status: "retrying", detail: lang === "pt" ? "A requisição expirou; iniciando uma tentativa nova e limitada." : "The request timed out; starting one fresh bounded attempt." });
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
    while (cursor < items.length) await fn(items[cursor++]);
  });
  await Promise.all(workers);
}

function stageStatus(diagnostic: ModuleDiagnostic | undefined): PipelineStatus {
  if (!diagnostic) return "partial";
  if (diagnostic.status === "complete" || diagnostic.status === "not_applicable") return "complete";
  if (diagnostic.status === "failed") return "failed";
  return "partial";
}

function regulatoryStage(snapshot: RegulatoryDataSnapshot | undefined, lang: PipelineLanguage): Partial<PipelineStageState> {
  if (!snapshot) return { status: "partial", detail: lang === "pt" ? "Validação regulatória estruturada indisponível; análise do documento preservada." : "Structured regulatory cross-check unavailable; filing analysis preserved." };
  if (snapshot.status === "complete") return { status: "complete", detail: lang === "pt" ? `Dados estruturados validados via ${snapshot.provider}.` : `Structured regulatory data loaded from ${snapshot.provider}.` };
  if (snapshot.status === "identifier_missing") return { status: "skipped", detail: lang === "pt" ? "Identificador regulatório não encontrado; análise do documento continua." : "Regulatory identifier was not found; filing analysis continues." };
  return { status: "partial", detail: snapshot.warnings?.[0] ?? (lang === "pt" ? "Fonte regulatória parcial ou indisponível." : "Regulatory source was partial or unavailable.") };
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
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, classification }),
  }, "metadata", signal, onStage, lang, 2);

  const fallbackMetadata: MetadataResult["metadata"] = {
    jurisdiction: market, filingType: classification.filingType, reportingPeriod: null, filedAt: null,
    confidence: classification.confidence, cnpj: null, cvmDocumentClass: market === "br" ? classification.filingType : null,
    registryData: null, cik: null, sicCode: null, fiscalYearEnd: null, stateOfIncorporation: null, sources: [],
  };
  const metadata = (metadataBody.result as MetadataResult | undefined)?.metadata ?? fallbackMetadata;
  diagnostics.metadata = (metadataBody.diagnostic as ModuleDiagnostic | undefined) ?? { status: "incomplete", reason: "metadata_diagnostic_missing" };
  onStage("metadata", { status: stageStatus(diagnostics.metadata), detail: friendlyReason(diagnostics.metadata.reason, lang) });

  let regulatoryData: RegulatoryDataSnapshot | undefined;
  try {
    const body = await requestJson("/api/regulatory-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jurisdiction: market,
        filingType: metadata.filingType || classification.filingType,
        reportingPeriod: metadata.reportingPeriod,
        cik: metadata.cik,
        cnpj: metadata.cnpj,
        historyYears: 5,
        text: text.slice(0, 120_000),
      }),
    }, "regulatoryData", signal, onStage, lang, 1);
    regulatoryData = body as unknown as RegulatoryDataSnapshot;
    parts.regulatoryData = regulatoryData;
    onStage("regulatoryData", { attempt: 1, maxAttempts: 1, ...regulatoryStage(regulatoryData, lang) });
  } catch {
    onStage("regulatoryData", { attempt: 1, maxAttempts: 1, ...regulatoryStage(undefined, lang) });
  }

  const runAgent = async (agent: AgentName, priorResults?: Record<string, unknown>) => {
    try {
      const enrichedPrior = { ...(priorResults ?? {}), ...(regulatoryData ? { regulatoryData } : {}) };
      const body = await requestJson("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent, market, filingType: metadata.filingType || classification.filingType,
          filingDate: metadata.filedAt, text, priorResults: enrichedPrior,
        }),
      }, agent, signal, onStage, lang, 2);
      parts[agent] = body.result;
      diagnostics[agent] = (body.diagnostic as ModuleDiagnostic | undefined)?.status
        ? body.diagnostic as ModuleDiagnostic
        : { status: "incomplete", reason: "response_diagnostic_missing" };
      onStage(agent, { status: stageStatus(diagnostics[agent]), detail: friendlyReason(diagnostics[agent]?.reason, lang) });
    } catch (error) {
      if (error instanceof PipelineCancelled || (error instanceof PipelineError && error.terminal)) throw error;
      failed.add(agent);
      diagnostics[agent] = { status: "failed", reason: "agent_request_failed" };
      onStage(agent, { status: "failed", detail: friendlyReason("agent_request_failed", lang) });
    }
  };

  await runPool(CORE_AGENTS, 2, agent => runAgent(agent));

  // Identifier recovery lane: the first structured-data request is intentionally
  // parallel-friendly and filing-ID based. If the filing omitted CIK/CNPJ, retry
  // once after Profiler has resolved a stable issuer name/ticker. This avoids
  // blocking all specialist work on external I/O while still recovering history.
  const profileResult = parts.profiler as { company?: FilingAnalysis["company"] } | undefined;
  if (regulatoryData?.status === "identifier_missing" && profileResult?.company) {
    try {
      const body = await requestJson("/api/regulatory-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jurisdiction: market,
          filingType: metadata.filingType || classification.filingType,
          reportingPeriod: metadata.reportingPeriod,
          cik: metadata.cik,
          cnpj: metadata.cnpj,
          companyName: profileResult.company.name,
          ticker: profileResult.company.ticker,
          historyYears: 5,
          text: text.slice(0, 120_000),
        }),
      }, "regulatoryData", signal, onStage, lang, 1);
      regulatoryData = body as unknown as RegulatoryDataSnapshot;
      parts.regulatoryData = regulatoryData;
      onStage("regulatoryData", { attempt: 1, maxAttempts: 1, ...regulatoryStage(regulatoryData, lang) });
    } catch {
      // Preserve the first deterministic status; filing analysis remains usable.
    }
  }

  const historianPromise = runAgent("historian", { profiler: parts.profiler, financials: parts.financials });
  const marketResult: MarketResult = (parts.market as MarketResult | undefined) ?? {
    market: {
      industry: "",
      competitors: [],
      peerEvidence: [],
      geographies: [],
      segments: [],
      externalResearchStatus: "pending",
    },
  };
  if (!parts.market) parts.market = marketResult;
  const researchPromise = (async () => {
    try {
      const body = await requestJson("/api/market-research", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jurisdiction: market, text, marketResult, company: profileResult?.company, cnpj: metadata.cnpj }),
      }, "marketResearch", signal, onStage, lang, 2);
      const enriched = body.result as MarketResult;
      parts.market = enriched;
      if ((body.diagnostic as ModuleDiagnostic | undefined)?.status) diagnostics.market = body.diagnostic as ModuleDiagnostic;
      const researchDiagnostics = enriched.market.competitiveAnalysis?.researchDiagnostics;
      const verifiedPeers = researchDiagnostics?.verifiedPeers ?? enriched.market.competitors.length;
      const citedSources = researchDiagnostics?.citedSources ?? 0;
      const recoveryUsed = researchDiagnostics?.recoveryUsed === true;
      onStage("marketResearch", {
        status: enriched.market.externalResearchStatus === "complete" ? "complete" : "partial",
        detail: enriched.market.externalResearchStatus === "complete"
          ? (lang === "pt"
              ? `${verifiedPeers} concorrentes verificados · ${citedSources} fontes citadas${recoveryUsed ? " · recuperação determinística usada" : ""}.`
              : `${verifiedPeers} verified peers · ${citedSources} cited sources${recoveryUsed ? " · deterministic recovery used" : ""}.`)
          : (lang === "pt"
              ? `Pesquisa concluída com ${verifiedPeers} concorrentes verificados e ${citedSources} fontes citadas.`
              : `Research completed with ${verifiedPeers} verified peers and ${citedSources} cited sources.`),
      });
    } catch (error) {
      if (error instanceof PipelineCancelled || (error instanceof PipelineError && error.terminal)) throw error;
      marketResult.market.externalResearchStatus = "unavailable";
      parts.market = marketResult;
      onStage("marketResearch", { status: "partial", detail: lang === "pt" ? "Pesquisa web indisponível; evidência do documento preservada." : "Web research unavailable; filing evidence was preserved." });
    }
  })();

  await Promise.all([historianPromise, researchPromise]);
  await runAgent("synthesizer", parts);

  const profiler = parts.profiler as { company: FilingAnalysis["company"]; kpis: FilingAnalysis["kpis"] } | undefined;
  const summaryPart = parts.synthesizer as { summary: FilingAnalysis["summary"]; confidenceNotes?: FilingAnalysis["confidenceNotes"]; missingData?: string[] } | undefined;

  const companyFallback: FilingAnalysis["company"] = {
    name: fileName.replace(/\.pdf$/i, "") || "Filing", ticker: null, exchange: null,
    filingType: metadata.filingType || classification.filingType, periodEnd: metadata.reportingPeriod ?? "", filedAt: metadata.filedAt,
    description: lang === "pt" ? "O documento não repetiu uma descrição completa do negócio." : "This filing did not repeat a full business description.",
  };
  const financialsFallback: FilingAnalysis["financials"] = {
    unit: market === "br" ? "R$ milhões" : "USD millions", years: [], revenue: [], netIncome: [], eps: null,
    grossMargin: null, operatingMargin: null, operatingCashFlow: null, capex: null, freeCashFlow: null,
    dividends: null, buybacks: null, totalAssets: null, totalLiabilities: null, totalEquity: null, totalDebt: null,
    cash: null, forwardGuidance: [], evidence: [],
  };
  const marketFallback: FilingAnalysis["market"] = { industry: "", competitors: [], geographies: [], segments: [], externalResearchStatus: "unavailable" };
  const filingFinancials = (parts.financials as { financials: FilingAnalysis["financials"] } | undefined)?.financials ?? financialsFallback;
  const enrichedFinancials = attachRegulatoryAnnualHistory({ financials: filingFinancials }, regulatoryData).financials;

  // Coverage is a final-output property, not merely a filing-form property.
  // A Formulário de Referência may not contain full financial statements, but
  // official CVM DFP history can make the Financials module fully usable.
  const annualYears = enrichedFinancials.annualHistory?.years ?? [];
  if (annualYears.length >= 5) {
    diagnostics.financials = {
      status: "complete",
      confidence: 0.93,
      warnings: [
        ...(diagnostics.financials?.warnings ?? []),
        ...(diagnostics.financials?.status === "not_applicable" ? ["filing_financial_tables_not_applicable_external_history_used"] : []),
      ],
    };
    onStage("financials", {
      status: "complete",
      detail: lang === "pt"
        ? "Cinco anos de histórico financeiro oficial foram recuperados da CVM/SEC."
        : "Five years of official financial history were recovered from CVM/SEC.",
    });
  } else if (annualYears.length >= 2 && diagnostics.financials?.status === "not_applicable") {
    diagnostics.financials = {
      status: "incomplete",
      reason: "external_financial_history_partial",
      confidence: 0.82,
      missing: ["five annual regulatory periods"],
      warnings: ["filing_financial_tables_not_applicable_external_history_used"],
    };
    onStage("financials", { status: "partial", detail: friendlyReason("external_financial_history_partial", lang) });
  }

  const diagnosticMissing = Object.values(diagnostics).flatMap(item => item?.missing ?? []);
  const assembled: FilingAnalysis & { regulatoryData?: RegulatoryDataSnapshot } = {
    schemaVersion: "2.0", jurisdiction: market, metadata,
    company: profiler?.company ?? companyFallback,
    kpis: profiler?.kpis ?? [],
    market: (parts.market as MarketResult | undefined)?.market ?? marketFallback,
    risks: (parts.risks as { risks: FilingAnalysis["risks"] } | undefined)?.risks ?? [],
    financials: enrichedFinancials,
    timeline: (parts.historian as { timeline: FilingAnalysis["timeline"] } | undefined)?.timeline ?? [],
    events: (parts.historian as { events: FilingAnalysis["events"] } | undefined)?.events ?? [],
    historyValidationFlags: (parts.historian as { validationFlags?: FilingAnalysis["historyValidationFlags"] } | undefined)?.validationFlags ?? [],
    summary: summaryPart?.summary ?? [], confidenceNotes: summaryPart?.confidenceNotes ?? [],
    missingData: [...new Set([...(summaryPart?.missingData ?? []), ...diagnosticMissing])], diagnostics,
    ...(regulatoryData ? { regulatoryData } : {}),
  };

  try {
    const dashboardResponse = await fetch("/api/dashboard-data", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis: assembled }), signal,
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
