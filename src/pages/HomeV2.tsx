import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Database,
  FileJson,
  FileSearch,
  Globe2,
  Layers3,
  Plus,
  Presentation,
  Printer,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import AnalysisProgressV2 from "@/components/AnalysisProgressV2";
import DashboardV2 from "@/components/DashboardV2";
import ValuationWorkspace from "@/components/ValuationWorkspace";
import {
  executeAnalysisPipeline,
  initialPipelineExecution,
  PipelineCancelled,
  PipelineError,
  type PipelineExecution,
} from "@/lib/analysis-pipeline";
import type { FilingAnalysis, FilingClassification, ValuationBundle } from "@contracts/analysis";

type Market = "us" | "br";
type Lang = "en" | "pt";
type Phase = "idle" | "extracting" | "confirm" | "analyzing" | "done" | "error";

const MAX_DOCUMENTS = 6;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;

const COPY = {
  en: {
    brandSub: "filing intelligence · SEC + CVM",
    badge: "FILING-FIRST COMPANY INTELLIGENCE",
    h1: "Turn regulatory filings into a decision-ready company view.",
    lead: "Upload one or more related SEC or CVM PDFs. FilingLens retrieves filing evidence, cross-checks authoritative structured regulatory data, runs bounded specialist analysis, and publishes one validated contract to the dashboard and exports.",
    architecture: "How the system works",
    architectureCopy: "A dependency-aware evidence pipeline — not an opaque agent swarm.",
    phase1: "Read & classify",
    phase1d: "PDF extraction, issuer resolution + SEC/CVM five-year structured history",
    phase2: "Extract evidence",
    phase2d: "Profile, financials, market and risks · max 2 calls at once",
    phase3: "Validate & enrich",
    phase3d: "Timeline validation + always-on cited competitive analysis",
    phase4: "Synthesize & publish",
    phase4d: "One analysis contract → dashboard, JSON, PDF and PowerPoint",
    marketTitle: "1 · Choose filing jurisdiction",
    marketHelp: "The selected market guides classification; FilingLens still validates regulator signals inside the uploaded bundle.",
    us: "US Companies · SEC",
    br: "Empresas Brasileiras · CVM/B3",
    uploadTitle: "2 · Build the filing bundle",
    uploadHelp: "Add up to 6 related PDFs. Adding another file appends to the bundle rather than replacing earlier files.",
    drop: "Drop filing PDFs here",
    browse: "or click to add documents",
    addMore: "Add more PDFs",
    selected: "selected",
    analyze: "Analyze filing bundle",
    extracting: "Reading filing bundle…",
    analyzing: "Analysis running…",
    confirmTitle: "Confirm jurisdiction before analysis",
    confirmText: "The filing bundle contains mixed or low-confidence jurisdiction signals. Choose the regulator path that should govern this analysis.",
    configuredError: "The AI provider is not configured for this deployment. Filing analysis is disabled until configuration is restored.",
    cancel: "Cancel",
    complete: "Analysis complete",
    exportCopy: "The dashboard and all exports use the same validated FilingAnalysis contract.",
    pptx: "PowerPoint",
    pptxGenerating: "Generating PowerPoint…",
    json: "JSON",
    pdf: "Print / PDF",
    again: "New analysis",
    pptxError: "PowerPoint generation failed. Your analysis is preserved; retry the export without rerunning the filing analysis.",
    footer: "FilingLens · filing-first analysis · explicit provenance · informational use only",
    limits: "Up to 6 PDFs · 20 MB each · 60 MB total · text-based filings work best",
  },
  pt: {
    brandSub: "inteligência de filings · SEC + CVM",
    badge: "INTELIGÊNCIA DE COMPANHIAS PRIORIZANDO O DOCUMENTO",
    h1: "Transforme documentos regulatórios em uma visão empresarial pronta para decisão.",
    lead: "Envie um ou mais PDFs relacionados da SEC ou CVM. O FilingLens recupera evidências, cruza dados regulatórios estruturados e oficiais, executa análise especializada limitada e publica um único contrato validado no dashboard e nas exportações.",
    architecture: "Como o sistema funciona",
    architectureCopy: "Pipeline de evidências orientado por dependências — não um enxame opaco de agentes.",
    phase1: "Ler e classificar",
    phase1d: "Extração do PDF, resolução do emissor + histórico estruturado SEC/CVM de cinco anos",
    phase2: "Extrair evidências",
    phase2d: "Perfil, finanças, mercado e riscos · máx. 2 chamadas simultâneas",
    phase3: "Validar e enriquecer",
    phase3d: "Validação temporal + análise competitiva citada sempre ativa",
    phase4: "Sintetizar e publicar",
    phase4d: "Um contrato de análise → dashboard, JSON, PDF e PowerPoint",
    marketTitle: "1 · Escolha a jurisdição",
    marketHelp: "O mercado selecionado orienta a classificação; o FilingLens ainda valida os sinais regulatórios presentes no conjunto enviado.",
    us: "US Companies · SEC",
    br: "Empresas Brasileiras · CVM/B3",
    uploadTitle: "2 · Monte o conjunto de documentos",
    uploadHelp: "Adicione até 6 PDFs relacionados. Um novo arquivo é anexado ao conjunto em vez de substituir os anteriores.",
    drop: "Arraste os PDFs aqui",
    browse: "ou clique para adicionar documentos",
    addMore: "Adicionar mais PDFs",
    selected: "selecionados",
    analyze: "Analisar conjunto de documentos",
    extracting: "Lendo conjunto de documentos…",
    analyzing: "Análise em execução…",
    confirmTitle: "Confirme a jurisdição antes da análise",
    confirmText: "O conjunto contém sinais mistos ou de baixa confiança. Escolha a rota regulatória que deve governar esta análise.",
    configuredError: "O provedor de IA não está configurado neste deployment. A análise fica desabilitada até a configuração ser restaurada.",
    cancel: "Cancelar",
    complete: "Análise concluída",
    exportCopy: "O dashboard e todas as exportações usam o mesmo contrato FilingAnalysis validado.",
    pptx: "PowerPoint",
    pptxGenerating: "Gerando PowerPoint…",
    json: "JSON",
    pdf: "Imprimir / PDF",
    again: "Nova análise",
    pptxError: "Falha ao gerar o PowerPoint. A análise foi preservada; tente exportar novamente sem refazer a análise.",
    footer: "FilingLens · análise priorizando o documento · proveniência explícita · uso informacional",
    limits: "Até 6 PDFs · 20 MB cada · 60 MB no total · documentos com texto funcionam melhor",
  },
} as const;

