import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileJson,
  FileSearch,
  Presentation,
  Printer,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Dashboard from "@/components/Dashboard";
import ValuationWorkspace from "@/components/ValuationWorkspace";
import AnalysisProgress, {
  type ExecutionStageKey,
  type ExecutionState,
} from "@/components/AnalysisProgress";
import { buildCompanyPowerPoint } from "@/lib/powerpoint";
import type {
  AgentName,
  AnalysisDiagnostics,
  FilingClassification,
  FilingAnalysis,
  MarketResult,
  MetadataResult,
  ModuleDiagnostic,
  ValuationBundle,
} from "@contracts/analysis";

type Market = "us" | "br";
type Lang = "en" | "pt";
type Phase = "idle" | "working" | "confirm" | "done" | "error";
type PresentationState = "idle" | "building" | "ready" | "error";

class PipelineCancelled extends Error {}
class PipelineRequestError extends Error {
  code: string;
  terminal: boolean;

  constructor(code: string, terminal = false) {
    super(code);
    this.code = code;
    this.terminal = terminal;
  }
}

const T: Record<Lang, Record<string, string>> = {
  en: {
    badge: "FILING → DASHBOARD → PRESENTATION · SEC + CVM",
    h1a: "Analyze the filing.",
    h1b: "Use the result immediately.",
    lead: "Attach a 10-K, 10-Q, 8-K or S-1 (US), or a Formulário de Referência, DFP, ITR or Fato Relevante (Brazil). FilingLens validates filing-derived facts, uses citation-backed web peer research only when required, renders the dashboard and prepares a professional PowerPoint deck.",
    s1t: "Pick your market",
    s1p: "Choose the filing jurisdiction — US Companies (SEC) or Empresas Brasileiras (CVM/B3). FilingLens also verifies the detected jurisdiction before analysis.",
    tabUs: "🇺🇸 US Companies",
    tabBr: "🇧🇷 Empresas Brasileiras",
    usDesc: "SEC path — 10-K, 10-Q, 8-K and S-1. FilingLens routes filing sections to bounded specialists and applies form-specific completeness checks.",
    brDesc: "CVM path — Formulário de Referência, DFP, ITR and Fato Relevante. FilingLens uses Portuguese retrieval anchors and document-specific completeness rules.",
    drop1us: "Drop your SEC filing PDF here",
    drop1br: "Drop your CVM filing PDF here",
    drop2: "or click to browse — PDF only",
    analyze: "Analyze filing",
    analyzing: "Analysis in progress",
    extracting: "Reading and classifying the filing…",
    confirmTitle: "Confirm the filing jurisdiction",
    confirmText: "The document contains mixed or low-confidence jurisdiction signals. Confirm the regulator path before analysis begins.",
    detected: "Detected",
    done: "Analysis complete",
    download: "Download data",
    deck: "Download PowerPoint",
    deckBuilding: "Preparing PowerPoint…",
    deckError: "PowerPoint unavailable",
    again: "Analyze another filing",
    privacy: "Operational progress is visible; private model reasoning is not displayed.",
    tipUs: "Best results: use the official text-based PDF from SEC EDGAR, up to 20 MB.",
    tipBr: "Best results: use the official text-based PDF from CVM Empresas.NET, up to 20 MB.",
    err_no_file: "No file received. Please attach the filing PDF.",
    err_file_too_large: "The PDF is larger than 20 MB.",
    err_unreadable_pdf: "This PDF could not be read (it may be scanned/image-only or corrupted). Try a text-based PDF.",
    err_too_little_text: "Very little text was extracted — this doesn't look like a complete filing.",
    err_ai_unavailable: "Analysis quota exhausted — this feature is temporarily unavailable.",
    err_content_rejected: "The document was rejected by the content filter.",
    err_ai_misconfigured: "The analysis engine is misconfigured. Ask the administrator to configure the AI provider.",
    err_ai_transient: "The analysis service timed out or remained unavailable after bounded retries. You can run the filing again.",
    err_internal: "Something went wrong on our side. Please try again.",
    err_cancelled: "Analysis cancelled. The file is still selected and can be analyzed again.",
    footer: "FilingLens · Public regulatory filings (SEC EDGAR / CVM) · Filing-first analysis · Informational use only — not investment advice.",
  },
  pt: {
    badge: "DOCUMENTO → DASHBOARD → APRESENTAÇÃO · SEC + CVM",
    h1a: "Analise o documento.",
    h1b: "Use o resultado imediatamente.",
    lead: "Anexe um 10-K, 10-Q, 8-K ou S-1 (EUA), ou um Formulário de Referência, DFP, ITR ou Fato Relevante (Brasil). O FilingLens valida fatos extraídos do documento, usa pesquisa web citada de concorrentes apenas quando necessária, gera o dashboard e prepara um PowerPoint profissional.",
    s1t: "Escolha seu mercado",
    s1p: "Selecione a jurisdição — US Companies (SEC) ou Empresas Brasileiras (CVM/B3). O FilingLens também verifica a jurisdição detectada antes da análise.",
    tabUs: "🇺🇸 US Companies",
    tabBr: "🇧🇷 Empresas Brasileiras",
    usDesc: "Rota SEC — 10-K, 10-Q, 8-K e S-1. O FilingLens encaminha seções do documento a especialistas limitados e aplica controles de completude por formulário.",
    brDesc: "Rota CVM — Formulário de Referência, DFP, ITR e Fato Relevante. O FilingLens usa âncoras em português e regras de completude específicas por documento.",
    drop1us: "Arraste o PDF do documento SEC aqui",
    drop1br: "Arraste o PDF do documento CVM aqui",
    drop2: "ou clique para procurar — somente PDF",
    analyze: "Analisar documento",
    analyzing: "Análise em andamento",
    extracting: "Lendo e classificando o documento…",
    confirmTitle: "Confirme a jurisdição do documento",
    confirmText: "O documento contém sinais mistos ou de baixa confiança. Confirme a rota regulatória antes do início da análise.",
    detected: "Detectado",
    done: "Análise concluída",
    download: "Baixar dados",
    deck: "Baixar PowerPoint",
    deckBuilding: "Preparando PowerPoint…",
    deckError: "PowerPoint indisponível",
    again: "Analisar outro documento",
    privacy: "O progresso operacional é visível; o raciocínio privado do modelo não é exibido.",
    tipUs: "Melhores resultados: use o PDF oficial com texto do SEC EDGAR, de até 20 MB.",
    tipBr: "Melhores resultados: use o PDF oficial com texto do CVM Empresas.NET, de até 20 MB.",
    err_no_file: "Nenhum arquivo recebido. Anexe o PDF do documento.",
    err_file_too_large: "O PDF é maior que 20 MB.",
    err_unreadable_pdf: "Não foi possível ler este PDF (pode ser digitalizado como imagem ou estar corrompido). Tente um PDF com texto.",
    err_too_little_text: "Muito pouco texto foi extraído — isto não parece um documento completo.",
    err_ai_unavailable: "A cota de análise se esgotou — o recurso está temporariamente indisponível.",
    err_content_rejected: "O documento foi rejeitado pelo filtro de conteúdo.",
    err_ai_misconfigured: "O motor de análise está mal configurado. Peça ao administrador para configurar o provedor de IA.",
    err_ai_transient: "O serviço de análise expirou ou permaneceu indisponível após tentativas limitadas. Você pode executar novamente.",
    err_internal: "Algo deu errado do nosso lado. Tente novamente.",
    err_cancelled: "Análise cancelada. O arquivo continua selecionado e pode ser analisado novamente.",
    footer: "FilingLens · Documentos regulatórios públicos (SEC EDGAR / CVM) · Análise priorizando o documento · Uso informacional — não constitui recomendação de investimento.",
  },
};

