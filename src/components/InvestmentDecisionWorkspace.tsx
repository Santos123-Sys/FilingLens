import {useMemo} from "react";
import type {FilingAnalysis,EvidenceReference} from "@contracts/analysis";
import type {FilingDelta} from "@contracts/filing-change-intelligence";
import {buildDecisionMateriality} from "@contracts/decision-materiality";

function sourceLink(source:EvidenceReference|null){
 if(!source || source.kind!=="citation" || !source.url)return null;
 try{
  const url=new URL(source.url);
  if(url.protocol!=="https:")return null;
  return url.href;
 }catch{return null;}
}
export default function InvestmentDecisionWorkspace({analysis,delta,lang}:{
 analysis:FilingAnalysis;delta:FilingDelta|null;lang:"en"|"pt";
}){
 const report=useMemo(()=>buildDecisionMateriality(analysis,delta),[analysis,delta]);
 const pt=lang==="pt";
 return <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/70 p-5"
  aria-label="Decision materiality and research priorities">
  <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300">
   {pt?"Fase 4 · Materialidade para decisões":"Phase 4 · Decision materiality"}</p>
  <h2 className="mt-1 text-lg font-bold text-white">{pt?"Sensibilidade de valuation e fila de pesquisa":"Valuation sensitivity and research queue"}</h2>
  <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
   {pt?"Prioriza dados que podem alterar a análise. Somente o DCF concluído e aprovado gera sensibilidade numérica; diferenças entre documentos continuam sinais não confirmados.":
    "Prioritizes information relevant to the analysis. Only a completed, approved DCF yields numerical sensitivity; filing discrepancies remain unconfirmed review signals."}
  </p>
  <div className="mt-4 rounded-xl border border-slate-700 p-4">
   <div className="flex items-center justify-between gap-2">
    <h3 className="text-sm font-semibold text-slate-100">{pt?"Impacto local no valor por ação":"Local per-share valuation impact"}</h3>
    <span className="text-[11px] text-slate-400">{report.valuationStatus}</span>
   </div>
   {report.sensitivities.length?
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
     {report.sensitivities.map(s=><div key={s.driver} className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
      <p className="text-xs font-medium text-slate-300">{s.driver==="wacc"?"WACC":pt?"Crescimento terminal":"Terminal growth"}</p>
      <p className="mt-1 text-xl font-bold text-white">{s.deltaPerOnePercentagePoint>0?"+":""}{s.deltaPerOnePercentagePoint.toLocaleString(pt?"pt-BR":"en-US",{maximumFractionDigits:4})}
       <span className="ml-1 text-xs font-normal text-slate-400">{s.unit}</span></p>
      <p className="mt-1 text-[11px] text-slate-500">{pt?"Por +1 ponto percentual (aproximação local)":"Per +1 percentage point (local approximation)"}</p>
     </div>)}
    </div>:
    <p className="mt-3 text-xs text-slate-400">{pt?"Sensibilidade indisponível: DCF não aprovado ou matriz inconsistente.":"Sensitivity unavailable: no approved DCF or inconsistent valuation grid."}</p>}
  </div>
  <div className="mt-4">
   <h3 className="text-sm font-semibold text-slate-100">{pt?"Itens para revisão e diligência":"Research and diligence queue"} <span className="text-slate-400">({report.reviewQueue.length})</span></h3>
   {report.reviewQueue.length?<div className="mt-3 space-y-2">
    {report.reviewQueue.map(item=><article key={item.id} className="rounded-lg border border-slate-700 bg-slate-800/25 p-3">
     <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 className="text-xs font-semibold text-slate-200">{item.title}</h4>
      <span className="text-[10px] uppercase tracking-wider text-amber-200">{item.priority.replaceAll("_"," ")}</span>
     </div>
     <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.detail}</p>
     {sourceLink(item.source)&&<a className="mt-2 inline-block text-xs text-cyan-300 underline" target="_blank"
      rel="noopener noreferrer" href={sourceLink(item.source)!}>{pt?"Consultar fonte":"Review source"}</a>}
    </article>)}
   </div>:<p className="mt-3 text-xs text-slate-400">{pt?"Nenhuma pendência identificada nos dados disponíveis. Isso não comprova a ausência de riscos.":"No review items found in the available data. This does not establish an absence of risks."}</p>}
  </div>
  {report.diagnostics.map((x,i)=><p key={i} className="mt-3 text-[11px] leading-relaxed text-slate-500">{x}</p>)}
 </section>;
}
