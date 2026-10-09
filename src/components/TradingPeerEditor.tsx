import type { TradingPeerSnapshot } from "@contracts/trading-comps-eligibility";
import type { FilingAnalysis } from "@contracts/analysis";
import { emptyTradingPeer } from "@/lib/trading-peer-input";



export default function TradingPeerEditor({ analysis, peers, onChange, lang, metric }: {
  analysis: FilingAnalysis; peers: TradingPeerSnapshot[]; onChange: (peers: TradingPeerSnapshot[]) => void;
  lang: "en" | "pt"; metric: "EV/EBITDA" | "EV/Revenue" | "P/E";
}) {
  const pt = lang === "pt";
  const update = (index: number, patch: Partial<TradingPeerSnapshot>) => onChange(peers.map((p, i) => i === index ? { ...p, ...patch } : p));
  const textFields = [
    ["name", "Company name", "Companhia", "text"],
    ["quotation_date", "Quote date", "Data da cotação", "date"],
    ["financial_period_start", "Annual period start", "Início do exercício", "date"],
    ["financial_period_end", "Annual period end", "Fim do exercício", "date"],
    ...(metric === "P/E" ? [] : [["debt_as_of", "Debt reporting date", "Data da dívida", "date"]]),
    ["quotation_source_url", "Quote source URL", "Fonte da cotação (URL)", "url"],
    ["financial_source_url", "Annual statement URL", "Demonstração anual (URL)", "url"],
  ];
  const numericFields = [
    ["market_cap_millions", "Market capitalization", "Valor de mercado"],
    ...(metric === "P/E" ? [] : [["net_debt_millions", "Net debt (negative = net cash)", "Dívida líquida (negativa = caixa líquido)"],
      ["minority_interest_millions", "Minority interest (confirm 0 if none)", "Participação de terceiros (confirme 0 se inexistente)"],
      ["preferred_equity_millions", "Preferred equity (confirm 0 if none)", "Ações preferenciais (confirme 0 se inexistentes)"]]),
    metric === "EV/EBITDA" ? ["ebitda_millions", "Reported annual EBITDA", "EBITDA anual reportado"]
      : metric === "EV/Revenue" ? ["revenue_millions", "Annual revenue", "Receita anual"] : ["net_income_millions", "Annual net income", "Lucro líquido anual"],
  ];
  const inputClass = "mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-cyan-400";
  return <div className="space-y-4">
    <p className="text-xs leading-5 text-slate-400">{pt ? "Todos os valores monetários abaixo são em milhões. Use relatórios anuais e uma única data de cotação para todos os pares. Moeda e práticas contábeis precisam ser compatíveis com o emissor." : "All money values below use millions. Supply annual statements and one quote date for every peer. Currency and accounting basis must match the issuer."}</p>
    {peers.map((peer, index) => <fieldset key={index} className="rounded-xl border border-slate-700 p-4">
      <legend className="px-2 text-sm font-semibold text-cyan-200">{pt ? "Concorrente" : "Peer"} {index + 1}{peer.name ? ` · ${peer.name}` : ""}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {textFields.map(([key, en, translated, type]) => <label key={key} className="text-[11px] text-slate-300">{pt ? translated : en}<input aria-label={`${en} ${index + 1}`} type={type} value={String(peer[key as keyof TradingPeerSnapshot] ?? "")} onChange={e => update(index, { [key]: e.target.value })} className={inputClass} /></label>)}
        <label className="text-[11px] text-slate-300">{pt ? "Moeda" : "Currency"}<select value={peer.currency} onChange={e => update(index, { currency: e.target.value as TradingPeerSnapshot["currency"] })} className={inputClass}>{["USD", "BRL", "EUR", "GBP", "CHF"].map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="text-[11px] text-slate-300">{pt ? "Práticas contábeis" : "Accounting basis"}<select value={peer.basis} onChange={e => update(index, { basis: e.target.value as TradingPeerSnapshot["basis"] })} className={inputClass}>{["us_gaap", "ifrs", "br_gaap"].map(b => <option key={b}>{b}</option>)}</select></label>
        {numericFields.map(([key, en, translated]) => <label key={key} className="text-[11px] text-slate-300">{pt ? translated : en}<input aria-label={`${en} ${index + 1}`} type="number" step="any" value={peer[key as keyof TradingPeerSnapshot] === null || peer[key as keyof TradingPeerSnapshot] === undefined ? "" : String(peer[key as keyof TradingPeerSnapshot])} onChange={e => update(index, { [key]: e.target.value.trim() ? Number(e.target.value) : null })} className={inputClass} /></label>)}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={peer.consolidated} onChange={e => update(index, { consolidated: e.target.checked })} />{pt ? "Demonstrações consolidadas, sem substituir EBITDA por EBITDA ajustado." : "Consolidated statements; reported EBITDA has not been replaced by adjusted EBITDA."}</label>
      {peers.length > 3 && <button type="button" onClick={() => onChange(peers.filter((_, i) => i !== index))} className="mt-3 text-xs text-rose-300">{pt ? "Remover concorrente" : "Remove peer"}</button>}
    </fieldset>)}
    <button type="button" disabled={peers.length >= 12} onClick={() => onChange([...peers, { ...emptyTradingPeer(), currency: analysis.jurisdiction === "br" ? "BRL" : "USD" }])} className="rounded-lg border border-cyan-700 px-3 py-2 text-xs text-cyan-200 disabled:opacity-40">{pt ? "Adicionar concorrente" : "Add peer"}</button>
  </div>;
}