const AGENTS: { key: AgentName; en: string; pt: string }[] = [
  { key: "profiler", en: "Company profile", pt: "Perfil da companhia" },
  { key: "market", en: "Market & competitors", pt: "Mercado e concorrentes" },
  { key: "risks", en: "Risk factors", pt: "Fatores de risco" },
  { key: "financials", en: "Financial statements", pt: "Demonstrações financeiras" },
  { key: "historian", en: "Timeline & events", pt: "Linha do tempo e eventos" },
  { key: "synthesizer", en: "Executive summary", pt: "Resumo executivo" },
];

const PRIMARY_STAGE_KEYS: ExecutionStageKey[] = ["metadata", ...AGENTS.map(agent => agent.key), "marketResearch"];

function initialExecution(): ExecutionState {
  return Object.fromEntries(PRIMARY_STAGE_KEYS.map(key => [key, {
    status: "queued",
    attempt: 0,
    maxAttempts: key === "marketResearch" ? 2 : 2,
  }])) as ExecutionState;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function Home() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => { fetch("/api/status").then(r => r.json()).then(s => setConfigured(s.configured)).catch(() => setConfigured(false)); }, []);
  const [lang, setLang] = useState<Lang>("en");
  const [market, setMarket] = useState<Market>("us");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FilingAnalysis | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [classification, setClassification] = useState<FilingClassification | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [execution, setExecution] = useState<ExecutionState>(initialExecution);
  const [presentationState, setPresentationState] = useState<PresentationState>("idle");
  const [presentationBlob, setPresentationBlob] = useState<Blob | null>(null);
  const [presentationName, setPresentationName] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const t = useCallback((k: string) => T[lang][k] ?? k, [lang]);

  const updateExecution = (key: ExecutionStageKey, patch: Partial<ExecutionState[ExecutionStageKey]>) => {
    setExecution(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleValuationChange = useCallback((valuation: ValuationBundle) => {
    setAnalysis(prev => prev ? { ...prev, valuation } : prev);
  }, []);

  const cancelAnalysis = () => {
    cancelledRef.current = true;
    activeRequestRef.current?.abort();
  };

  const requestJson = async (
    url: string,
    init: RequestInit,
    stage?: ExecutionStageKey,
    maxAttempts = 2,
  ): Promise<Record<string, unknown>> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancelledRef.current) throw new PipelineCancelled();
      const controller = new AbortController();
      activeRequestRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort("stage_timeout"), 90_000);
      if (stage) updateExecution(stage, { status: attempt > 1 ? "retrying" : "running", attempt, maxAttempts });
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return body;
        const code = typeof body.error === "string" ? body.error : "internal";
        const terminal = ["ai_unavailable", "ai_misconfigured", "content_rejected"].includes(code);
        const transient = code === "ai_transient" || response.status >= 500;
        if (terminal) throw new PipelineRequestError(code, true);
        if (transient && attempt < maxAttempts) {
          if (stage) updateExecution(stage, { status: "retrying", attempt, detail: lang === "pt" ? "Resposta transitória; nova requisição limitada será iniciada." : "Transient response; starting a new bounded request." });
          await sleep(650 * attempt);
          continue;
        }
        throw new PipelineRequestError(code, false);
      } catch (requestError) {
        if (cancelledRef.current) throw new PipelineCancelled();
        if (requestError instanceof PipelineRequestError) throw requestError;
        if (attempt < maxAttempts) {
          if (stage) updateExecution(stage, { status: "retrying", attempt, detail: lang === "pt" ? "A requisição expirou; tentando novamente em uma nova chamada." : "The request timed out; retrying in a new call." });
          await sleep(650 * attempt);
          continue;
        }
        throw new PipelineRequestError("ai_transient", false);
      } finally {
        window.clearTimeout(timeout);
        if (activeRequestRef.current === controller) activeRequestRef.current = null;
      }
    }
    throw new PipelineRequestError("ai_transient", false);
  };

  useEffect(() => {
    if (!analysis) {
      setPresentationState("idle");
      setPresentationBlob(null);
      setPresentationName("");
      return;
    }
    let active = true;
    setPresentationState("building");
    setPresentationBlob(null);
    const timer = window.setTimeout(() => {
      try {
        const deck = buildCompanyPowerPoint(analysis, lang);
        if (!active) return;
        setPresentationBlob(new Blob([deck.bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
        setPresentationName(deck.fileName);
        setPresentationState("ready");
      } catch (deckError) {
        console.error("PowerPoint generation failed", deckError);
        if (active) setPresentationState("error");
      }
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [analysis, lang]);

  const pick = (f: File | undefined | null) => {
    if (!f || phase === "working") return;
    if (!f.name.toLowerCase().endsWith(".pdf") || f.size > 20 * 1024 * 1024) {
      setError(lang === "pt" ? "Selecione um PDF de até 20 MB." : "Select a PDF up to 20 MB.");
      setPhase("error");
      return;
    }
    setFile(f);
    setError(null);
    setPhase("idle");
    setAnalysis(null);
    setClassification(null);
    setPendingText(null);
    setExecution(initialExecution());
  };

  const runPipeline = async (text: string, confirmed: FilingClassification) => {
    cancelledRef.current = false;
    setPhase("working");
    setExtracting(false);
    setMarket(confirmed.jurisdiction);
    setClassification({ ...confirmed, needsConfirmation: false });
    setExecution(initialExecution());
    try {
      const planBody = await requestJson("/api/analysis-plan", { method: "GET" }, undefined, 1).catch(() => ({}));
      const plannedCandidates: unknown[] = Array.isArray(planBody.agents) ? planBody.agents : [];
      const managedAgents: AgentName[] = plannedCandidates.filter(
        (agent): agent is AgentName => typeof agent === "string" && AGENTS.some(item => item.key === agent),
      );
      if (managedAgents.length === 0) managedAgents.push(...AGENTS.map(item => item.key));

      const diagnostics: AnalysisDiagnostics = {};
      const failedAgents: string[] = [];
      const metadataBody = await requestJson("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, classification: confirmed }),
      }, "metadata", 2);

      const fallbackMetadata: MetadataResult["metadata"] = {
        jurisdiction: confirmed.jurisdiction,
        filingType: confirmed.filingType,
        reportingPeriod: null,
        filedAt: null,
        confidence: confirmed.confidence,
        cnpj: null,
        cvmDocumentClass: confirmed.jurisdiction === "br" ? confirmed.filingType : null,
        registryData: null,
        cik: null,
        sicCode: null,
        fiscalYearEnd: null,
        stateOfIncorporation: null,
        sources: [],
      };
      const metadata = (metadataBody.result as MetadataResult | undefined)?.metadata ?? fallbackMetadata;
      diagnostics.metadata = (metadataBody.diagnostic as ModuleDiagnostic | undefined) ?? { status: "incomplete", reason: "metadata_diagnostic_missing" };
      const metadataPartial = diagnostics.metadata.status !== "complete";
      updateExecution("metadata", { status: metadataPartial ? "degraded" : "complete", detail: metadataPartial ? diagnostics.metadata.reason : undefined });
      if (diagnostics.metadata.status === "failed") failedAgents.push("metadata");

      const parts: Record<string, unknown> = {};
      for (const agent of managedAgents) {
        try {
          const abody = await requestJson("/api/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agent,
              market: confirmed.jurisdiction,
              filingType: metadata.filingType || confirmed.filingType,
              filingDate: metadata.filedAt,
              text,
              priorResults: agent === "synthesizer" ? parts : undefined,
            }),
          }, agent, 2);
          parts[agent] = abody.result;
          diagnostics[agent] = (abody.diagnostic as ModuleDiagnostic | undefined)?.status
            ? abody.diagnostic
            : { status: "incomplete", reason: "response_diagnostic_missing" };
          updateExecution(agent, {
            status: diagnostics[agent]?.status === "complete" || diagnostics[agent]?.status === "not_applicable" ? "complete" : "degraded",
            detail: diagnostics[agent]?.reason,
          });

          if (agent === "market") {
            const marketResult = abody.result as MarketResult;
            if ((marketResult?.market?.competitors?.length ?? 0) === 0) {
              try {
                const researchBody = await requestJson("/api/market-research", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ jurisdiction: confirmed.jurisdiction, text, marketResult }),
                }, "marketResearch", 2);
                const enriched = researchBody.result as MarketResult;
                parts.market = enriched;
                diagnostics.market = (researchBody.diagnostic as ModuleDiagnostic | undefined) ?? diagnostics.market;
                updateExecution("marketResearch", {
                  status: enriched.market.externalResearchStatus === "complete" ? "complete" : "degraded",
                  detail: enriched.market.externalResearchStatus === "complete"
                    ? (lang === "pt" ? "Concorrentes externos aceitos somente com URLs citadas pelo provedor de pesquisa." : "External peers accepted only with URLs cited by the search provider.")
                    : (lang === "pt" ? "A pesquisa terminou sem concorrentes externos citáveis." : "Research completed without citable external peers."),
                });
              } catch (researchError) {
                if (researchError instanceof PipelineCancelled) throw researchError;
                marketResult.market.externalResearchStatus = "unavailable";
                parts.market = marketResult;
                updateExecution("marketResearch", { status: "degraded", detail: lang === "pt" ? "Enriquecimento web indisponível; a análise do documento foi preservada." : "Web enrichment unavailable; filing analysis was preserved." });
              }
            } else {
              updateExecution("marketResearch", { status: "skipped", attempt: 0, detail: lang === "pt" ? "O documento já continha concorrentes com evidência verificável." : "The filing already contained competitors with verifiable evidence." });
            }
          }
        } catch (agentError) {
          if (agentError instanceof PipelineCancelled || (agentError instanceof PipelineRequestError && agentError.terminal)) throw agentError;
          failedAgents.push(agent);
          diagnostics[agent] = { status: "failed", reason: "agent_request_failed" };
          updateExecution(agent, { status: "degraded", detail: lang === "pt" ? "Módulo indisponível após tentativas limitadas; os demais módulos continuam." : "Module unavailable after bounded retries; remaining modules continue." });
          if (agent === "market") updateExecution("marketResearch", { status: "skipped", detail: lang === "pt" ? "Não executada porque o estágio de mercado não retornou contexto utilizável." : "Not run because the market stage returned no usable context." });
        }
      }

      const prof = parts.profiler as { company: FilingAnalysis["company"]; kpis: FilingAnalysis["kpis"] } | undefined;
      const summaryPart = parts.synthesizer as { summary: FilingAnalysis["summary"]; confidenceNotes?: FilingAnalysis["confidenceNotes"]; missingData?: string[] } | undefined;
      const companyFallback: FilingAnalysis["company"] = {
        name: file?.name.replace(/\.pdf$/i, "") ?? "Filing",
        ticker: null,
        exchange: null,
        filingType: metadata.filingType || confirmed.filingType,
        periodEnd: metadata.reportingPeriod ?? "",
        filedAt: metadata.filedAt,
        description: lang === "pt" ? "Perfil não disponível para este documento." : "Profile unavailable for this filing.",
      };
      const financialsFallback: FilingAnalysis["financials"] = {
        unit: confirmed.jurisdiction === "br" ? "R$ milhões" : "USD millions",
        years: [], revenue: [], netIncome: [], eps: null, grossMargin: null,
        operatingMargin: null, operatingCashFlow: null, capex: null, freeCashFlow: null,
        dividends: null, buybacks: null, totalAssets: null, totalLiabilities: null,
        totalEquity: null, totalDebt: null, cash: null, forwardGuidance: [], evidence: [],
      };
      const marketFallback: FilingAnalysis["market"] = { industry: "", competitors: [], geographies: [], segments: [], externalResearchStatus: "unavailable" };
      const diagnosticMissing = Object.values(diagnostics).flatMap(item => item?.missing ?? []);
      const assembled: FilingAnalysis = {
        schemaVersion: "2.0",
        jurisdiction: confirmed.jurisdiction,
        metadata,
        company: prof?.company ?? companyFallback,
        kpis: prof?.kpis ?? [],
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
      const dashboard = await requestJson("/api/dashboard-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: assembled }),
      }, undefined, 1).catch(() => null);
      setAnalysis(dashboard?.dashboard ? { ...assembled, prebuiltDashboard: dashboard.dashboard as FilingAnalysis["prebuiltDashboard"] } : assembled);
      setFailed(failedAgents);
      setPendingText(null);
      setPhase("done");
    } catch (pipelineError) {
      if (pipelineError instanceof PipelineCancelled) {
        setError(t("err_cancelled"));
      } else if (pipelineError instanceof PipelineRequestError) {
        setError(t(`err_${pipelineError.code}`));
      } else {
        setError(t("err_ai_transient"));
      }
      setPhase("error");
    } finally {
      setExtracting(false);
      activeRequestRef.current = null;
    }
  };

  const analyze = async () => {
    if (!file || phase === "working") return;
    cancelledRef.current = false;
    setPhase("working");
    setExtracting(true);
    setError(null);
    setAnalysis(null);
    setFailed([]);
    setExecution(initialExecution());
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("market", market);
      const body = await requestJson("/api/extract", { method: "POST", body: form }, undefined, 1);
      if (typeof body.text !== "string" || !body.classification) throw new PipelineRequestError("internal");
      const detected = body.classification as FilingClassification;
      setClassification(detected);
      setExtracting(false);
      if (detected.needsConfirmation) {
        setPendingText(body.text);
        setPhase("confirm");
        return;
      }
      await runPipeline(body.text, detected);
    } catch (extractError) {
      if (extractError instanceof PipelineCancelled) setError(t("err_cancelled"));
      else if (extractError instanceof PipelineRequestError) setError(t(`err_${extractError.code}`));
      else setError(t("err_internal"));
      setExtracting(false);
      setPhase("error");
    }
  };

  const confirmJurisdiction = async (jurisdiction: Market) => {
    if (!pendingText || !classification) return;
    const filingType = jurisdiction === classification.jurisdiction
      ? classification.filingType
      : jurisdiction === "br" ? "Documento CVM" : "SEC filing";
    await runPipeline(pendingText, { ...classification, jurisdiction, filingType, confidence: 1, needsConfirmation: false });
  };

  const downloadJson = () => {
    if (!analysis) return;
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `filing-analysis-v2-${analysis.jurisdiction}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadPresentation = () => {
    if (!presentationBlob || presentationState !== "ready") return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(presentationBlob);
    a.download = presentationName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const reset = () => {
    cancelledRef.current = true;
    activeRequestRef.current?.abort();
    setFile(null);
    setAnalysis(null);
    setFailed([]);
    setPhase("idle");
    setExtracting(false);
    setError(null);
    setClassification(null);
    setPendingText(null);
    setExecution(initialExecution());
    setPresentationBlob(null);
    setPresentationState("idle");
  };

  return (
    <div className="min-h-screen bg-[#080d18] text-slate-100" style={{ backgroundImage: "radial-gradient(1000px 480px at 72% -10%, rgba(37,99,235,.25) 0%, rgba(8,13,24,0) 62%), radial-gradient(700px 420px at 10% 15%, rgba(8,145,178,.10) 0%, rgba(8,13,24,0) 60%)" }}>
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-6">
        <nav className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-500/30 bg-cyan-400/10"><FileSearch className="h-4.5 w-4.5 text-cyan-300" /></div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">FilingLens</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">SEC + CVM intelligence</div>
            </div>
          </div>
          <div className="flex rounded-full border border-slate-700 bg-slate-900/70 p-1 shadow-lg shadow-slate-950/20">
            {(["en", "pt"] as Lang[]).map(l => (
              <button key={l} onClick={() => setLang(l)} className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${lang === l ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white" : "text-slate-400 hover:text-white"}`}>
                {l === "en" ? "English" : "Português"}
              </button>
            ))}
          </div>
        </nav>

        {configured === false && (
          <div role="status" className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-200">
            {lang === "pt" ? "A análise requer a configuração segura do provedor de IA. Nenhum documento será enviado até a configuração estar pronta." : "Document analysis requires the AI provider to be configured securely. No filing will be sent until configuration is ready."}
          </div>
        )}

        {phase !== "done" && (
          <>
            <section className="max-w-4xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-200"><Sparkles className="h-3 w-3" />{t("badge")}</span>
              <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{t("h1a")} <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">{t("h1b")}</span></h1>
              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-slate-400">{t("lead")}</p>
            </section>

            <div className="mt-7 grid gap-3 md:grid-cols-3">
              {[
                [ShieldCheck, lang === "pt" ? "Documento primeiro" : "Filing first", lang === "pt" ? "Fatos financeiros e operacionais permanecem vinculados ao documento regulatório." : "Financial and operating facts remain anchored to the regulatory filing."],
                [FileSearch, lang === "pt" ? "Pesquisa web limitada" : "Bounded web research", lang === "pt" ? "A web é usada apenas para concorrentes e somente com URLs citadas." : "The web is used only for peers and only when citation URLs are returned."],
                [Presentation, lang === "pt" ? "PowerPoint automático" : "Automatic PowerPoint", lang === "pt" ? "Após a análise, um deck profissional é preparado com os mesmos dados validados." : "After analysis, a professional deck is prepared from the same validated data."],
              ].map(([Icon, heading, copy]) => {
                const FeatureIcon = Icon as typeof ShieldCheck;
                return <div key={String(heading)} className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4"><FeatureIcon className="h-4 w-4 text-cyan-300" /><h3 className="mt-3 text-xs font-semibold text-slate-100">{String(heading)}</h3><p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{String(copy)}</p></div>;
              })}
            </div>

            <section className="mt-9 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-sm font-semibold text-white">{t("s1t")}</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t("s1p")}</p></div>
                <div className="flex rounded-xl border border-slate-700 bg-slate-950/60 p-1">
                  {(["us", "br"] as Market[]).map(m => (
                    <button key={m} disabled={phase === "working"} onClick={() => { setMarket(m); reset(); setMarket(m); }} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${market === m ? "bg-slate-800 text-white shadow" : "text-slate-500 hover:text-slate-200"}`}>
                      {m === "us" ? t("tabUs") : t("tabBr")}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-slate-400">{market === "us" ? t("usDesc") : t("brDesc")}</p>

              {phase === "confirm" && classification && (
                <div className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-400/8 p-5" role="alert">
                  <h2 className="text-sm font-bold text-amber-100">{t("confirmTitle")}</h2>
                  <p className="mt-2 text-xs leading-relaxed text-amber-100/75">{t("confirmText")}</p>
                  <p className="mt-3 text-[11px] text-amber-200/80">{t("detected")}: {classification.jurisdiction === "br" ? "CVM / Brazil" : "SEC / United States"} · {classification.filingType} · {Math.round(classification.confidence * 100)}%</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2"><button onClick={() => confirmJurisdiction("br")} className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white hover:bg-emerald-500">CVM · Brasil</button><button onClick={() => confirmJurisdiction("us")} className="rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold text-white hover:bg-blue-500">SEC · United States</button></div>
                </div>
              )}

              {phase !== "confirm" && (
                <>
                  <div onClick={() => phase !== "working" && inputRef.current?.click()} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }} className={`mt-5 cursor-pointer rounded-2xl border border-dashed p-9 text-center transition ${dragOver ? "border-cyan-400 bg-cyan-500/8" : "border-slate-700 bg-slate-950/35 hover:border-cyan-500/50"}`}>
                    <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-slate-700 bg-slate-900"><FileSearch className="h-5 w-5 text-cyan-300" /></div>
                    <div className="mt-3 text-sm font-semibold text-slate-100">{file ? file.name : market === "us" ? t("drop1us") : t("drop1br")}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : t("drop2")}</div>
                    <span className="mt-4 inline-block rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-[10px] text-slate-500">{market === "us" ? "PDF · 10-K · 10-Q · 8-K · S-1" : "PDF · FRE · DFP · ITR · Fato Relevante"}</span>
                    <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={e => pick(e.target.files?.[0])} />
                  </div>

                  <button onClick={analyze} disabled={!file || phase === "working" || configured !== true} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-950/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                    <Sparkles className="h-4 w-4" />{phase === "working" ? (extracting ? t("extracting") : t("analyzing")) : t("analyze")}
                  </button>

                  {phase === "working" && <AnalysisProgress lang={lang} execution={execution} extracting={extracting} onCancel={cancelAnalysis} />}
                  {phase === "error" && error && <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/8 p-4 text-xs text-red-200">{error}</div>}
                </>
              )}

              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-[11px] leading-relaxed text-cyan-100/80 sm:flex-row sm:items-center sm:justify-between">
                <span>{market === "us" ? t("tipUs") : t("tipBr")}</span><span className="text-slate-500">{t("privacy")}</span>
              </div>
            </section>
          </>
        )}

        {phase === "done" && analysis && (
          <div className="mt-3">
            <div className="mb-5 rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/8 via-slate-900/70 to-cyan-500/8 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">{analysis.jurisdiction === "br" ? "CVM" : "SEC"} · {analysis.company.filingType}</span><h2 className="mt-1 text-xl font-bold text-white">{t("done")}: {analysis.company.name}</h2><p className="mt-1 text-xs text-slate-400">{lang === "pt" ? "Dashboard e artefatos de exportação usam a mesma análise validada." : "The dashboard and export artifacts use the same validated analysis."}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={downloadPresentation} disabled={presentationState !== "ready"} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2.5 text-xs font-bold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"><Presentation className="h-3.5 w-3.5" />{presentationState === "building" ? t("deckBuilding") : presentationState === "error" ? t("deckError") : t("deck")}</button>
                  <button onClick={downloadJson} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-500"><FileJson className="h-3.5 w-3.5" />JSON</button>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-500"><Printer className="h-3.5 w-3.5" />PDF</button>
                  <button onClick={reset} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-500"><RotateCcw className="h-3.5 w-3.5" />{t("again")}</button>
                </div>
              </div>
            </div>

            {failed.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/8 p-4 text-xs text-amber-200">
                {lang === "pt" ? "Alguns módulos foram degradados" : "Some modules were degraded"}: {failed.map(f => (lang === "pt" ? AGENTS.find(a => a.key === f)?.pt : AGENTS.find(a => a.key === f)?.en) ?? f).join(" · ")}. {lang === "pt" ? "O dashboard e o PowerPoint mostram apenas os dados que permaneceram disponíveis." : "The dashboard and PowerPoint use only the data that remained available."}
              </div>
            )}
            <Dashboard data={analysis} lang={lang} />
            <ValuationWorkspace analysis={analysis} lang={lang} onChange={handleValuationChange} />
          </div>
        )}

        <footer className="mt-16 border-t border-slate-800 pt-6 text-center text-[10px] leading-relaxed text-slate-600">{t("footer")}</footer>
      </div>
    </div>
  );
}
