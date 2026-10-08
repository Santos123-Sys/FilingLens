import {useMemo,useState} from "react";
import type {FilingAnalysis,DcfValuationResult} from "@contracts/analysis";
import {buildValuationDriverBridge} from "@contracts/valuation-driver-bridge";
import type {DriverName,DriverScenario} from "@contracts/valuation-driver-bridge";
type Lang="en"|"pt";
const names:Record<DriverName,{en:string;pt:string}>={
 revenueGrowth:{en:"Revenue growth",pt:"Crescimento da receita"},
 ebitMargin:{en:"EBIT margin",pt:"Margem EBIT"},
 capexIntensity:{en:"Capex / revenue",pt:"Capex / receita"},
};
const fmt=(value:number,lang:Lang)=>new Intl.NumberFormat(lang==="pt"?"pt-BR":"en-US",{maximumFractionDigits:2}).format(value);
const title=(metric:DriverName,lang:Lang)=>names[metric][lang];
const safeUrl=(url:string|undefined)=>{try{const u=new URL(url??"");return u.protocol==="https:"?u.href:null;}catch{return null;}};
export default function ValuationDriverBridge({analysis,dcf,lang}:{analysis:FilingAnalysis;dcf?:DcfValuationResult;lang:Lang}) {
 const [inputs,setInputs]=useState<DriverScenario[]>([]);
 const [accepted,setAccepted]=useState(false);
 const result=useMemo(()=>buildValuationDriverBridge(analysis,accepted?inputs:[],dcf),[analysis,dcf,inputs,accepted]);
 const pt=lang==="pt";
 const sourceReady=result.historical.length===3&&result.historical.every(x=>x.status==="supported");
 const init=()=>{
  if(!sourceReady)return;
  const values=Object.fromEntries(result.historical.map(x=>[x.name,x.valuePercent])) as Record<DriverName,number>;
  const base={growth:values.revenueGrowth,margin:values.ebitMargin,capex:values.capexIntensity};
  const clip=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,Number(n.toFixed(2))));
  setInputs([
   {name:"bear",probabilityPercent:25,revenueGrowthPercent:clip(base.growth-3,-90,100),
    ebitMarginPercent:clip(base.margin-2,-100,100),capexPercentRevenue:clip(base.capex+1,0,100)},
   {name:"base",probabilityPercent:50,revenueGrowthPercent:clip(base.growth,-90,100),
    ebitMarginPercent:clip(base.margin,-100,100),capexPercentRevenue:clip(base.capex,0,100)},
   {name:"bull",probabilityPercent:25,revenueGrowthPercent:clip(base.growth+3,-90,100),
    ebitMarginPercent:clip(base.margin+2,-100,100),capexPercentRevenue:clip(base.capex-1,0,100)},
  ]);
  setAccepted(false);
 };
 const change=(index:number,key:keyof Omit<DriverScenario,"name">,value:number)=>{
  setInputs(previous=>previous.map((s,i)=>i===index?{...s,[key]:value}:s));setAccepted(false);
 };
 return <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 sm:p-5">
  <h3 className="text-sm font-semibold text-slate-100">{pt?"Ponte de drivers para valuation":"Valuation-driver bridge"}</h3>
  <p className="mt-2 text-xs leading-5 text-slate-400">{pt?
   "Separação explícita entre desempenho observado, orientação da administração, opiniões de pares e premissas do analista. As projeções abaixo NÃO são FCFF nem valor justo.":
   "Explicit separation of historical observations, management guidance, competitor outlook and analyst assumptions. The operating projections below are NOT FCFF or fair value."}</p>
  <div className="mt-4 grid gap-3 md:grid-cols-3">{result.historical.map(x=><div key={x.name} className="rounded-xl border border-slate-700 p-3">
    <p className="text-[11px] text-slate-400">{title(x.name,lang)} · {x.period||"FY ?"}</p>
    <p className="mt-2 text-xl font-semibold tabular-nums text-white">{x.valuePercent===null?"—":fmt(x.valuePercent,lang)+"%"}</p>
    <p className={"mt-1 text-[10px] "+(x.status==="supported"?"text-emerald-300":"text-amber-300")}>{x.status==="supported"?(pt?"Com fonte":"Evidence-backed"):(pt?"Fonte/período indisponível":"Missing source/period")}</p>
    {safeUrl(x.source?.url)&&<a href={safeUrl(x.source?.url)!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] text-cyan-300 underline">{pt?"Fonte":"Source"}</a>}
   </div>)}</div>
  <div className="mt-4 grid gap-3 md:grid-cols-2">
   <details className="rounded-xl border border-slate-700 p-3 text-xs text-slate-300"><summary className="cursor-pointer font-semibold">{pt?"Guidance da administração":"Management guidance"} ({result.guidance.length})</summary>
    <ul className="mt-3 space-y-3">{result.guidance.map((g,i)=><li key={i}>{g.metric} · {g.period}: {g.range} {safeUrl(g.source.url)&&<a href={safeUrl(g.source.url)!} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{pt?"Fonte":"Source"}</a>}</li>)}</ul>
    {!result.guidance.length&&<p className="mt-2 text-amber-200">{pt?"Não há guidance validado no documento.":"No supported management guidance available."}</p>}
   </details>
   <details className="rounded-xl border border-slate-700 p-3 text-xs text-slate-300"><summary className="cursor-pointer font-semibold">{pt?"Perspectiva de concorrentes (não guidance)":"Peer outlook (not guidance)"} ({result.peerOutlooks.length})</summary>
    <ul className="mt-3 space-y-3">{result.peerOutlooks.map((p,i)=><li key={i}>{p.peer} · {p.stance}: {p.summary} {safeUrl(p.source.url)&&<a href={safeUrl(p.source.url)!} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{pt?"Fonte":"Source"}</a>}</li>)}</ul>
   </details>
  </div>
  {!sourceReady?<p className="mt-4 rounded-lg border border-amber-800/40 p-3 text-xs text-amber-200">{pt?
   "Sem três drivers anuais com dados alinhados e fontes específicas. Cenários bloqueados até os dados serem verificados.":
   "Three aligned, cited FY drivers are required before scenario projections are enabled."}</p>:
  <div className="mt-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs font-semibold text-slate-200">{pt?"Cenários do analista (editáveis)":"Analyst scenarios (editable)"}</p>
    <button type="button" onClick={init} className="rounded-lg border border-cyan-700/50 px-3 py-2 text-xs text-cyan-200">{pt?"Inicializar cenários ilustrativos":"Initialize illustrative scenarios"}</button>
   </div>
   {!!inputs.length&&<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[690px] text-left text-xs">
    <thead><tr className="border-b border-slate-700 text-slate-400"><th className="px-2 py-2">{pt?"Cenário":"Scenario"}</th><th className="p-2">{pt?"Probabilidade %":"Probability %"}</th>
     <th className="p-2">{pt?"Crescimento %":"Revenue growth %"}</th><th className="p-2">{pt?"Margem EBIT %":"EBIT margin %"}</th><th className="p-2">Capex / revenue %</th></tr></thead>
    <tbody>{inputs.map((s,i)=><tr key={s.name} className="border-b border-slate-800"><td className="px-2 py-3 text-slate-200">{s.name}</td>
     {(["probabilityPercent","revenueGrowthPercent","ebitMarginPercent","capexPercentRevenue"] as const).map(key=>
      <td key={key} className="p-2"><input type="number" step="0.1" value={s[key]} aria-label={s.name+" "+key}
       onChange={e=>change(i,key,Number(e.target.value))} className="w-28 rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-white"/></td>)}</tr>)}</tbody>
   </table></div>}
   {!!inputs.length&&<div className="mt-3 flex flex-wrap items-center gap-3">
    <button type="button" onClick={()=>setAccepted(true)}
     className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white">
     {pt?"Validar premissas e calcular":"Approve assumptions and calculate"}</button>
    <span className="text-xs text-slate-400">{pt?"Soma de probabilidades":"Probability total"}: {inputs.reduce((a,s)=>a+s.probabilityPercent,0)}%</span>
   </div>}
   {accepted&&result.status!=="ready"&&<p className="mt-3 text-xs text-amber-300">{result.flags.join(" ")}</p>}
   {result.status==="ready"&&<>
    <div className="mt-4 grid gap-3 md:grid-cols-3">{result.scenarios.map(s=><div key={s.scenario} className="rounded-xl border border-slate-700 p-3">
      <h4 className="text-xs font-semibold uppercase text-cyan-200">{s.scenario} · {s.probabilityPercent}%</h4>
      <p className="mt-2 text-[10px] text-slate-400">{pt?"Receita ano 3":"Year-3 revenue"}</p>
      <p className="font-semibold text-white">{fmt(s.thirdYearRevenue,lang)} {analysis.financials.unit}</p>
      <p className="mt-2 text-[10px] text-slate-400">{pt?"EBIT menos capex (não FCFF)":"EBIT less capex (not FCFF)"}</p>
      <p className="font-semibold text-slate-200">{fmt(s.thirdYearEbitLessCapex,lang)} {analysis.financials.unit}</p>
     </div>)}</div>
    <p className="mt-4 text-xs font-semibold text-white">{pt?"Sensibilidade: mudança de 1 ponto percentual na premissa-base":"Sensitivity: one-percentage-point shift in base assumption"}</p>
    <div className="mt-2 space-y-2">{result.sensitivity.map(x=><div key={x.name} className="flex justify-between gap-3 rounded-lg bg-slate-900/70 px-3 py-2 text-xs">
      <span className="text-slate-300">{title(x.name,lang)}</span>
      <span className="tabular-nums font-medium text-cyan-200">{x.deltaOnePoint>=0?"+":""}{fmt(x.deltaOnePoint,lang)} {analysis.financials.unit}</span>
     </div>)}</div>
   </>}
  </div>}
  <p className="mt-4 text-[11px] leading-5 text-slate-400">{result.dcfLink?
   (pt?"O DCF previamente validado fornece a matriz WACC × crescimento terminal e valor por ação; estes cenários operacionais não alteram silenciosamente suas premissas.":
   "An already validated DCF supplies WACC × terminal-growth sensitivity and value/share; these operating scenarios never silently overwrite its assumptions."):
   (pt?"DCF não validado: nenhum valor de empresa ou preço-alvo é inferido.":"No approved DCF is available: no enterprise value or share price is inferred.")}</p>
 </section>;
}