const ERROR_COPY: Record<string, [string, string]> = {
  no_file: ["No file was received.", "Nenhum arquivo foi recebido."],
  file_too_large: ["One PDF is larger than 20 MB.", "Um dos PDFs é maior que 20 MB."],
  too_many_files: ["A bundle can contain at most 6 PDFs.", "O conjunto pode conter no máximo 6 PDFs."],
  bundle_too_large: ["The bundle is larger than 60 MB.", "O conjunto ultrapassa 60 MB."],
  unreadable_pdf: ["A PDF could not be read. Use a text-based regulatory PDF rather than an image-only scan.", "Não foi possível ler um PDF. Use um documento regulatório com texto, não apenas uma digitalização em imagem."],
  too_little_text: ["Too little filing text was extracted.", "Muito pouco texto foi extraído do documento."],
  ai_unavailable: ["Analysis quota/provider access is temporarily unavailable.", "A cota/acesso ao provedor está temporariamente indisponível."],
  ai_misconfigured: ["The analysis provider is misconfigured.", "O provedor de análise está mal configurado."],
  content_rejected: ["The provider rejected the document content.", "O provedor rejeitou o conteúdo do documento."],
  ai_transient: ["A required stage remained unavailable after one bounded retry.", "Um estágio necessário permaneceu indisponível após uma nova tentativa limitada."],
  internal: ["An internal request failed. The completed evidence has not been presented as complete analysis.", "Uma requisição interna falhou. A evidência concluída não foi apresentada como análise completa."],
  pipeline_cancelled: ["Analysis cancelled. The selected files remain available.", "Análise cancelada. Os arquivos selecionados permanecem disponíveis."],
};

function bytesMb(bytes: number) { return bytes / 1024 / 1024; }

