import { useMemo } from "react";
import type { FilingAnalysis } from "@contracts/analysis";
import { buildPeerFinancialBenchmarks } from "@contracts/peer-financial-benchmark";
import type { PeerFact } from "@contracts/peer-financial-benchmark";
import { evidenceUrl } from "@contracts/peer-evidence-audit";
import { secHistoricalPeerCohorts } from "@contracts/sec-peer-history";
type Lang="en"|"pt";
const num=(value:number,lang:Lang)=>new Intl.NumberFormat(lang==="pt"?"pt-BR":"en-US",{maximumFractionDigits:2}).format(value);
const metricName=(metric:PeerFact["metric"],pt:boolean):string=>({
 revenue:pt?"Receita":"Revenue",netIncome:pt?"Lucro líquido":"Net income",
 operatingIncome:pt?"Lucro operacional":"Operating income",
 grossProfit:pt?"Lucro bruto":"Gross profit",
})[metric];
export default function PeerBenchmarkPanel({data,lang}:{data:FilingAnalysis;lang:Lang}){
 const result=useMemo(()=>buildPeerFinancialBenchmarks(data),[data]);
 const official=useMemo(()=>secHistoricalPeerCohorts(data.market.competitiveAnalysis?.peerProfiles??[]),[data]);
 const pt=lang==="pt";
 const imported=(data.market.competitiveAnalysis?.peerProfiles??[]).flatMap(p=>p.dataPoints??[])
  .filter(p=>["operator_attested_sec_bulk","operator_attested_sec_json"].includes(p.primaryVerification?.sourceMode??"")).length;
 return <section className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div><h3 className="text-sm font-semibold text-white">{pt?"Benchmark financeiro de concorrentes":"Peer financial benchmarking"}</h3>
    <p className="mt-1 text-xs text-slate-400">{pt?
     "Cifras corroboradas por SEC CompanyFacts ou CVM DFP com identidade, período e moeda verificáveis.":
     "Only regulator-backed SEC CompanyFacts or CVM DFP figures, with explicit issuer, period, currency and accounting gates."}</p></div>
   <span className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300">
    {result.facts.length} {pt?"observações elegíveis":"eligible observations"}</span>
  </div>
  {imported>0&&<p className="mt-3 rounded-md border border-amber-700/40 bg-amber-900/10 p-2 text-[11px] text-amber-200">{pt?
   "Fonte alternativa: "+imported+" cifra(s) confirmadas contra dados oficiais SEC CompanyFacts baixados e importados por operador autorizado. A aplicação verifica CIK, accession, período e número, mas não confirmou independentemente a origem e autenticidade do arquivo.":"Alternate source: "+imported+" fact(s) matched to an operator-imported SEC CompanyFacts ZIP extract or single-company JSON file. The app checks CIK, accession, period and amount; the original file download provenance was attested by the operator, not independently fetched by FilingLens."}</p>}
  {result.facts.length===0?<p className="mt-4 text-xs leading-5 text-slate-400">{pt?
   "Nenhuma cifra passou os controles SEC/CVM de identidade, moeda, período e fonte. Alegações apenas citadas não entram nos cálculos.":
   "No primary SEC/CVM peer observations passed issuer identity, filing, period, currency and scale checks. Merely cited financial claims remain excluded."}</p>:
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
  {official.dataPoints>0 && <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
   <h4 className="text-xs font-semibold text-white">{pt?"Histórico oficial de concorrentes — SEC/CVM":"Official peer history — SEC/CVM"} ({official.dataPoints})</h4>
   <p className="mt-2 text-[11px] text-slate-400">{pt?
    "Dados provenientes de SEC CompanyFacts ou CVM DFP para emissores com identidade comprovada. Conflitos de tags ou revisões são omitidos; períodos, moeda e escopo devem coincidir para benchmarks.":
    "Regulator-derived annual data from SEC CompanyFacts or CVM DFP for identified peers. Conflicting tags or restatements are omitted; peer comparison requires matching fiscal year-end, currency and scope."}</p>
   <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[530px] text-left text-xs">
    <thead><tr className="border-b border-slate-700 text-slate-400"><th className="p-2">{pt?"Concorrente":"Peer"}</th><th className="p-2">{pt?"Indicador":"Metric"}</th><th className="p-2">{pt?"Ano":"Year"}</th><th className="p-2">{pt?"Crescimento YoY":"YoY growth"}</th><th className="p-2">{pt?"Fonte oficial":"Official source"}</th></tr></thead>
    <tbody>{official.growth.slice(0,22).map((g,i)=><tr key={g.peer+g.metric+g.toYear+i} className="border-b border-slate-800">
     <td className="p-2 text-slate-200">{g.peer}</td><td className="p-2 text-slate-300">{metricName(g.metric,pt)}</td>
     <td className="p-2 text-slate-300">{g.fromYear} → {g.toYear}</td>
     <td className="p-2 tabular-nums text-cyan-200">{num(g.growthPercent,lang)}%</td>
     <td className="p-2">{evidenceUrl(g.source)?<a href={evidenceUrl(g.source)!} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{g.source.publisher??"Regulator"}</a>:"—"}</td>
    </tr>)}</tbody>
   </table></div>
   {official.matched.length>0?<p className="mt-3 text-[11px] text-emerald-300">{official.matched.length} {pt?"coortes com período final e GAAP idênticos":"cohorts with identical period end and GAAP basis"}</p>:
    <p className="mt-3 text-[11px] text-amber-300">{pt?"Sem coorte de múltiplos concorrentes com mesmo fechamento fiscal; não forçar comparações.":"No multi-peer cohort with identical fiscal year-end; cross-company comparisons are withheld."}</p>}
  </div>}
  {result.flags.length>0 && <details className="mt-4 rounded-xl border border-amber-900/40 bg-amber-950/10 p-3 text-xs text-amber-200">
   <summary className="cursor-pointer">{pt?"Dados excluídos ou não comparáveis":"Excluded or non-comparable observations"} ({result.flags.length})</summary>
   <ul className="mt-3 space-y-2">{result.flags.slice(0,20).map((f,i)=><li key={i}>{f.peer} · {f.code.replaceAll("_"," ")} — {f.detail}</li>)}</ul>
  </details>}
  <p className="mt-4 text-[11px] leading-5 text-slate-400">{pt?
   "Os valores usam fontes oficiais SEC/CVM e não substituem auditoria independente. Exigem-se exercício, moeda, escopo e base contábil idênticos. Não há câmbio, estimativa de valor justo nem ranking automático.":
   "Figures use primary SEC/CVM reporting evidence and are not a substitute for independent audit. Comparisons require identical fiscal year-end, currency, consolidated scope and accounting basis. No FX conversion, fair-value estimate or automatic ranking is performed."}</p>
 </section>;
}
