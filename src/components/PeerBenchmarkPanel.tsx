import { useMemo } from "react";
import type { FilingAnalysis } from "@contracts/analysis";
import { buildPeerFinancialBenchmarks } from "@contracts/peer-financial-benchmark";
import type { PeerFact } from "@contracts/peer-financial-benchmark";
import { evidenceUrl } from "@contracts/peer-evidence-audit";
type Lang="en"|"pt";
const num=(value:number,lang:Lang)=>new Intl.NumberFormat(lang==="pt"?"pt-BR":"en-US",{maximumFractionDigits:2}).format(value);
const metricName=(metric:PeerFact["metric"],pt:boolean):string=>({
 revenue:pt?"Receita":"Revenue",netIncome:pt?"Lucro líquido":"Net income",
 operatingIncome:pt?"Lucro operacional":"Operating income",
 grossProfit:pt?"Lucro bruto":"Gross profit",
})[metric];
export default function PeerBenchmarkPanel({data,lang}:{data:FilingAnalysis;lang:Lang}){
 const result=useMemo(()=>buildPeerFinancialBenchmarks(data),[data]);
 const pt=lang==="pt";
 return <section className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div><h3 className="text-sm font-semibold text-white">{pt?"Benchmark financeiro de concorrentes":"Peer financial benchmarking"}</h3>
    <p className="mt-1 text-xs text-slate-400">{pt?
     "Somente cifras confirmadas no SEC CompanyFacts, em milhões, com identificação de formulário, período e base contábil.":
     "Only SEC CompanyFacts-corroborated figures, normalized to millions with explicit filing accession, fiscal period and accounting gates."}</p></div>
   <span className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300">
    {result.facts.length} {pt?"observações elegíveis":"eligible observations"}</span>
  </div>
  {result.facts.length===0?<p className="mt-4 text-xs leading-5 text-slate-400">{pt?
   "Nenhum valor foi confirmado pelo SEC CompanyFacts com emissor, documento, número e período compatíveis; informações apenas citadas não entram no benchmark.":
   "No SEC-corroborated peer observations passed issuer-identity, accession, amount, fiscal period and currency checks. Other cited financial claims are excluded from numerical benchmarking."}</p>:
   <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs">
    <thead><tr className="border-b border-slate-700 text-slate-400">
     <th className="py-2 pr-3">{pt?"Concorrente":"Peer"}</th>
     <th className="p-2">{pt?"Métrica":"Metric"}</th>
     <th className="p-2">{pt?"Período encerrado":"Period ended"}</th>
     <th className="p-2">{pt?"Valor (milhões)":"Value (millions)"}</th>
     <th className="p-2">{pt?"Base":"Basis"}</th>
     <th className="py-2 pl-2">{pt?"Fonte":"Source"}</th>
    </tr></thead>
    <tbody>{result.facts.slice(0,32).map((fact,index)=><tr key={fact.peer+fact.metric+fact.year+index} className="border-b border-slate-800 text-slate-200">
     <td className="py-3 pr-3 font-medium">{fact.peer}</td>
     <td className="p-2">{metricName(fact.metric,pt)}</td>
     <td className="p-2 tabular-nums">{fact.periodEnd}</td>
     <td className="p-2 tabular-nums">{fact.currency} {num(fact.millions,lang)}</td>
     <td className="p-2">{fact.basis.replaceAll("_"," ").toUpperCase()}</td>
     <td className="py-2 pl-2">{evidenceUrl(fact.source)?<a href={evidenceUrl(fact.source)!} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{pt?"Abrir":"View"}</a>:"—"}</td>
    </tr>)}</tbody>
   </table></div>}
  {result.margins.length>0 && <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
   <p className="text-xs font-semibold text-white">{pt?"Margem líquida implícita dos concorrentes":"Implied peer net margin"}</p>
   <div className="mt-3 grid gap-3 md:grid-cols-3">{result.margins.slice(0,12).map((m,index)=>
    <div key={m.peer+m.year+index} className="rounded-lg bg-slate-900/80 p-3">
     <p className="text-[11px] text-slate-300">{m.peer} · FY{m.year}</p>
     <p className="mt-1 text-lg font-semibold text-cyan-200 tabular-nums">{num(m.marginPercent,lang)}%</p>
     <p className="text-[10px] text-slate-500">{m.currency} · {m.periodEnd}</p>
    </div>)}</div>
  </div>}
  {result.comparisons.length>0 && <div className="mt-4 rounded-xl border border-cyan-700/30 bg-cyan-950/10 p-3">
   <p className="text-xs font-semibold text-cyan-200">{pt?"Comparações compatíveis com a companhia analisada":"Comparable issuer–peer observations"}</p>
   <ul className="mt-2 space-y-2 text-xs text-slate-300">{result.comparisons.slice(0,12).map((v,index)=>
    <li key={index}>{v.peer} · {metricName(v.metric,pt)} · FY{v.year}: {v.currency} {num(v.peerMillions,lang)}m {pt?"vs. emissor":"vs. issuer"} {num(v.issuerMillions,lang)}m
     {v.differencePercent!==null?` (${num(v.differencePercent,lang)}%)`:""}</li>)}</ul>
  </div>}
  {result.flags.length>0 && <details className="mt-4 rounded-xl border border-amber-900/40 bg-amber-950/10 p-3 text-xs text-amber-200">
   <summary className="cursor-pointer">{pt?"Dados excluídos ou não comparáveis":"Excluded or non-comparable observations"} ({result.flags.length})</summary>
   <ul className="mt-3 space-y-2">{result.flags.slice(0,20).map((f,i)=><li key={i}>{f.peer} · {f.code.replaceAll("_"," ")} — {f.detail}</li>)}</ul>
  </details>}
  <p className="mt-4 text-[11px] leading-5 text-slate-400">{pt?
   "Os valores são confrontados com SEC CompanyFacts do mesmo emissor e documento; isso não substitui auditoria independente. Exigem-se exercício, moeda, escopo e base contábil idênticos. Não há câmbio, estimativa de valor justo nem ranking automático.":
   "Figures are corroborated against SEC CompanyFacts for the exact issuer and filing accession; SEC matching is not a substitute for independent audit. Comparisons require identical fiscal year-end, currency, consolidated scope and accounting basis. No FX conversion, fair-value estimate or automatic ranking is performed."}</p>
 </section>;
}
