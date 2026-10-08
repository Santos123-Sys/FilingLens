import { useEffect, useState } from "react";
import type { FilingAnalysis } from "@contracts/analysis";

type Observation={periodKind:"FY"|"Q"|"YTD"|"LTM";metric:string;periodEnd:string;fiscalYear:number;value:number|null;unit:string;currency:string|null;sourceSection:string;sourceUrl?:string;filingId:string;status:"verified"|"single_source"|"conflicted"|"missing";candidates:Array<{value:number|null;filingId:string;sourceSection:string;sourceUrl?:string}>};
type Reconciliation={points:Observation[];flags:Array<{code:string;key:string;detail:string}>};
type HistoryReply={status:"available"|"empty";annualHistory:null|{years:string[];unit:string;status:string;[key:string]:unknown};reconciliation:Reconciliation};
const METRICS=[["revenue","Revenue","Receita"],["netIncome","Net income","Lucro líquido"],["operatingCashFlow","Operating cash flow","Fluxo de caixa operacional"],["ebit","Operating income","Resultado operacional"],["totalDebt","Total debt","Dívida total"],["cash","Cash","Caixa"]] as const;
export default function PrivateHistoryPanel({data,lang,enabled,version}:{data:FilingAnalysis;lang:"en"|"pt";enabled:boolean;version:number}) {
 const [report,setReport]=useState<HistoryReply|null>(null);
 const [status,setStatus]=useState("");
 const [refresh,setRefresh]=useState(0);
 const registryId=(data.jurisdiction==="br"?data.metadata.cnpj:data.metadata.cik)?.replace(/\D/g,"")??"";
 useEffect(()=>{
   if(!enabled||registryId.length<6) {setReport(null);return;}
   const controller=new AbortController();
   setStatus(lang==="pt"?"Carregando histórico privado…":"Loading private history…");
   fetch("/api/history/company?"+new URLSearchParams({jurisdiction:data.jurisdiction,registryId}),{signal:controller.signal,credentials:"same-origin"})
    .then(async r=>{if(!r.ok)throw Error("history_"+r.status);return r.json() as Promise<HistoryReply>})
    .then(result=>{setReport(result);setStatus("");})
    .catch(()=>{if(!controller.signal.aborted)setStatus(lang==="pt"?"Histórico indisponível":"History unavailable");});
   return ()=>controller.abort();
 },[enabled,registryId,data.jurisdiction,lang,version,refresh]);
 const erase=async()=>{
   if(!window.confirm(lang==="pt"?"Excluir permanentemente o histórico salvo desta companhia?":"Permanently erase saved history for this company?"))return;
   const response=await fetch("/api/history/company?"+new URLSearchParams({jurisdiction:data.jurisdiction,registryId}),{method:"DELETE",credentials:"same-origin"});
   if(response.ok){setReport(null);setRefresh(x=>x+1);}else setStatus(lang==="pt"?"Falha ao excluir histórico":"Could not erase history");
 };
 const points=report?.reconciliation.points??[];
 const flags=report?.reconciliation.flags??[];
 const conflicts=points.filter(p=>p.status==="conflicted");
 const saved=points.filter(p=>p.value!==null);
 const selectedYears=[...new Set(points.filter(p=>p.periodKind!=="Q").map(p=>p.fiscalYear))].sort((a,b)=>a-b).slice(-5);
 if(!enabled)return <div className="rounded-xl border border-slate-700 bg-slate-950/30 px-4 py-4 text-xs text-slate-400">{lang==="pt"?"Histórico privado opcional: habilite o salvamento acima. Nada será persistido automaticamente antes do consentimento.":"Optional private history: enable saving above. Nothing is automatically persisted before you opt in."}</div>;
 if(registryId.length<6)return <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200">{lang==="pt"?"Identificador CIK/CNPJ ausente: histórico privado não pode ser associado com segurança.":"CIK/CNPJ missing: private history cannot be safely linked."}</div>;
 return <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900/50 p-5">
   <div className="flex flex-wrap items-start justify-between gap-3">
     <div><h3 className="text-sm font-semibold text-white">{lang==="pt"?"Histórico privado entre documentos":"Private cross-filing history"}</h3>
     <p className="mt-1 text-xs text-slate-400">{lang==="pt"?"Somente dados desta sessão do navegador. Fontes e conflitos preservados; sem reclassificação automática.":"Scoped to this browser workspace. Sources and conflicts retained; no automatic restatement."}</p></div>
     {points.length>0&&<button type="button" onClick={erase} className="rounded border border-rose-500/30 px-3 py-2 text-xs text-rose-200">{lang==="pt"?"Excluir histórico da companhia":"Erase company history"}</button>}
   </div>
   {status&&<p role="status" className="text-xs text-amber-200">{status}</p>}
   {report?.status==="empty"&&<p className="text-xs text-slate-400">{lang==="pt"?"Nenhum dado salvo para esta companhia. Apenas anos com data e evidência válidas são armazenados.":"No saved observations yet. Only exactly dated, source-backed years are stored."}</p>}
   {points.length>0&&<>
     <div className="flex flex-wrap gap-3 text-xs"><span className="text-slate-300">{saved.length} {lang==="pt"?"valores utilizáveis":"usable values"}</span><span className={conflicts.length?"text-amber-300":"text-emerald-300"}>{conflicts.length} {lang==="pt"?"conflitos":"conflicts"}</span><span className="text-slate-400">{new Set(points.flatMap(p=>p.candidates.map(c=>c.filingId))).size} {lang==="pt"?"documentos":"filings"}</span></div>
     <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-xs"><thead><tr className="border-b border-slate-700 text-slate-400"><th className="py-2">{lang==="pt"?"Métrica":"Metric"}</th>{selectedYears.map(y=><th key={y} className="p-2 text-right">{y}</th>)}</tr></thead><tbody>
       {METRICS.map(([key,en,pt])=><tr key={key} className="border-b border-slate-800/60"><th className="py-2 font-medium text-slate-200">{lang==="pt"?pt:en}</th>{selectedYears.map(y=>{
         const point=points.find(p=>p.metric===key&&p.fiscalYear===y);
         const val=point?.value;
         return <td key={y} className="p-2 text-right text-slate-200" title={point?.sourceSection??""}>{point?.status==="conflicted"?"⚠":typeof val==="number"?val.toLocaleString(lang==="pt"?"pt-BR":"en-US",{maximumFractionDigits:2}):"—"}</td>
       })}</tr>)}</tbody></table></div>
     {conflicts.length>0&&<div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
       <h4 className="text-xs font-semibold text-amber-200">{lang==="pt"?"Revisão de divergências / reapresentações":"Restatement and conflict review"}</h4>
       <p className="my-2 text-xs text-slate-400">{lang==="pt"?"Divergências permanecem sem resolução; não entram nos cálculos.":"Conflicting values remain unresolved and are excluded from calculations."}</p>
       {conflicts.slice(0,20).map((point,index)=><div className="mt-3 border-t border-amber-500/20 pt-2" key={index}>
        <p className="text-xs font-medium text-white">{point.metric} · {point.periodEnd} · {point.currency} {point.unit}</p>
        {point.candidates.map((source,i)=><p key={i} className="mt-1 text-xs text-slate-300">{source.filingId}: {source.value??"—"} · {source.sourceSection} {source.sourceUrl&&/^https:\/\//i.test(source.sourceUrl)&&<a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{lang==="pt"?"Fonte":"Source"}</a>}</p>)}
       </div>)}
     </div>}
     {flags.filter(f=>f.code!=="CONFLICT"&&f.code!=="UNRESOLVED").length>0&&<div className="text-xs text-amber-200">{lang==="pt"?"Outros alertas de validação:":"Other validation warnings:"} {flags.filter(f=>f.code!=="CONFLICT"&&f.code!=="UNRESOLVED").length}</div>}
     <details className="text-xs text-slate-400"><summary className="cursor-pointer">{lang==="pt"?"Inspecionar evidências por métrica":"Inspect metric provenance"}</summary><div className="mt-3 max-h-56 space-y-2 overflow-auto">{points.filter(p=>p.value!==null).slice(0,60).map((p,i)=><p key={i}>{p.fiscalYear} · {p.metric} · {p.filingId} · {p.sourceSection} · {p.status}</p>)}</div></details>
   </>}
 </section>;
}