function Architecture({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const steps = [
    [FileSearch, c.phase1, c.phase1d],
    [Database, c.phase2, c.phase2d],
    [Globe2, c.phase3, c.phase3d],
    [Layers3, c.phase4, c.phase4d],
  ] as const;
  return (
    <section className="mt-7 rounded-2xl border border-slate-800 bg-slate-900/45 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">{c.architecture}</p><p className="mt-1 text-xs text-slate-500">{c.architectureCopy}</p></div><span className="rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">dependency-aware · bounded</span></div>
      <div className="mt-5 grid gap-3 lg:grid-cols-4">{steps.map(([Icon, title, detail], index) => <div key={title} className="relative rounded-xl border border-slate-800 bg-[#0b1423]/85 p-4">{index < steps.length - 1 && <ArrowRight className="absolute -right-[17px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-slate-700 lg:block" />}<div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-500/20 bg-cyan-400/[0.07]"><Icon className="h-4 w-4 text-cyan-300" /></div><div><p className="text-[9px] font-semibold tracking-[0.14em] text-slate-600">0{index + 1}</p><p className="text-xs font-semibold text-slate-100">{title}</p></div></div><p className="mt-3 text-[10px] leading-relaxed text-slate-500">{detail}</p></div>)}</div>
    </section>
  );
}

export default function HomeV2() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [market, setMarket] = useState<Market>("us");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [analysis, setAnalysis] = useState<FilingAnalysis | null>(null);
  const [classification, setClassification] = useState<FilingClassification | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [execution, setExecution] = useState<PipelineExecution>(initialPipelineExecution);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pptxError, setPptxError] = useState(false);
  const [pptxGenerating, setPptxGenerating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const c = COPY[lang];

  useEffect(() => {
    fetch("/api/status").then(r => r.json()).then(body => setConfigured(Boolean(body.configured))).catch(() => setConfigured(false));
  }, []);

  const errorMessage = useCallback((code: string) => ERROR_COPY[code]?.[lang === "pt" ? 1 : 0] ?? code.replaceAll("_", " "), [lang]);

  const resetAnalysisOnly = () => {
    setAnalysis(null); setClassification(null); setPendingText(null); setExecution(initialPipelineExecution());
    setError(null); setPptxError(false); setPptxGenerating(false);
    if (phase !== "idle") setPhase("idle");
  };

  const addFiles = (selection: File[] | FileList | null | undefined) => {
    if (!selection || phase === "analyzing" || phase === "extracting") return;
    const incoming = Array.from(selection); if (!incoming.length) return;
    const combined = [...files];
    for (const file of incoming) {
      if (!file.name.toLowerCase().endsWith(".pdf")) { setError(lang === "pt" ? "Selecione somente arquivos PDF." : "Select PDF files only."); setPhase("error"); continue; }
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (!combined.some(item => `${item.name}|${item.size}|${item.lastModified}` === key)) combined.push(file);
    }
    if (combined.length > MAX_DOCUMENTS) { setError(errorMessage("too_many_files")); setPhase("error"); return; }
    if (combined.some(file => file.size > MAX_FILE_BYTES)) { setError(errorMessage("file_too_large")); setPhase("error"); return; }
    if (combined.reduce((sum, file) => sum + file.size, 0) > MAX_BUNDLE_BYTES) { setError(errorMessage("bundle_too_large")); setPhase("error"); return; }
    setFiles(combined); setAnalysis(null); setClassification(null); setPendingText(null); setExecution(initialPipelineExecution());
    setError(null); setPptxError(false); setPptxGenerating(false); setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (index: number) => { setFiles(current => current.filter((_, i) => i !== index)); resetAnalysisOnly(); };
  const cancel = () => controllerRef.current?.abort();

  const runAnalysis = async (text: string, confirmed: FilingClassification) => {
    const controller = new AbortController(); controllerRef.current = controller;
    setMarket(confirmed.jurisdiction); setClassification({ ...confirmed, needsConfirmation: false }); setExecution(initialPipelineExecution()); setError(null); setPhase("analyzing");
    try {
      const result = await executeAnalysisPipeline({ text, classification: { ...confirmed, needsConfirmation: false }, fileName: files[0]?.name ?? "filing.pdf", lang, signal: controller.signal, onStage: (stage, patch) => setExecution(prev => ({ ...prev, [stage]: { ...prev[stage], ...patch } })) });
      setAnalysis(result.analysis); setPendingText(null); setPhase("done");
    } catch (caught) {
      const code = caught instanceof PipelineCancelled ? "pipeline_cancelled" : caught instanceof PipelineError ? caught.code : "internal";
      setError(errorMessage(code)); setPhase("error");
    } finally { if (controllerRef.current === controller) controllerRef.current = null; }
  };

  const analyze = async () => {
    if (!files.length || configured !== true || phase === "extracting" || phase === "analyzing") return;
    const controller = new AbortController(); controllerRef.current = controller;
    setAnalysis(null); setError(null); setExecution(initialPipelineExecution()); setPhase("extracting");
    try {
      const form = new FormData(); files.forEach(file => form.append("file", file)); form.append("market", market);
      const response = await fetch("/api/extract", { method: "POST", body: form, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new PipelineError(typeof body.error === "string" ? body.error : "internal");
      if (typeof body.text !== "string" || !body.classification) throw new PipelineError("internal");
      const detected = body.classification as FilingClassification; setClassification(detected);
      if (detected.needsConfirmation) { setPendingText(body.text); setPhase("confirm"); controllerRef.current = null; return; }
      controllerRef.current = null; await runAnalysis(body.text, detected);
    } catch (caught) {
      const code = controller.signal.aborted ? "pipeline_cancelled" : caught instanceof PipelineError ? caught.code : "internal";
      setError(errorMessage(code)); setPhase("error"); if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const confirmJurisdiction = async (jurisdiction: Market) => {
    if (!pendingText || !classification) return;
    await runAnalysis(pendingText, { ...classification, jurisdiction, filingType: jurisdiction === classification.jurisdiction ? classification.filingType : jurisdiction === "br" ? "Documento CVM" : "SEC filing", confidence: 1, needsConfirmation: false });
  };

  const downloadJson = () => {
    if (!analysis) return;
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = href; a.download = `filing-analysis-${analysis.jurisdiction}-${Date.now()}.json`; a.click(); URL.revokeObjectURL(href);
  };

  const downloadPptx = async () => {
    if (!analysis || pptxGenerating) return;
    setPptxError(false); setPptxGenerating(true);
    try {
      const response = await fetch("/api/presentation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis, lang }),
      });
      if (!response.ok) throw new Error(`presentation_${response.status}`);
      const blob = await response.blob();
      if (blob.size < 5_000) throw new Error("presentation_empty");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const fileName = match?.[1] || `${analysis.company.name || "Company"}-FilingLens-Analysis.pptx`;
      const href = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = href; a.download = fileName; a.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch (caught) {
      console.error("Server-side PowerPoint generation failed", caught); setPptxError(true);
    } finally { setPptxGenerating(false); }
  };

  const reset = () => {
    controllerRef.current?.abort(); controllerRef.current = null;
    setFiles([]); setAnalysis(null); setClassification(null); setPendingText(null); setExecution(initialPipelineExecution()); setError(null); setPptxError(false); setPptxGenerating(false); setPhase("idle");
  };

  const handleValuationChange = useCallback((valuation: ValuationBundle) => setAnalysis(prev => prev ? { ...prev, valuation } : prev), []);
  const bundleBytes = files.reduce((sum, file) => sum + file.size, 0);
  const busy = phase === "extracting" || phase === "analyzing";

  return (
    <div className="min-h-screen bg-[#070c16] text-slate-100" style={{ backgroundImage: "radial-gradient(900px 500px at 70% -10%, rgba(37,99,235,.22), transparent 65%), radial-gradient(720px 460px at 5% 15%, rgba(6,182,212,.08), transparent 65%)" }}>
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-5 sm:px-6 lg:px-8">
        <nav className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-500/25 bg-cyan-400/10"><FileSearch className="h-5 w-5 text-cyan-300" /></div><div><p className="text-sm font-bold text-white">FilingLens</p><p className="text-[9px] uppercase tracking-[0.18em] text-slate-600">{c.brandSub}</p></div></div>
          <div className="flex rounded-full border border-slate-700 bg-slate-900/75 p-1">{(["en", "pt"] as Lang[]).map(item => <button key={item} type="button" onClick={() => setLang(item)} className={`rounded-full px-3.5 py-1.5 text-[10px] font-semibold transition ${lang === item ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white" : "text-slate-500 hover:text-white"}`}>{item === "en" ? "English" : "Português"}</button>)}</div>
        </nav>

        {phase !== "done" && <>
          <section className="mt-12 max-w-4xl"><span className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-200"><Sparkles className="h-3 w-3" />{c.badge}</span><h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl">{c.h1}</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">{c.lead}</p></section>
          <Architecture lang={lang} />
          {configured === false && <div className="mt-5 rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-4 text-xs text-amber-100">{c.configuredError}</div>}

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/45 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-sm font-semibold text-white">{c.marketTitle}</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{c.marketHelp}</p></div><div className="flex rounded-xl border border-slate-700 bg-slate-950/55 p-1">{(["us", "br"] as Market[]).map(item => <button key={item} type="button" disabled={busy} onClick={() => { setMarket(item); resetAnalysisOnly(); }} className={`rounded-lg px-4 py-2 text-[11px] font-semibold transition ${market === item ? "bg-slate-800 text-white shadow" : "text-slate-500 hover:text-slate-200"}`}>{item === "us" ? c.us : c.br}</button>)}</div></div>
            <div className="mt-6 border-t border-slate-800 pt-5"><h2 className="text-sm font-semibold text-white">{c.uploadTitle}</h2><p className="mt-1 text-xs text-slate-500">{c.uploadHelp}</p></div>

            {phase === "confirm" && classification ? <div className="mt-5 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-5"><p className="text-sm font-semibold text-amber-100">{c.confirmTitle}</p><p className="mt-2 text-xs leading-5 text-amber-100/70">{c.confirmText}</p><p className="mt-3 text-[10px] text-amber-200/70">Detected: {classification.jurisdiction === "br" ? "CVM / Brazil" : "SEC / United States"} · {classification.filingType} · {Math.round(classification.confidence * 100)}%</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><button onClick={() => confirmJurisdiction("br")} className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-semibold text-white hover:bg-emerald-500">CVM · Brasil</button><button onClick={() => confirmJurisdiction("us")} className="rounded-xl bg-blue-600 px-4 py-3 text-xs font-semibold text-white hover:bg-blue-500">SEC · United States</button></div></div> : <>
              <div onClick={() => !busy && inputRef.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }} className={`mt-5 cursor-pointer rounded-2xl border border-dashed px-5 py-8 text-center transition ${dragging ? "border-cyan-400 bg-cyan-500/[0.08]" : "border-slate-700 bg-slate-950/30 hover:border-cyan-500/45"}`}><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-slate-700 bg-slate-900"><Plus className="h-5 w-5 text-cyan-300" /></div><p className="mt-3 text-sm font-semibold text-slate-100">{files.length ? c.addMore : c.drop}</p><p className="mt-1 text-[11px] text-slate-500">{files.length ? `${files.length}/${MAX_DOCUMENTS} ${c.selected} · ${bytesMb(bundleBytes).toFixed(1)} MB` : c.browse}</p><input ref={inputRef} type="file" multiple accept=".pdf,application/pdf" className="hidden" onChange={event => addFiles(event.target.files)} /></div>
              {files.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{files.map((file, index) => <div key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[11px] font-medium text-slate-200">{index + 1}. {file.name}</p><p className="mt-0.5 text-[9px] text-slate-600">{bytesMb(file.size).toFixed(1)} MB · PDF</p></div><button type="button" disabled={busy} onClick={event => { event.stopPropagation(); removeFile(index); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}
              <button type="button" onClick={analyze} disabled={!files.length || busy || configured !== true} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/25 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="h-4 w-4" />{phase === "extracting" ? c.extracting : phase === "analyzing" ? c.analyzing : c.analyze}</button>
              <p className="mt-3 text-center text-[9px] text-slate-600">{c.limits}</p>
              {busy && <AnalysisProgressV2 lang={lang} execution={execution} extracting={phase === "extracting"} onCancel={cancel} />}
              {phase === "error" && error && <div className="mt-4 rounded-xl border border-rose-500/35 bg-rose-500/[0.07] p-4 text-xs leading-5 text-rose-100">{error}</div>}
            </>}
          </section>
        </>}

        {phase === "done" && analysis && <div className="mt-8">
          <div className="mb-5 rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/[0.06] via-slate-900/75 to-cyan-500/[0.05] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-emerald-300">{analysis.jurisdiction === "br" ? "CVM" : "SEC"} · {analysis.company.filingType}</span></div><h2 className="mt-2 text-xl font-semibold text-white">{c.complete}: {analysis.company.name}</h2><p className="mt-1 text-xs text-slate-500">{c.exportCopy}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={pptxGenerating} onClick={downloadPptx} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 px-3.5 py-2.5 text-[11px] font-semibold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60"><Presentation className="h-3.5 w-3.5" />{pptxGenerating ? c.pptxGenerating : c.pptx}</button><button type="button" onClick={downloadJson} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-[11px] font-semibold text-slate-200 hover:border-slate-500"><FileJson className="h-3.5 w-3.5" />{c.json}</button><button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-[11px] font-semibold text-slate-200 hover:border-slate-500"><Printer className="h-3.5 w-3.5" />{c.pdf}</button><button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-[11px] font-semibold text-slate-200 hover:border-slate-500"><RotateCcw className="h-3.5 w-3.5" />{c.again}</button></div></div>{pptxError && <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2 text-[10px] text-rose-200">{c.pptxError}</div>}</div>
          <DashboardV2 data={analysis} lang={lang} />
          <div className="mt-5"><ValuationWorkspace analysis={analysis} lang={lang} onChange={handleValuationChange} /></div>
        </div>}

        <footer className="mt-16 border-t border-slate-800 pt-6 text-center text-[9px] uppercase tracking-[0.12em] text-slate-700">{c.footer}</footer>
      </div>
    </div>
  );
}
