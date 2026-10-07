import {
  CheckCircle2,
  Circle,
  Database,
  FileSearch,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import type { PipelineExecution, PipelineStage, PipelineStatus } from "@/lib/analysis-pipeline";

type Props = {
  lang: "en" | "pt";
  execution: PipelineExecution;
  extracting: boolean;
  onCancel: () => void;
};

type StageMeta = {
  key: PipelineStage;
  en: string;
  pt: string;
  optional?: boolean;
};

type Phase = {
  id: string;
  en: string;
  pt: string;
  enDetail: string;
  ptDetail: string;
  icon: typeof FileSearch;
  stages: StageMeta[];
};

const PHASES: Phase[] = [
  {
    id: "intake",
    en: "Read & classify",
    pt: "Ler e classificar",
    enDetail: "Identify regulator, issuer and retrieve authoritative five-year history",
    ptDetail: "Identifica regulador e emissor e recupera cinco anos de histórico oficial",
    icon: FileSearch,
    stages: [
      { key: "metadata", en: "Regulatory metadata", pt: "Metadados regulatórios" },
      { key: "regulatoryData", en: "SEC/CVM five-year history", pt: "Histórico SEC/CVM de cinco anos" },
    ],
  },
  {
    id: "evidence",
    en: "Extract evidence",
    pt: "Extrair evidências",
    enDetail: "Profile, financials, market and risks · max 2 calls at once",
    ptDetail: "Perfil, finanças, mercado e riscos · máx. 2 chamadas simultâneas",
    icon: Database,
    stages: [
      { key: "profiler", en: "Company profile", pt: "Perfil da companhia" },
      { key: "financials", en: "Financial statements", pt: "Demonstrações financeiras" },
      { key: "market", en: "Market & segments", pt: "Mercado e segmentos" },
      { key: "risks", en: "Risk factors", pt: "Fatores de risco" },
    ],
  },
  {
    id: "validate",
    en: "Validate & enrich",
    pt: "Validar e enriquecer",
    enDetail: "Timeline validation and always-on cited competitive analysis",
    ptDetail: "Validação temporal e análise competitiva citada sempre ativa",
    icon: Globe2,
    stages: [
      { key: "historian", en: "Timeline & events", pt: "Linha do tempo e eventos" },
      { key: "marketResearch", en: "Competitive analysis", pt: "Análise competitiva" },
    ],
  },
  {
    id: "synthesis",
    en: "Synthesize & publish",
    pt: "Sintetizar e publicar",
    enDetail: "Consolidate supported findings, gaps and outputs",
    ptDetail: "Consolida conclusões, lacunas e saídas suportadas",
    icon: Sparkles,
    stages: [{ key: "synthesizer", en: "Executive synthesis", pt: "Síntese executiva" }],
  },
];

function isSettled(status: PipelineStatus) {
  return ["complete", "partial", "failed", "skipped"].includes(status);
}

function phaseStatus(phase: Phase, execution: PipelineExecution, extracting: boolean): PipelineStatus {
  if (phase.id === "intake" && extracting) return "running";
  const states = phase.stages.map(stage => execution[stage.key].status);
  if (states.some(status => status === "running")) return "running";
  if (states.some(status => status === "retrying")) return "retrying";
  if (states.every(isSettled)) {
    if (states.some(status => status === "failed")) return "failed";
    if (states.some(status => status === "partial")) return "partial";
    return "complete";
  }
  return "queued";
}

function statusLabel(status: PipelineStatus, lang: "en" | "pt") {
  const copy: Record<PipelineStatus, [string, string]> = {
    queued: ["Waiting", "Aguardando"],
    running: ["Running", "Executando"],
    retrying: ["Retrying", "Tentando novamente"],
    complete: ["Complete", "Concluído"],
    partial: ["Partial", "Parcial"],
    failed: ["Unavailable", "Indisponível"],
    skipped: ["Not needed", "Não necessário"],
  };
  return copy[status][lang === "pt" ? 1 : 0];
}

function iconFor(status: PipelineStatus) {
  if (status === "running") return <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" />;
  if (status === "retrying") return <RefreshCw className="h-4 w-4 animate-spin text-amber-300" />;
  if (status === "complete") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (status === "partial") return <TriangleAlert className="h-4 w-4 text-amber-300" />;
  if (status === "failed") return <TriangleAlert className="h-4 w-4 text-rose-300" />;
  return <Circle className="h-4 w-4 text-slate-600" />;
}

function tone(status: PipelineStatus) {
  if (status === "complete") return "border-emerald-500/25 bg-emerald-500/[0.06]";
  if (status === "running") return "border-cyan-400/45 bg-cyan-400/[0.07]";
  if (status === "retrying" || status === "partial") return "border-amber-500/35 bg-amber-500/[0.06]";
  if (status === "failed") return "border-rose-500/35 bg-rose-500/[0.06]";
  return "border-slate-800 bg-slate-950/25";
}

export default function AnalysisProgressV2({ lang, execution, extracting, onCancel }: Props) {
  const requiredStages = PHASES.flatMap(phase => phase.stages.filter(stage => !stage.optional));
  const settled = requiredStages.filter(stage => isSettled(execution[stage.key].status)).length;
  const progress = extracting ? 5 : Math.max(5, Math.round((settled / requiredStages.length) * 100));
  const currentPhase = PHASES.find(phase => ["running", "retrying"].includes(phaseStatus(phase, execution, extracting)))
    ?? PHASES.find(phase => phaseStatus(phase, execution, extracting) === "queued")
    ?? PHASES.at(-1)!;

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-slate-700/70 bg-[#0c1425]/95 shadow-2xl shadow-slate-950/30" aria-live="polite">
      <div className="border-b border-slate-800 bg-gradient-to-r from-blue-950/55 via-[#0c1425] to-cyan-950/35 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">{lang === "pt" ? "Pipeline de evidências" : "Evidence pipeline"}</p>
            <h3 className="mt-1 text-sm font-semibold text-white">{lang === "pt" ? currentPhase.pt : currentPhase.en}</h3>
            <p className="mt-1 text-xs text-slate-400">{lang === "pt" ? currentPhase.ptDetail : currentPhase.enDetail}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-cyan-500/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold tabular-nums text-cyan-100">{progress}%</span>
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-rose-400/60 hover:text-white">
              <X className="h-3.5 w-3.5" /> {lang === "pt" ? "Cancelar" : "Cancel"}
            </button>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-4">
        {PHASES.map((phase, index) => {
          const status = phaseStatus(phase, execution, extracting);
          const PhaseIcon = phase.icon;
          return (
            <div key={phase.id} className={`relative rounded-xl border p-3.5 ${tone(status)}`}>
              {index < PHASES.length - 1 && <div className="absolute -right-3 top-7 hidden h-px w-3 bg-slate-700 lg:block" />}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700/70 bg-slate-900/80"><PhaseIcon className="h-4 w-4 text-cyan-300" /></div>
                  <div><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">0{index + 1}</p><p className="text-xs font-semibold text-slate-100">{lang === "pt" ? phase.pt : phase.en}</p></div>
                </div>
                {iconFor(status)}
              </div>
              <div className="mt-3 space-y-2">
                {phase.stages.map(stage => {
                  const state = execution[stage.key];
                  return (
                    <div key={stage.key} className="rounded-lg border border-slate-800/80 bg-slate-950/35 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] font-medium text-slate-300">{lang === "pt" ? stage.pt : stage.en}</span>
                        <span className={`text-[8px] font-semibold uppercase tracking-wide ${state.status === "complete" ? "text-emerald-300" : state.status === "failed" ? "text-rose-300" : state.status === "partial" || state.status === "retrying" ? "text-amber-300" : state.status === "running" ? "text-cyan-300" : "text-slate-600"}`}>{statusLabel(state.status, lang)}</span>
                      </div>
                      {state.detail && <p className="mt-1 line-clamp-3 text-[9px] leading-relaxed text-slate-500">{state.detail}</p>}
                      {["running", "retrying"].includes(state.status) && state.attempt > 0 && <p className="mt-1 text-[8px] text-slate-600">{lang === "pt" ? "Tentativa" : "Attempt"} {state.attempt}/{state.maxAttempts}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-800 px-4 py-3 text-[10px] leading-relaxed text-slate-500">
        {lang === "pt"
          ? "A execução segue dependências explícitas: metadados → evidência principal (máx. 2 chamadas simultâneas) → validação/enriquecimento → síntese. “Parcial” indica lacuna de dados, não necessariamente falha do sistema."
          : "Execution follows explicit dependencies: metadata → core evidence (max 2 concurrent calls) → validation/enrichment → synthesis. “Partial” means a data gap, not necessarily a system failure."}
      </div>
    </section>
  );
}
