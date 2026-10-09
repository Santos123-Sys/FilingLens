import {useState} from "react";
import type {FilingAnalysis} from "@contracts/analysis";
import {compareFilingAnalyses,type FilingDelta} from "@contracts/filing-change-intelligence";

const MAX_JSON_BYTES = 2 * 1024 * 1024;
export default function FilingChangeWorkspace({analysis,lang,onReport}:{
 analysis:FilingAnalysis;lang:"en"|"pt";onReport?:(report:FilingDelta|null)=>void;
}) {
 const [report,setReport]=useState<FilingDelta|null>(null);
 const [error,setError]=useState("");
 const pt=lang==="pt";
 const upload=async(file:File|undefined)=>{
  setReport(null);onReport?.(null);setError("");
  if(!file)return;
  if(file.size>MAX_JSON_BYTES||file.size<2){
   setError(pt?"JSON anterior inválido ou maior que 2 MB.":"Invalid previous JSON or file exceeds 2 MB.");return;
  }
  try{
   const input=JSON.parse(await file.text()) as unknown;
   const result=compareFilingAnalyses(input,analysis);
   setReport(result);onReport?.(result);
  }catch{
   setError(pt?"Não foi possível ler o JSON anterior.":"Could not parse the previous JSON.");
  }
 };
 return <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/70 p-5" aria-label="Filing change intelligence">
  <div className="flex flex-wrap items-start justify-between gap-4">
   <div><span className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300">
    {pt?"Fase 3 · Inteligência entre documentos":"Phase 3 · Filing change intelligence"}</span>
    <h2 className="mt-1 text-lg font-bold text-white">{pt?"Comparar com análise anterior":"Compare with a prior filing analysis"}</h2>
    <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
     {pt?"Importe um JSON anterior exportado pelo FilingLens. Comparação local, sem upload para o servidor. Mudanças são sinais de revisão, não reexpressões confirmadas.":
      "Import a previously exported FilingLens JSON. Comparison runs locally; the file is not uploaded to the server. Changes are review signals, not confirmed restatements."}
    </p></div>
   <label className="cursor-pointer rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200">
    {pt?"Selecionar JSON anterior":"Select prior JSON"}
    <input aria-label="Prior FilingLens analysis JSON" type="file" accept=".json,application/json"
     className="hidden" onChange={e=>{void upload(e.currentTarget.files?.[0]);e.currentTarget.value="";}}/>
   </label>
  </div>
  {error&&<p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
  {report&&<div className="mt-4 space-y-3">
   <p className="text-xs text-slate-300">{report.status==="ready"?
    `${report.previous.period} → ${report.current.period} · ${report.changes.length} ${pt?"divergências financeiras":"financial discrepancies"}`:
    pt?"Comparação não permitida":"Comparison unavailable"} · {report.status}</p>
   {report.exclusions.map((x,i)=><p key={i} className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">{x}</p>)}
   {report.status==="ready"&&<>
    <div className="grid gap-3 sm:grid-cols-2">
     <div className="rounded-lg border border-slate-700 p-3">
      <p className="text-xs font-semibold text-slate-200">{pt?"Novos períodos fiscais":"New fiscal periods"}</p>
      <p className="mt-1 text-xs text-slate-400">{report.addedPeriods.join(", ")||"—"}</p>
     </div>
     <div className="rounded-lg border border-slate-700 p-3">
      <p className="text-xs font-semibold text-slate-200">{pt?"Mudanças nos títulos dos riscos":"Risk-title changes"}</p>
      <p className="mt-1 text-xs text-slate-400">{report.addedRiskTitles.length} {pt?"adicionados":"added"} · {report.removedRiskTitles.length} {pt?"removidos":"removed"}</p>
     </div>
    </div>
    {report.changes.length>0?<div className="overflow-x-auto"><table className="w-full text-left text-xs">
     <thead><tr className="border-b border-slate-700 text-slate-400">
      <th className="p-2">{pt?"Métrica":"Metric"}</th><th className="p-2">{pt?"Período":"Period"}</th>
      <th className="p-2">{pt?"Anterior":"Prior"}</th><th className="p-2">{pt?"Atual":"Current"}</th>
      <th className="p-2">{pt?"Diferença":"Difference"}</th><th className="p-2">{pt?"Evidência":"Evidence"}</th>
     </tr></thead><tbody>{report.changes.slice(0,30).map((x,i)=><tr key={i} className="border-b border-slate-800 text-slate-200">
      <td className="p-2">{x.metric}</td><td className="p-2">{x.period}</td>
      <td className="p-2">{x.previous.toLocaleString()}</td><td className="p-2">{x.current.toLocaleString()}</td>
      <td className="p-2">{x.percentChange===null?"N/M":`${x.percentChange.toFixed(2)}%`}</td>
      <td className="p-2">{x.status==="review_with_two_sources"?
       (pt?"Duas fontes — revisar":"Two sources — review"):(pt?"Fonte ausente":"Missing source")}</td>
     </tr>)}</tbody></table></div>:
     <p className="text-xs text-slate-400">{pt?"Nenhuma divergência numérica comparável identificada.":"No comparable numeric discrepancies detected."}</p>}
    {report.notes.map((n,i)=><p key={i} className="text-[11px] text-slate-500">{n}</p>)}
   </>}
  </div>}
 </section>;
}
