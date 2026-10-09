import {useMemo} from "react";
import type {FilingAnalysis} from "@contracts/analysis";
import type {FilingDelta} from "@contracts/filing-change-intelligence";
import {buildDecisionDossier,type AnalystReview} from "@contracts/decision-dossier";
export default function InvestmentMemoWorkspace({analysis,delta,lang,value,onChange}:{
 analysis:FilingAnalysis;delta:FilingDelta|null;lang:"en"|"pt";
 value:AnalystReview;onChange:(review:AnalystReview)=>void;
}){
 const pt=lang==="pt";
 const report=useMemo(()=>buildDecisionDossier(analysis,value,delta),[analysis,value,delta]);
 const edit=(key:"thesis"|"counterCase"|"catalysts"|"reviewerNotes",text:string)=>
  onChange({...value,[key]:text});
 const checklist=[
  {key:"financials" as const,en:"Reviewed filing financials",pt:"Revisei os dados financeiros"},
  {key:"sources" as const,en:"Checked source references against originals",pt:"Conferi as fontes originais"},
  {key:"risks" as const,en:"Reviewed contrary evidence and risks",pt:"Revisei as evidências contrárias e os riscos"},
  {key:"valuation" as const,en:"Reviewed valuation assumptions or noted absence",pt:"Revisei as premissas de valuation ou sua ausência"},
 ];
 const fields=[
  {key:"thesis" as const,label:pt?"Tese e catalisadores de valor":"Investment thesis",hint:pt?"Escreva sua hipótese de pesquisa":"Write your research hypothesis",max:3000},
  {key:"counterCase" as const,label:pt?"Cenário contrário / hipóteses que invalidariam a tese":"Counter-case and disconfirming evidence",hint:pt?"Descreva os argumentos contrários":"Record evidence against your thesis",max:3000},
  {key:"catalysts" as const,label:pt?"Catalisadores e observações futuras":"Catalysts and monitoring triggers",hint:pt?"Eventos e métricas a acompanhar":"Which measurable events would change the thesis?",max:2000},
  {key:"reviewerNotes" as const,label:pt?"Notas do analista":"Analyst notes",hint:pt?"Observações (opcional)":"Optional context",max:2000},
 ];
 const exportJson=()=>{
  const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=`filinglens-decision-dossier-${analysis.jurisdiction}-${(analysis.company.ticker??"issuer").replace(/[^a-z0-9_-]/gi,"").slice(0,24)}.json`;
  link.click();URL.revokeObjectURL(url);
 };
 return <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/75 p-5"
   aria-label="Phase 5 decision memo">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div>
    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300">{pt?"Fase 5 · Memorando de investimento":"Phase 5 · Investment decision memo"}</p>
    <h2 className="mt-1 text-lg font-semibold text-white">{pt?"Registro de tese, contrapontos e fontes":"Thesis, counter-case and source register"}</h2>
    <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
     {pt?"Anotações escritas por você. Os campos de confirmação registram sua revisão, não um parecer de auditoria. Nenhuma informação é enviada ao servidor.":
      "Your own research notes. Review checkboxes record a human declaration, not an audit opinion. Nothing entered here is sent to the server."}
    </p>
   </div>
   <button type="button" onClick={exportJson} className="rounded-lg border border-cyan-600/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20">
    {pt?"Exportar memorando JSON":"Export dossier JSON"}
   </button>
  </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-3">
   <div className="rounded-lg border border-slate-700 p-3"><p className="text-[11px] text-slate-400">{pt?"Trechos do documento":"Filing excerpts"}</p><p className="mt-1 text-xl font-semibold text-white">{report.coverage.filingExcerpts}</p></div>
   <div className="rounded-lg border border-slate-700 p-3"><p className="text-[11px] text-slate-400">{pt?"Citações externas":"External citations"}</p><p className="mt-1 text-xl font-semibold text-white">{report.coverage.externalCitations}</p></div>
   <div className="rounded-lg border border-slate-700 p-3"><p className="text-[11px] text-slate-400">{pt?"Estado do registro":"Memo status"}</p><p className="mt-1 text-sm font-semibold text-amber-200">{report.status.replaceAll("_"," ")}</p></div>
  </div>
  <div className="mt-4 grid gap-4 lg:grid-cols-2">
   {fields.map(field=><label key={field.key} className="block text-xs font-semibold text-slate-200">
    {field.label}
    <textarea className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/70 p-3 text-xs font-normal text-white outline-none focus:border-cyan-500"
     rows={4} maxLength={field.max} value={value[field.key]} onChange={e=>edit(field.key,e.target.value)}
     placeholder={field.hint} aria-label={field.label}/>
    <span className="text-[10px] font-normal text-slate-500">{value[field.key].length}/{field.max}</span>
   </label>)}
  </div>
  <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/25 p-4">
   <h3 className="text-sm font-semibold text-slate-200">{pt?"Verificações declaradas pelo analista":"Analyst-declared review checklist"}</h3>
   <div className="mt-3 grid gap-3 sm:grid-cols-2">{checklist.map(item=><label key={item.key}
    className="flex items-start gap-2 text-xs text-slate-300">
    <input type="checkbox" checked={value.checks[item.key]} onChange={e=>onChange({...value,
     checks:{...value.checks,[item.key]:e.target.checked}})} className="mt-0.5 accent-cyan-500"/>
    <span>{pt?item.pt:item.en}</span>
   </label>)}</div>
  </div>
  <div className="mt-4 rounded-lg border border-slate-700 p-3">
   <p className="text-xs font-semibold text-slate-200">{pt?"Inventário de evidências":"Evidence register"} · {report.coverage.total}</p>
   <p className="mt-1 text-[11px] text-slate-500">{pt?"Citações não equivalem à autenticação regulatória. O arquivo exportado inclui as referências disponíveis e as advertências.":"Citations do not establish regulator authentication. The export includes available references and explicit limitations."}</p>
   {report.evidence.length>0&&<div className="mt-2 max-h-48 overflow-y-auto space-y-1">
    {report.evidence.slice(0,30).map(row=><div key={row.id} className="flex gap-2 text-[11px] text-slate-400">
     <span className="w-24 shrink-0 text-slate-500">{row.origin==="filing_excerpt"?(pt?"Documento":"Filing"):(pt?"Fonte externa":"External")}</span>
     <span>{row.category} · {row.section}</span>
    </div>)}
   </div>}
  </div>
  <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{report.notices[0]} {report.notices[3]}</p>
 </section>;
}
