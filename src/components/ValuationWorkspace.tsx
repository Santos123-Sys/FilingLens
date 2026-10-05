import { useEffect, useMemo, useState } from "react";
import { Calculator, Check, ExternalLink, RefreshCw, ShieldCheck, X } from "lucide-react";
import type {
  CompsValuationResult,
  DcfValuationResult,
  FilingAnalysis,
  ValuationAssumption,
  ValuationAssumptionValue,
  ValuationBundle,
  ValuationMethod,
  ValuationReconciliation,
} from "@contracts/analysis";

type Lang = "en" | "pt";

type ProposalResponse = {
  proposal: {
    method: ValuationMethod;
    status: "awaiting_validation";
    assumptions: ValuationAssumption[];
    notes: string[];
  };
};

type MethodState = {
  assumptions: ValuationAssumption[];
  notes: string[];
  loading: boolean;
  calculating: boolean;
  error: string | null;
};

const emptyState = (): MethodState => ({
  assumptions: [],
  notes: [],
  loading: false,
  calculating: false,
  error: null,
});

function displayValue(value: ValuationAssumptionValue | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function figure(value: number | null, unit: string, locale: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  return unit === "x" ? `${formatted}x` : unit === "%" ? `${formatted}%` : `${formatted} ${unit}`;
}

function isPeerRow(row: ValuationAssumption): boolean {
  return row.category === "peer_multiple";
}

export default function ValuationWorkspace({
  analysis,
  lang,
  onChange,
}: {
  analysis: FilingAnalysis;
  lang: Lang;
  onChange?: (valuation: ValuationBundle) => void;
}) {
  const locale = lang === "pt" ? "pt-BR" : "en-US";
  const [active, setActive] = useState<ValuationMethod>("dcf");
  const [dcfState, setDcfState] = useState<MethodState>(emptyState);
  const [compsState, setCompsState] = useState<MethodState>(emptyState);
  const [dcfResult, setDcfResult] = useState<DcfValuationResult | undefined>(analysis.valuation?.dcf);
  const [compsResult, setCompsResult] = useState<CompsValuationResult | undefined>(analysis.valuation?.comps);
  const [reconciliation, setReconciliation] = useState<ValuationReconciliation | undefined>(analysis.valuation?.reconciliation);
  const state = active === "dcf" ? dcfState : compsState;

  useEffect(() => {
    onChange?.({
      assumptions: {
        ...(dcfState.assumptions.length ? { dcf: dcfState.assumptions } : {}),
        ...(compsState.assumptions.length ? { comps: compsState.assumptions } : {}),
      },
      ...(dcfResult ? { dcf: dcfResult } : {}),
      ...(compsResult ? { comps: compsResult } : {}),
      ...(reconciliation ? { reconciliation } : {}),
    });
  }, [compsResult, compsState.assumptions, dcfResult, dcfState.assumptions, onChange, reconciliation]);

  useEffect(() => {
    if (!dcfResult || !compsResult) return;
    let cancelled = false;
    fetch("/api/valuation/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dcf: dcfResult, comps: compsResult }),
    })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("reconciliation_failed")))
      .then(body => { if (!cancelled) setReconciliation(body.reconciliation); })
      .catch(() => { if (!cancelled) setReconciliation(undefined); });
    return () => { cancelled = true; };
  }, [dcfResult, compsResult]);

  const prepare = async (method: ValuationMethod) => {
    const setter = method === "dcf" ? setDcfState : setCompsState;
    setter(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch("/api/valuation/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis, method }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "proposal_failed");
      const proposal = (body as ProposalResponse).proposal;
      setter({ assumptions: proposal.assumptions, notes: proposal.notes, loading: false, calculating: false, error: null });
      if (method === "dcf") setDcfResult(undefined);
      else setCompsResult(undefined);
      setReconciliation(undefined);
    } catch (error) {
      setter(prev => ({ ...prev, loading: false, error: error instanceof Error ? error.message : "proposal_failed" }));
    }
  };

  const mutate = (method: ValuationMethod, id: string, patch: Partial<ValuationAssumption>) => {
    const setter = method === "dcf" ? setDcfState : setCompsState;
    setter(prev => ({
      ...prev,
      assumptions: prev.assumptions.map(row => row.id === id ? { ...row, ...patch } : row),
      error: null,
    }));
    if (method === "dcf") setDcfResult(undefined);
    else setCompsResult(undefined);
    setReconciliation(undefined);
  };

  const accept = (method: ValuationMethod, row: ValuationAssumption) => {
    const value = row.final_value === undefined ? row.proposed_value : row.final_value;
    if (value === null || value === undefined || value === "") return;
    mutate(method, row.id, {
      status: "accepted",
      final_value: value,
    });
  };

  const acceptPopulated = (method: ValuationMethod) => {
    const setter = method === "dcf" ? setDcfState : setCompsState;
    setter(prev => ({
      ...prev,
      assumptions: prev.assumptions.map(row =>
        row.status !== "proposed" || row.proposed_value === null
          ? row
          : { ...row, status: "accepted" as const, final_value: row.proposed_value },
      ),
      error: null,
    }));
    if (method === "dcf") setDcfResult(undefined);
    else setCompsResult(undefined);
    setReconciliation(undefined);
  };

  const editValue = (method: ValuationMethod, row: ValuationAssumption, value: string) => {
    mutate(method, row.id, { status: "edited", final_value: value });
  };

  const calculate = async (method: ValuationMethod) => {
    const methodState = method === "dcf" ? dcfState : compsState;
    const setter = method === "dcf" ? setDcfState : setCompsState;
    setter(prev => ({ ...prev, calculating: true, error: null }));
    try {
      const response = await fetch("/api/valuation/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis, method, assumptions: methodState.assumptions }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const pending = Array.isArray(body.pending) && body.pending.length ? `: ${body.pending.join(", ")}` : "";
        throw new Error(`${typeof body.error === "string" ? body.error : "calculation_failed"}${pending}`);
      }
      if (method === "dcf") setDcfResult(body.result as DcfValuationResult);
      else setCompsResult(body.result as CompsValuationResult);
      setter(prev => ({ ...prev, calculating: false, error: null }));
    } catch (error) {
      setter(prev => ({ ...prev, calculating: false, error: error instanceof Error ? error.message : "calculation_failed" }));
    }
  };

  const currentResult = active === "dcf" ? dcfResult : compsResult;
  const proposedCount = state.assumptions.filter(row => row.status === "proposed").length;
  const populatedCount = state.assumptions.filter(row => row.proposed_value !== null).length;
  const peerAccepted = active === "comps"
    ? state.assumptions.filter(row => isPeerRow(row) && (row.status === "accepted" || row.status === "edited")).length
    : 0;

  const figureCards = useMemo(() => {
    if (active === "dcf" && dcfResult) return [
      [lang === "pt" ? "Valor da firma" : "Enterprise value", dcfResult.figures.enterprise_value],
      [lang === "pt" ? "Valor do patrimônio" : "Equity value", dcfResult.figures.equity_value],
      [lang === "pt" ? "Valor implícito/ação" : "Implied value/share", dcfResult.figures.implied_per_share],
      ["WACC", dcfResult.figures.wacc],
    ] as const;
    if (active === "comps" && compsResult) return [
      [lang === "pt" ? "Múltiplo selecionado" : "Selected multiple", compsResult.figures.selected_multiple],
      [lang === "pt" ? "Valor da firma" : "Enterprise value", compsResult.figures.enterprise_value],
      [lang === "pt" ? "Valor do patrimônio" : "Equity value", compsResult.figures.equity_value],
      [lang === "pt" ? "Valor implícito/ação" : "Implied value/share", compsResult.figures.implied_per_share],
    ] as const;
    return [] as const;
  }, [active, compsResult, dcfResult, lang]);

  const renderInput = (row: ValuationAssumption) => {
    const value = displayValue(row.final_value === undefined ? row.proposed_value : row.final_value);
    if (row.id === "dcf.terminal_method") {
      return <select value={value || "perpetuity_growth"} onChange={event => editValue(active, row, event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="perpetuity_growth">perpetuity_growth</option></select>;
    }
    if (row.id === "dcf.sbc_treatment" || row.id === "comps.multiple_metric") {
      return <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-2 text-xs font-semibold text-slate-300">{value || "—"}</div>;
    }
    const numeric = typeof row.proposed_value === "number" || row.proposed_value === null || Boolean(row.unit);
    return <input type={numeric ? "number" : "text"} step="any" value={value} placeholder={row.proposed_value === null ? (lang === "pt" ? "Obrigatório" : "Required") : ""} onChange={event => editValue(active, row, event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500" />;
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/55 p-5 sm:p-6 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-cyan-300"><ShieldCheck className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">{lang === "pt" ? "Valuation com validação de premissas" : "Assumption-gated valuation"}</span></div>
          <h2 className="mt-2 text-lg font-bold text-white">DCF + Trading Comps</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            {lang === "pt"
              ? "O FilingLens propõe um ledger auditável de premissas e bloqueia qualquer valuation até que você aceite, edite ou exclua as premissas aplicáveis. Os números de valuation só aparecem após essa validação."
              : "FilingLens proposes an auditable assumptions ledger and blocks valuation output until you accept, edit or exclude the applicable assumptions. Valuation numbers appear only after that validation gate."}
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-700 bg-slate-950/60 p-1">
          {(["dcf", "comps"] as ValuationMethod[]).map(method => <button key={method} onClick={() => setActive(method)} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${active === method ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-200"}`}>{method === "dcf" ? "DCF" : "Trading Comps"}</button>)}
        </div>
      </div>

      {!state.assumptions.length ? (
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/35 p-5">
          <p className="text-xs leading-relaxed text-slate-400">
            {active === "dcf"
              ? (lang === "pt" ? "Prepare as premissas de crescimento, margens, FCFF, componentes do WACC, tratamento de SBC, valor terminal e ponte para equity." : "Prepare growth, margin, FCFF, WACC-component, SBC-treatment, terminal-value and equity-bridge assumptions.")
              : (lang === "pt" ? "Prepare a seleção de múltiplo, métricas da companhia e múltiplos dos peers. A pesquisa externa aceita números apenas quando existe URL citada." : "Prepare the multiple selection, issuer metrics and peer multiples. External research accepts a number only when a cited URL supports it.")}
          </p>
          <button disabled={state.loading} onClick={() => prepare(active)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{state.loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}{state.loading ? (lang === "pt" ? "Preparando…" : "Preparing…") : (lang === "pt" ? "Preparar premissas" : "Prepare assumptions")}</button>
          {state.error && <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/8 p-3 text-[10px] text-rose-200">{state.error}</div>}
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="text-[11px] text-slate-400"><span className="font-semibold text-slate-200">{state.assumptions.length}</span> {lang === "pt" ? "premissas" : "assumptions"} · <span className="text-amber-300">{proposedCount} {lang === "pt" ? "pendentes" : "pending"}</span>{active === "comps" ? ` · ${peerAccepted} ${lang === "pt" ? "peers aceitos" : "accepted peers"}` : ""}</div>
            <div className="flex flex-wrap gap-2"><button onClick={() => acceptPopulated(active)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:border-slate-500"><Check className="mr-1 inline h-3 w-3" />{lang === "pt" ? `Aceitar ${populatedCount} propostas preenchidas` : `Accept ${populatedCount} populated proposals`}</button><button onClick={() => prepare(active)} disabled={state.loading} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:text-white"><RefreshCw className="mr-1 inline h-3 w-3" />{lang === "pt" ? "Recriar ledger" : "Rebuild ledger"}</button></div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
            <div className="hidden grid-cols-[1.2fr_.85fr_.45fr_.55fr_1.6fr_.7fr] gap-3 bg-slate-950/70 px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600 lg:grid"><span>{lang === "pt" ? "Premissa" : "Assumption"}</span><span>{lang === "pt" ? "Valor" : "Value"}</span><span>{lang === "pt" ? "Conf." : "Conf."}</span><span>{lang === "pt" ? "Impacto" : "Impact"}</span><span>{lang === "pt" ? "Racional / fonte" : "Rationale / source"}</span><span>{lang === "pt" ? "Ação" : "Action"}</span></div>
            <div className="divide-y divide-slate-800">
              {state.assumptions.map(row => (
                <div key={row.id} className={`grid gap-3 px-4 py-3 lg:grid-cols-[1.2fr_.85fr_.45fr_.55fr_1.6fr_.7fr] ${row.status === "rejected" ? "opacity-45" : ""}`}>
                  <div><div className="text-xs font-semibold text-slate-200">{row.label}</div><div className="mt-1 font-mono text-[9px] text-slate-600">{row.id}</div></div>
                  <div>{renderInput(row)}{row.unit && <div className="mt-1 text-[9px] text-slate-600">{row.unit}</div>}</div>
                  <div className="text-[10px] capitalize text-slate-400">{row.confidence}</div>
                  <div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase ${row.impact === "high" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : row.impact === "medium" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-slate-700 text-slate-500"}`}>{row.impact}</span></div>
                  <div className="text-[10px] leading-relaxed text-slate-500">{row.rationale}{row.source?.url && <a href={row.source.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">{row.source.publisher ?? "source"}<ExternalLink className="h-2.5 w-2.5" /></a>}</div>
                  <div className="flex flex-wrap gap-1.5"><button disabled={(row.final_value === undefined ? row.proposed_value : row.final_value) === null || (row.final_value === undefined ? row.proposed_value : row.final_value) === ""} onClick={() => accept(active, row)} className={`rounded-md border px-2 py-1.5 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-35 ${row.status === "accepted" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-400 hover:text-white"}`}><Check className="mr-1 inline h-3 w-3" />{lang === "pt" ? "Aceitar" : "Accept"}</button>{active === "comps" && isPeerRow(row) && <button onClick={() => mutate(active, row.id, { status: "rejected" })} className={`rounded-md border px-2 py-1.5 text-[9px] font-semibold ${row.status === "rejected" ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-slate-700 text-slate-500 hover:text-rose-300"}`}><X className="mr-1 inline h-3 w-3" />{lang === "pt" ? "Excluir" : "Exclude"}</button>}</div>
                </div>
              ))}
            </div>
          </div>

          {state.notes.length > 0 && <div className="mt-3 rounded-lg border border-cyan-500/15 bg-cyan-500/5 p-3 text-[10px] leading-relaxed text-cyan-100/70">{state.notes.join(" · ")}</div>}
          {state.error && <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/8 p-3 text-[10px] text-rose-200">{state.error}</div>}
          <button onClick={() => calculate(active)} disabled={state.calculating || proposedCount > 0} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{state.calculating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}{state.calculating ? (lang === "pt" ? "Calculando…" : "Calculating…") : (lang === "pt" ? "Validar ledger e calcular" : "Validate ledger & calculate")}</button>
          {proposedCount > 0 && <div className="mt-2 text-[9px] text-amber-300/80">{lang === "pt" ? "Resolva todas as premissas pendentes antes do cálculo." : "Resolve every pending assumption before calculation."}</div>}
        </>
      )}

      {currentResult && (
        <div className="mt-6 border-t border-slate-800 pt-5">
          <div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300">{lang === "pt" ? "Ledger validado" : "Validated ledger"}</div><h3 className="mt-1 text-sm font-bold text-white">{active === "dcf" ? "DCF" : `Trading Comps · ${compsResult?.multiple_metric}`}</h3></div><span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[9px] font-semibold uppercase text-emerald-300">complete</span></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{figureCards.map(([label, item]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><div className="text-[10px] uppercase tracking-[0.12em] text-slate-600">{label}</div><div className="mt-1 text-lg font-bold text-white">{figure(item.value, item.unit, locale)}</div><div className="mt-2 line-clamp-2 text-[8px] text-slate-700">{item.assumption_ids.join(" · ")}</div></div>)}</div>

          {active === "dcf" && dcfResult && <div className="mt-5 grid gap-4 xl:grid-cols-2"><div className="overflow-x-auto rounded-xl border border-slate-800"><table className="w-full min-w-[620px] text-[10px]"><thead className="bg-slate-950/70 text-slate-600"><tr><th className="px-3 py-2 text-left">Year</th><th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">EBIT %</th><th className="px-3 py-2 text-right">NOPAT</th><th className="px-3 py-2 text-right">D&A</th><th className="px-3 py-2 text-right">Capex</th><th className="px-3 py-2 text-right">ΔNWC</th><th className="px-3 py-2 text-right">FCFF</th></tr></thead><tbody className="divide-y divide-slate-800">{dcfResult.projections.map(row => <tr key={row.year} className="text-slate-400"><td className="px-3 py-2 font-semibold text-slate-200">{row.year}</td><td className="px-3 py-2 text-right">{row.revenue.toLocaleString(locale)}</td><td className="px-3 py-2 text-right">{row.ebit_margin.toFixed(1)}%</td><td className="px-3 py-2 text-right">{row.nopat.toLocaleString(locale)}</td><td className="px-3 py-2 text-right">{row.d_and_a.toLocaleString(locale)}</td><td className="px-3 py-2 text-right">{row.capex.toLocaleString(locale)}</td><td className="px-3 py-2 text-right">{row.change_nwc.toLocaleString(locale)}</td><td className="px-3 py-2 text-right font-semibold text-cyan-300">{row.fcff.toLocaleString(locale)}</td></tr>)}</tbody></table></div><div className="overflow-x-auto rounded-xl border border-slate-800 p-4"><div className="mb-3 text-xs font-semibold text-slate-200">WACC × g sensitivity · implied value/share</div><table className="w-full min-w-[420px] text-[9px]"><thead><tr><th className="p-1 text-left text-slate-600">WACC \ g</th>{dcfResult.sensitivity.terminal_growth.map(g => <th key={g} className="p-1 text-right text-slate-600">{g.toFixed(1)}%</th>)}</tr></thead><tbody>{dcfResult.sensitivity.wacc.map((wacc, rowIndex) => <tr key={wacc}><td className="p-1 font-semibold text-slate-500">{wacc.toFixed(1)}%</td>{dcfResult.sensitivity.values[rowIndex].map((value, colIndex) => <td key={`${wacc}-${colIndex}`} className="rounded p-1 text-right text-slate-300">{value === null ? "—" : value.toLocaleString(locale)}</td>)}</tr>)}</tbody></table><div className="mt-4 grid grid-cols-3 gap-2">{(["bull", "base", "bear"] as const).map(key => <div key={key} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-center"><div className="text-[9px] uppercase text-slate-600">{key}</div><div className="mt-1 text-sm font-bold text-white">{figure(dcfResult.scenarios[key].value, dcfResult.scenarios[key].unit, locale)}</div></div>)}</div></div></div>}

          {active === "comps" && compsResult && <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_.8fr]"><div className="overflow-hidden rounded-xl border border-slate-800"><div className="grid grid-cols-[1fr_.35fr_.8fr] bg-slate-950/70 px-4 py-2 text-[9px] font-semibold uppercase text-slate-600"><span>Peer</span><span className="text-right">{compsResult.multiple_metric}</span><span className="text-right">Source</span></div>{compsResult.peers.map(peer => <div key={peer.assumption_id} className="grid grid-cols-[1fr_.35fr_.8fr] border-t border-slate-800 px-4 py-2.5 text-[10px]"><span className="text-slate-300">{peer.name}</span><span className="text-right font-semibold text-cyan-300">{peer.multiple?.toFixed(2)}x</span><span className="truncate text-right text-slate-600">{peer.source?.publisher ?? "manual / validated"}</span></div>)}</div><div className="rounded-xl border border-slate-800 p-4"><div className="text-xs font-semibold text-slate-200">{lang === "pt" ? "Distribuição dos múltiplos" : "Multiple distribution"}</div><div className="mt-3 grid grid-cols-3 gap-2">{(["q1", "median", "q3"] as const).map(key => <div key={key} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-center"><div className="text-[9px] uppercase text-slate-600">{key}</div><div className="mt-1 text-sm font-bold text-white">{figure(compsResult.quartiles[key].value, "x", locale)}</div></div>)}</div><div className="mt-4 space-y-2">{compsResult.sensitivity.map(item => <div key={`${item.label}-${item.multiple}`} className="flex items-center justify-between rounded-lg bg-slate-950/40 px-3 py-2 text-[10px]"><span className="text-slate-500">{item.label} · {item.multiple.toFixed(2)}x</span><span className="font-semibold text-slate-200">{item.implied_per_share === null ? "—" : item.implied_per_share.toLocaleString(locale)}</span></div>)}</div></div></div>}
        </div>
      )}

      {reconciliation && dcfResult && compsResult && <div className={`mt-5 rounded-xl border p-4 ${reconciliation.status === "divergent" ? "border-amber-500/35 bg-amber-500/8" : "border-emerald-500/25 bg-emerald-500/6"}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{lang === "pt" ? "Triangulação DCF × Comps" : "DCF × Comps triangulation"}</div><div className="mt-1 text-sm font-semibold text-white">{reconciliation.divergence_percent === null ? "—" : `${reconciliation.divergence_percent.toFixed(1)}%`} {lang === "pt" ? "de divergência" : "divergence"}</div></div><span className={`rounded-full border px-3 py-1 text-[9px] font-semibold uppercase ${reconciliation.status === "divergent" ? "border-amber-500/40 text-amber-300" : "border-emerald-500/40 text-emerald-300"}`}>{reconciliation.status}</span></div><p className="mt-2 text-[10px] leading-relaxed text-slate-400">{reconciliation.notes.join(" ")}</p></div>}

      <p className="mt-5 border-t border-slate-800 pt-4 text-[9px] leading-relaxed text-slate-600">{lang === "pt" ? "Valuation para fins informacionais. Premissas de mercado, estimativas e múltiplos exigem validação do usuário e não constituem recomendação de investimento." : "Valuation is for informational purposes. Market assumptions, estimates and trading multiples require user validation and do not constitute investment advice."}</p>
    </section>
  );
}
