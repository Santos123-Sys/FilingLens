import type {MarketResult} from "@contracts/analysis";
import {auditMoatDurability} from "@contracts/moat-diligence";
type Lang="en"|"pt";
const link=(raw:string|undefined)=>{
 try{const u=new URL(raw??"");return u.protocol==="https:"?u.href:null}catch{return null}
};
export default function MoatDiligencePanel({market,lang}:{market:MarketResult["market"];lang:Lang}){
 const audits=auditMoatDurability(market.competitiveAnalysis);
 const pt=lang==="pt";
 return <section className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4 sm:p-5">
  <h3 className="text-sm font-semibold text-white">{pt?"Teste de robustez do moat":"Moat durability challenge"}</h3>
  <p className="mt-1 text-xs leading-5 text-slate-400">{pt?"Evidências a favor e contra cada vantagem, sem presumir que ausência de fonte seja ausência de risco.":"Supporting and disconfirming evidence for each advantage. Missing counter-evidence is not evidence of an absence of risks."}</p>
  {!audits.length?<p className="mt-4 text-xs text-slate-500">{pt?"Nenhuma avaliação citada disponível.":"No cited moat assessments available."}</p>:
   <div className="mt-4 grid gap-3 md:grid-cols-2">{audits.map(p=><article key={p.peer} className="rounded-xl border border-slate-700 bg-slate-950/40 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs text-white">{p.peer}</strong>
     <span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-300">{p.rating} · {p.evidenceBalance.replaceAll("_"," ")}</span></div>
    <div className="mt-3 grid gap-3">
     <div><h4 className="text-[11px] font-semibold text-emerald-300">{pt?"Argumentos favoráveis":"Supporting evidence"} ({p.supporting.length})</h4>
      {p.supporting.length?<ul className="mt-2 space-y-2 text-xs text-slate-300">{p.supporting.map((x,i)=><li key={i}>{x.dimension}: {x.claim} {link(x.source.url)&&<a target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline" href={link(x.source.url)!}>{pt?"Fonte":"Source"}</a>}</li>)}</ul>:
      <p className="mt-2 text-[11px] text-amber-200">{pt?"Sem evidência citada":"No cited support"}</p>}</div>
     <div><h4 className="text-[11px] font-semibold text-amber-300">{pt?"Contra-argumentos":"Counter-evidence"} ({p.challenges.length})</h4>
      {p.challenges.length?<ul className="mt-2 space-y-2 text-xs text-slate-300">{p.challenges.map((x,i)=><li key={i}>{x.dimension}: {x.claim} {link(x.source.url)&&<a target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline" href={link(x.source.url)!}>{pt?"Fonte":"Source"}</a>}</li>)}</ul>:
      <p className="mt-2 text-[11px] text-amber-200">{pt?"Não foi documentada evidência contrária; não significa ausência de ameaças.":"No counter-evidence documented; threats may still exist."}</p>}</div>
    </div>
    {!!p.reviewFlags.length&&<details className="mt-3 text-[11px] text-amber-200">
     <summary className="cursor-pointer">{pt?"Lacunas para revisão":"Review limitations"} ({p.reviewFlags.length})</summary>
     <ul className="mt-2 list-disc space-y-1 pl-4">{p.reviewFlags.map((f,i)=><li key={i}>{f}</li>)}</ul>
    </details>}
   </article>)}</div>}
  <p className="mt-4 text-[11px] text-slate-400">{pt?"Avaliações do modelo não constituem medida validada de vantagem sustentável.":"Model moat ratings are hypotheses, not validated measures of durable competitive advantage."}</p>
 </section>;
}
