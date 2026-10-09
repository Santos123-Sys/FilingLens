import {useMemo,useState} from "react";
import type {FilingAnalysis} from "@contracts/analysis";
import type {FilingDelta} from "@contracts/filing-change-intelligence";
import {buildDecisionDossier,type AnalystReview} from "@contracts/decision-dossier";
import {assessAnalysisQuality,buildAuditPayload,type AuditBundle} from "@contracts/analysis-assurance";

export default function AnalysisAssuranceWorkspace({analysis,delta,review,lang}:{
 analysis:FilingAnalysis;delta:FilingDelta|null;review:AnalystReview;lang:"en"|"pt";
}){
 const pt=lang==="pt";
 const [error,setError]=useState("");
 const dossier=useMemo(()=>buildDecisionDossier(analysis,review,delta),[analysis,review,delta]);
 const assurance=useMemo(()=>assessAnalysisQuality(analysis,dossier,delta),[analysis,dossier,delta]);
 const download=async()=>{
  setError("");
  try{
   if(!crypto?.subtle)throw new Error("crypto_unavailable");
   const payload=buildAuditPayload(analysis,review,delta,new Date().toISOString());
   const plain=JSON.stringify(payload);
   const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(plain));
   const sha256=Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,"0")).join("");
   const archive:AuditBundle={...payload,sha256};
   const blob=new Blob([JSON.stringify(archive,null,2)],{type:"application/json"});
   const uri=URL.createObjectURL(blob);
   const anchor=document.createElement("a");
   anchor.href=uri;
   anchor.download=`filinglens-audit-${analysis.jurisdiction}-${(analysis.company.ticker??"issuer").replace(/[^a-z0-9_-]/gi,"").slice(0,24)}.json`;
   anchor.click();URL.revokeObjectURL(uri);
  }catch{
   setError(pt?"Não foi possível gerar o pacote de auditoria localmente.":"The local audit bundle could not be generated.");
  }
 };
 const statusLabel=assurance.reviewReadiness==="reviewable"?
   (pt?"Revisável (não verificado oficialmente)":"Reviewable (not officially verified)"):
   assurance.reviewReadiness==="blocked"?(pt?"Bloqueios nos dados":"Data quality blockers"):
   (pt?"Revisão adicional necessária":"Additional review required");
 return <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/75 p-5"
  aria-label="Phase 6 analysis quality and audit package">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="max-w-3xl">
    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300">{pt?"Fase 6 · Qualidade e rastreabilidade":"Phase 6 · Quality and traceability"}</p>
    <h2 className="mt-1 text-lg font-semibold text-white">{pt?"Verificações finais e pacote de auditoria":"Final review gates and audit package"}</h2>
    <p className="mt-2 text-xs leading-relaxed text-slate-400">
     {pt?"Verificações de consistência interna, fontes e revisão humana. O pacote inclui a análise e o memorando e pode conter dados sensíveis; somente é criado ao clicar em exportar.":
      "Internal consistency, evidence coverage and analyst-review checks. The export contains the analysis and memo, potentially including sensitive research data; it is created only when requested."}
    </p>
   </div>
   <button type="button" onClick={()=>void download()} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20">
    {pt?"Exportar pacote de auditoria":"Export audit bundle"}
   </button>
  </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-3">
   <div className="rounded-lg border border-slate-700 p-3"><p className="text-[11px] text-slate-400">{pt?"Revisão da análise":"Analysis review"}</p><p className="mt-1 text-sm font-semibold text-slate-100">{statusLabel}</p></div>
   <div className="rounded-lg border border-slate-700 p-3"><p className="text-[11px] text-slate-400">{pt?"Itens que impedem aprovação interna":"Internal blockers"}</p><p className="mt-1 text-xl font-semibold text-slate-100">{assurance.issues.blocked}</p></div>
   <div className="rounded-lg border border-slate-700 p-3"><p className="text-[11px] text-slate-400">{pt?"Pendências de revisão":"Review notices"}</p><p className="mt-1 text-xl font-semibold text-slate-100">{assurance.issues.attention}</p></div>
  </div>
  <div className="mt-4 overflow-x-auto">
   <table className="w-full text-left text-xs"><thead><tr className="border-b border-slate-700 text-slate-400">
    <th className="p-2">{pt?"Controle":"Control"}</th><th className="p-2">{pt?"Estado":"Status"}</th><th className="p-2">{pt?"Interpretação":"Interpretation"}</th>
   </tr></thead><tbody>{assurance.checks.map(c=><tr key={c.id} className="border-b border-slate-800 align-top text-slate-300">
    <td className="p-2 font-semibold">{c.id.replaceAll("_"," ")}</td>
    <td className="p-2">{c.status}</td><td className="p-2 text-slate-400">{c.detail}</td>
   </tr>)}</tbody></table>
  </div>
  <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
   {pt?"Aceitação numérica oficial SEC/CVM: NÃO DEMONSTRADA. O checklist não certifica números XBRL, cotação de mercado nem reexpressões oficiais.":
    "Official SEC/CVM numerical acceptance: NOT DEMONSTRATED. This checklist does not authenticate XBRL numbers, market quotations or official restatements."}
  </p>
  <p className="mt-2 text-[11px] text-slate-500">
   {pt?"SHA-256 permite detectar mudanças acidentais; não é assinatura digital nem certificação regulatória.":
    "SHA-256 can detect accidental changes; it is not a digital signature or regulatory authentication."}
  </p>
  {error&&<p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
 </section>;
}
