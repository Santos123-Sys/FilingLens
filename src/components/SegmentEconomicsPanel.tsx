import { useMemo, useState } from "react";
import type { MarketResult } from "@contracts/analysis";
import { buildSegmentIntelligence, parseSegmentPeriod } from "@contracts/segment-intelligence";

type Lang = "en" | "pt";
type Props = { market: MarketResult["market"]; lang: Lang };
const number = (value:number|null,lang:Lang) =>
 value===null ? "—" : new Intl.NumberFormat(lang==="pt"?"pt-BR":"en-US",{maximumFractionDigits:2}).format(value);
const pct=(value:number|null,lang:Lang) => value===null?"—":`${number(value,lang)}%`;
const safeHttps=(url:string|undefined):string|null=>{
 try{const value=new URL(url??"");return value.protocol==="https:"?value.href:null;}catch{return null;}
};
const keyOf=(period:string)=>parseSegmentPeriod(period)?.key??period;
const timeKey=(period:string)=>{
 const parsed=parseSegmentPeriod(period);
 return parsed ? parsed.year*10+(parsed.quarter??5) : 0;
};
export default function SegmentEconomicsPanel({market,lang}:Props){
 const result=useMemo(()=>buildSegmentIntelligence(market),[market]);
 const years=useMemo(()=>[...new Map(
   result.segments.flatMap(s=>s.observations.map(x=>[keyOf(x.period),x.period] as const))
 ).values()].sort((a,b)=>timeKey(b)-timeKey(a)),[result]);
 const [selection,setSelection]=useState<string|null>(null);
 const period=years.find(y=>keyOf(y)===selection)??years[0]??null;
 const selectedKey=period?keyOf(period):null;
 const selectedRows=result.segments.map(s=>({
  segment:s,row:s.observations.find(o=>keyOf(o.period)===selectedKey)??null,
 }));
 const mixReady=period!==null && result.mixPeriod!==null && keyOf(period)===keyOf(result.mixPeriod);
 const labels=lang==="pt"?{
  title:"Economia por segmento operacional",sub:"Resultados extraídos do documento, com períodos e fontes verificáveis",
  period:"Período comparável",revenue:"Receita divulgada",earnings:"Resultado operacional divulgado",
  margin:"Margem operacional implícita",yoy:"Crescimento anual (YoY)",
  mix:"Composição da receita por segmentos divulgados",missing:"Não disponível",
  noData:"Ainda não foram identificados segmentos financeiros com períodos e fonte documental validáveis.",
  unit:"Unidade não verificada",source:"Evidência do filing",flags:"Restrições de comparabilidade",
  caveat:"O denominador é a soma dos segmentos apresentados, não a receita consolidada nem a participação de mercado. A margem pressupõe que receita e resultado usem a mesma escala.",
  notComparable:"A composição só é mostrada se todos os segmentos tiverem o mesmo período e unidade/moeda expressamente divulgadas.",
 }:{
  title:"Operating segment economics",sub:"Filing-derived performance, with auditable fiscal periods and sources",
  period:"Comparable fiscal period",revenue:"Disclosed revenue",earnings:"Disclosed operating earnings",
  margin:"Implied operating margin",yoy:"Year-over-year growth",
  mix:"Composition of disclosed segment revenue",missing:"Unavailable",
  noData:"No filing-sourced segment series with auditable periods is available for this analysis.",
  unit:"Unverified reporting unit",source:"Filing evidence",flags:"Comparability limitations",
  caveat:"The denominator is the sum of displayed segments, not consolidated revenue or market share. Operating margin assumes revenue and earnings use the same reporting scale.",
  notComparable:"The composition chart requires one common period and explicitly disclosed matching unit and currency across all segments.",
 };
 return <section className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><h3 className="text-sm font-semibold text-slate-100">{labels.title}</h3><p className="mt-1 text-xs text-slate-400">{labels.sub}</p></div>
   <span className="rounded-lg border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300">{result.segments.length} {lang==="pt"?"segmentos":"segments"}</span>
  </div>
  {result.segments.length===0?
   <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-xs leading-5 text-slate-400">{labels.noData}</p>:
   <>
    <div className="mt-4 flex flex-wrap items-center gap-2">
     <label htmlFor="phase2-segment-period" className="text-xs font-medium text-slate-300">{labels.period}</label>
     <select id="phase2-segment-period" value={selectedKey??""} onChange={event=>setSelection(event.target.value)}
      className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-xs text-white">
      {years.map(year=><option key={keyOf(year)} value={keyOf(year)}>{year}</option>)}
     </select>
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
     {selectedRows.map(({segment,row})=>{
      const unit=segment.unit&&segment.currency?`${segment.currency} · ${segment.unit}`:labels.unit;
      const link=safeHttps(segment.source.url);
      return <article key={segment.name} className="rounded-xl border border-slate-700/80 bg-slate-950/45 p-4">
       <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-semibold text-white">{segment.name}</p>
        <span className="rounded-md bg-slate-800/80 px-2 py-1 text-[10px] text-slate-300">{unit}</span></div>
       {!row?<p className="mt-4 text-xs text-slate-500">{labels.missing}</p>:
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">
         {([[labels.revenue,number(row.revenue,lang)],[labels.earnings,number(row.earnings,lang)],
            [labels.margin,pct(row.marginPercent,lang)],[labels.yoy,pct(row.yoyRevenuePercent,lang)]] as const)
          .map(([label,value])=><div key={label}><p className="text-[10px] leading-4 text-slate-500">{label}</p>
           <p className="mt-1 text-sm font-semibold tabular-nums text-slate-100">{value}</p></div>)}
        </div>}
       {mixReady && row?.shareOfReportedSegmentsPercent!==null && row?.shareOfReportedSegmentsPercent!==undefined && <>
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-800" aria-label={`${segment.name}: ${pct(row.shareOfReportedSegmentsPercent,lang)}`}>
         <div className="h-full rounded-full bg-cyan-500" style={{width:`${Math.max(0,Math.min(100,row.shareOfReportedSegmentsPercent))}%`}} /></div>
        <p className="mt-1 text-[10px] text-cyan-200">{pct(row.shareOfReportedSegmentsPercent,lang)} {labels.mix.toLowerCase()}</p>
       </>}
       <details className="mt-4 border-t border-slate-800 pt-2 text-[10px] text-slate-400"><summary className="cursor-pointer text-cyan-300">{labels.source}: {segment.source.section}</summary>
        <p className="mt-2 whitespace-pre-wrap leading-5 text-slate-400">{segment.source.quote}</p>
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline">{lang==="pt"?"Documento fonte":"Source document"}</a>}
       </details>
      </article>;
     })}
    </div>
    <p className="mt-3 text-[11px] leading-5 text-slate-400">{mixReady?labels.caveat:labels.notComparable}</p>
   </>}
  {result.flags.length>0 && <details className="mt-4 rounded-xl border border-amber-900/40 bg-amber-950/10 p-3 text-[11px] text-amber-200">
   <summary className="cursor-pointer font-medium">{labels.flags}: {result.flags.length}</summary>
   <ul className="mt-3 space-y-2">{result.flags.slice(0,24).map((flag,i)=><li key={i}><span className="font-medium">{flag.segment}</span> · {flag.code.replaceAll("_"," ")} — {flag.detail}</li>)}</ul>
  </details>}
 </section>;
}
