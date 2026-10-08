import type { MarketResult } from "@contracts/analysis";
import { auditPeerEvidence } from "@contracts/peer-evidence-audit";

type Lang="en"|"pt";
export default function CompetitorEvidencePanel({market,lang}:{market:MarketResult["market"];lang:Lang}){
 const audits=auditPeerEvidence(market.competitiveAnalysis);
 const pt=lang==="pt";
 return <section className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-3"><div>
   <h3 className="text-sm font-semibold text-white">{pt?"Auditoria da evidência competitiva":"Competitive evidence audit"}</h3>
   <p className="mt-1 text-xs text-slate-400">{pt?"Cobertura de dados quantitativos, fontes do moat e perspectivas por concorrente":"Coverage of numerical data, moat evidence and peer outlook"}</p>
  </div><span className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300">{audits.length} {pt?"empresas":"peers"}</span></div>
  {audits.length===0?<p className="mt-4 text-xs leading-5 text-slate-500">{pt?"Nenhum perfil de concorrente com fontes externas suficientes.":"No independently sourced peer profiles currently available."}</p>:
  <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[570px] text-left text-xs">
   <thead><tr className="border-b border-slate-700 text-slate-400">
    <th className="py-2 pr-2">{pt?"Concorrente":"Competitor"}</th>
    <th className="px-2 py-2">{pt?"Dados quantitativos":"Numeric data"}</th>
    <th className="px-2 py-2">{pt?"Evidência do moat":"Moat citations"}</th>
    <th className="px-2 py-2">{pt?"Perspectiva citada":"Cited outlook"}</th>
    <th className="py-2 pl-2">{pt?"Domínios distintos":"Distinct source hosts"}</th>
   </tr></thead>
   <tbody>{audits.map(peer=><tr key={peer.name} className="border-b border-slate-800 text-slate-200">
    <td className="py-3 pr-2 font-medium">{peer.name}</td>
    <td className="px-2 py-3 tabular-nums">{peer.numericDataPoints}</td>
    <td className="px-2 py-3 tabular-nums">{peer.moatEvidencePoints}</td>
    <td className="px-2 py-3">{peer.hasOutlookEvidence?(pt?"Sim":"Yes"):(pt?"Não":"No")}</td>
    <td className="py-3 pl-2 tabular-nums">{peer.uniqueSourceHosts}</td>
   </tr>)}</tbody>
  </table></div>}
  {audits.some(a=>a.gaps.length) && <details className="mt-3 text-xs text-slate-400">
   <summary className="cursor-pointer text-amber-200">{pt?"Lacunas de evidência":"Evidence gaps"} ({audits.reduce((a,p)=>a+p.gaps.length,0)})</summary>
   <ul className="mt-3 space-y-2">{audits.flatMap(p=>p.gaps.map((gap,index)=><li key={p.name+"-"+index}><strong className="text-slate-300">{p.name}</strong> — {gap}</li>))}</ul>
  </details>}
  <p className="mt-4 text-[11px] leading-5 text-slate-400">{pt?
   "Contagens representam referências verificáveis, não qualidade do moat, independência econômica ou comparabilidade de indicadores. Períodos, unidades e definições devem ser comparados antes de usar múltiplos ou margens de pares.":
   "Citation counts are not a moat score, proof of independent research, or financial comparability. Align peer periods, units, and definitions before comparing margins or valuation multiples."}
  </p>
 </section>;
}
