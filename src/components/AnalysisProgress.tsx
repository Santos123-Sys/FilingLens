import {
  CheckCircle2,
  Circle,
  Clock3,
  Globe2,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import type { AgentName } from "@contracts/analysis";

export type ExecutionStageKey = "metadata" | AgentName | "marketResearch";
export type ExecutionStatus = "queued" | "running" | "retrying" | "complete" | "degraded" | "skipped";

export type ExecutionStageState = {
  status: ExecutionStatus;
  attempt: number;
  maxAttempts: number;
  detail?: string;
};

export type ExecutionState = Record<ExecutionStageKey, ExecutionStageState>;

type Props = {
  lang: "en" | "pt";
  execution: ExecutionState;
  extracting: boolean;
  onCancel: () => void;
};

const STAGES: Array<{
  key: ExecutionStageKey;
  optional?: boolean;
  en: string;
  pt: string;
  enDetail: string;
  ptDetail: string;
}> = [
  { key: "metadata", en: "Regulator metadata", pt: "Metadados regulatórios", enDetail: "Classify filing type and reporting period", ptDetail: "Classifica tipo do documento e período reportado" },
  { key: "profiler", en: "Company profile", pt: "Perfil da companhia", enDetail: "Issuer identity, business description and filing KPIs", ptDetail: "Identidade, descrição do negócio e KPIs do documento" },
  { key: "market", en: "Market & competitors", pt: "Mercado e concorrentes", enDetail: "Filing-first industry, segments, geographies and peers", ptDetail: "Indústria, segmentos, geografias e concorrentes priorizando o documento" },
  { key: "marketResearch", optional: true, en: "Cited web peer research", pt: "Pesquisa web citada de concorrentes", enDetail: "Runs only if the filing contains no supported peers", ptDetail: "Executa apenas se o documento não trouxer concorrentes suportados" },
  { key: "risks", en: "Risk factors", pt: "Fatores de risco", enDetail: "Rank material filing-disclosed risks", ptDetail: "Classifica riscos materiais divulgados no documento" },
  { key: "financials", en: "Financial statements", pt: "Demonstrações financeiras", enDetail: "Historical series, ratios and validation screens", ptDetail: "Séries históricas, indicadores e validações" },
  { key: "historian", en: "Timeline & events", pt: "Linha do tempo e eventos", enDetail: "Validate dated events and company history", ptDetail: "Valida eventos datados e histórico da companhia" },
  { key: "synthesizer", en: "Executive synthesis", pt: "Síntese executiva", enDetail: "Consolidate supported findings and data gaps", ptDetail: "Consolida conclusões suportadas e lacunas de dados" },
];

function statusCopy(status: ExecutionStatus, lang: "en" | "pt") {
  const values = {
    queued: ["Queued", "Na fila"],
    running: ["Running", "Executando"],
    retrying: ["Retrying", "Tentando novamente"],
    complete: ["Complete", "Concluído"],
    degraded: ["Partial", "Parcial"],
    skipped: ["Skipped", "Ignorado"],
  } as const;
  return values[status][lang === "pt" ? 1 : 0];
}

function StatusIcon({ status }: { status: ExecutionStatus }) {
  if (status === "running") return <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" />;
  if (status === "retrying") return <RefreshCw className="h-4 w-4 animate-spin text-amber-300" />;
  if (status === "complete") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (status === "degraded") return <TriangleAlert className="h-4 w-4 text-amber-300" />;
  if (status === "skipped") return <Circle className="h-4 w-4 text-slate-600" />;
  return <Clock3 className="h-4 w-4 text-slate-500" />;
}

export default function AnalysisProgress({ lang, execution, extracting, onCancel }: Props) {
  const primary = STAGES.filter(stage => !stage.optional);
  const completed = primary.filter(stage => ["complete", "degraded", "skipped"].includes(execution[stage.key].status)).length;
  const progress = Math.round((completed / primary.length) * 100);
  const active = STAGES.find(stage => ["running", "retrying"].includes(execution[stage.key].status));

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/80 shadow-xl shadow-slate-950/20" aria-live="polite">
      <div className="border-b border-slate-700/70 bg-gradient-to-r from-blue-950/60 via-slate-900 to-cyan-950/30 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              {extracting ? <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" /> : <Globe2 className="h-4 w-4 text-cyan-300" />}
              {lang === "pt" ? "Execução da análise" : "Analysis execution"}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {extracting
                ? (lang === "pt" ? "Extraindo texto e classificando o documento…" : "Extracting text and classifying the filing…")
                : active
                  ? `${lang === "pt" ? active.pt : active.en} · ${lang === "pt" ? active.ptDetail : active.enDetail}`
                  : (lang === "pt" ? "Pipeline sequencial com degradação controlada." : "Sequential pipeline with controlled degradation.")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-cyan-500/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
              {extracting ? "0%" : `${progress}%`}
            </span>
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-red-400/60 hover:text-white">
              <X className="h-3.5 w-3.5" />
              {lang === "pt" ? "Cancelar" : "Cancel"}
            </button>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500" style={{ width: `${extracting ? 4 : Math.max(progress, 4)}%` }} />
        </div>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-2">
        {STAGES.map(stage => {
          const state = execution[stage.key];
          const isActive = ["running", "retrying"].includes(state.status);
          return (
            <div key={stage.key} className={`rounded-xl border px-3.5 py-3 transition ${isActive ? "border-cyan-500/50 bg-cyan-500/8" : state.status === "complete" ? "border-emerald-500/20 bg-emerald-500/5" : state.status === "degraded" ? "border-amber-500/30 bg-amber-500/5" : "border-slate-800 bg-slate-950/30"}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><StatusIcon status={state.status} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100">{lang === "pt" ? stage.pt : stage.en}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${state.status === "complete" ? "text-emerald-300" : state.status === "degraded" || state.status === "retrying" ? "text-amber-300" : isActive ? "text-cyan-300" : "text-slate-500"}`}>
                      {statusCopy(state.status, lang)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{state.detail || (lang === "pt" ? stage.ptDetail : stage.enDetail)}</p>
                  {(state.status === "running" || state.status === "retrying") && state.maxAttempts > 1 && (
                    <p className="mt-1 text-[10px] text-slate-600">{lang === "pt" ? "Tentativa" : "Attempt"} {Math.max(state.attempt, 1)}/{state.maxAttempts}</p>
                  )}
                  {stage.optional && state.status === "queued" && (
                    <span className="mt-1 inline-block rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">{lang === "pt" ? "Condicional" : "Conditional"}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-800 px-4 py-3 text-[10px] leading-relaxed text-slate-500">
        {lang === "pt"
          ? "O painel mostra estados operacionais, tentativas e fontes de enriquecimento — não expõe raciocínio interno do modelo. Cada chamada cara é limitada a uma única requisição; novas tentativas são iniciadas pelo navegador."
          : "This panel shows operational states, attempts and enrichment sources — not hidden model reasoning. Each expensive model call is bounded to one request; retries are started by the browser."}
      </div>
    </section>
  );
}
