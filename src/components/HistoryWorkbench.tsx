import { useEffect, useMemo, useState } from "react";
import type { FilingAnalysis, EvidenceReference } from "@contracts/analysis";
import type { RegulatoryDataSnapshot } from "@contracts/regulatory-data";

type Props = { data: FilingAnalysis & { regulatoryData?: RegulatoryDataSnapshot }; lang: "en" | "pt" };
const ROWS = [
 ["revenue","Revenue","Receita"],
 ["grossProfit","Gross profit","Lucro bruto"],
 ["ebit","Operating profit (EBIT)","Resultado operacional (EBIT)"],
 ["netIncome","Net income","Lucro líquido"],
 ["operatingCashFlow","Operating cash flow","Fluxo de caixa operacional"],
 ["capex","Capital expenditure","Investimentos de capital"],
 ["totalAssets","Total assets","Ativos totais"],
 ["totalLiabilities","Total liabilities","Passivos totais"],
 ["totalEquity","Total equity","Patrimônio líquido"],
 ["totalDebt","Total debt","Dívida total"],
 ["cash","Cash","Caixa"],
] as const;
type Metric = typeof ROWS[number][0];
const yearKey = (value: string): string | null => /^(?:FY)?(20\d{2})$/i.exec(value.trim())?.[1] ?? null;
function periodSeries(years: string[], values: number[] | null | undefined, year: string): number | null {
 if (!values || values.length !== years.length) return null;
 const matches=years.map((name,index)=>yearKey(name)===year?index:-1).filter(index=>index>=0);
 if(matches.length!==1) return null; // Never resolve ambiguous duplicate periods.
 const result=values[matches[0]];
 return typeof result==="number" && Number.isFinite(result) ? result : null;
}
export type HistoryComparison = { year:string;metric:Metric;historical:number|null;filing:number|null;discrepancy:boolean;missing:boolean };
export function compareAnnualHistory(data: FilingAnalysis): HistoryComparison[] {
 const f=data.financials, annual=f.annualHistory;
 if (!annual?.years?.length) return [];
 const filingUnit=f.unit.toLowerCase().replace(/\s+/g," ").trim();
 const annualUnit=annual.unit.toLowerCase().replace(/\s+/g," ").trim();
 const sameUnit=filingUnit===annualUnit ||
   ((filingUnit.includes("millio") || filingUnit.includes("milh")) &&
    (annualUnit.includes("millio") || annualUnit.includes("milh")) &&
    ((data.jurisdiction==="us" && (filingUnit.includes("usd") || filingUnit.includes("us$"))) ||
     (data.jurisdiction==="br" && (filingUnit.includes("brl") || filingUnit.includes("r$")))));
 return annual.years.flatMap((label,index)=>{
  const year=yearKey(label);
  if(!year)return [];
  return ROWS.map(([metric]):HistoryComparison=>{
    const v=annual[metric][index] ?? null;
    const historical=typeof v==="number"&&Number.isFinite(v)?v:null;
    const filing=sameUnit ? periodSeries(f.years, f[metric] as number[]|null|undefined,year) : null;
    const discrepancy=historical!==null && filing!==null &&
      Math.abs(historical-filing)>0.000001*Math.max(1,Math.abs(historical),Math.abs(filing));
    return {year,metric,historical,filing,discrepancy,missing:historical===null};
  });
 });
}
type PublicArchivedMetric={key:string;year:number;value:number;unit:string|null;status:string;source:{url:string}};
type PublicArchive={snapshotDay:string;snapshotHash:string;provider:string;metrics:PublicArchivedMetric[]};
export function compareArchivedSnapshots(snapshots:PublicArchive[]) {
 if(snapshots.length<2)return [];
 const [newest,previous]=snapshots;
 const previousMap=new Map(previous.metrics.map(m=>[`${m.key}|${m.year}|${m.unit??""}`,m]));
 return newest.metrics.flatMap(m=>{
  const old=previousMap.get(`${m.key}|${m.year}|${m.unit??""}`);
  if(!old || !Number.isFinite(m.value)||!Number.isFinite(old.value))return [];
  return Math.abs(m.value-old.value)>0.000001*Math.max(1,Math.abs(m.value),Math.abs(old.value))
    ?[{metric:m.key,year:m.year,previous:old.value,current:m.value,unit:m.unit}]:[];
 });
}
const fval=(value:number|null,lang:Props["lang"])=>value===null?"—":new Intl.NumberFormat(lang==="pt"?"pt-BR":"en-US",{maximumFractionDigits:2}).format(value);
function safeLink(ref:EvidenceReference):string|null {
 try{const u=new URL(ref.url??"");return u.protocol==="https:"?u.toString():null;}catch{return null;}
}
export default function HistoryWorkbench({data,lang}:Props) {
 const [metric,setMetric]=useState<Metric>("revenue");
 const [showIssues,setShowIssues]=useState(false);

 const [archives,setArchives] = useState<PublicArchive[]>([]);
 const [archiveStatus,setArchiveStatus] = useState<"idle"|"unavailable"|"ready">("idle");
 const registry=data.jurisdiction==="us"
  ?data.metadata.cik?.replace(/\D/g,"").padStart(10,"0")
  :data.metadata.cnpj?.replace(/\D/g,"");
 useEffect(()=>{
  if(!registry || !/^\d{10,14}$/.test(registry))return;
  const controller=new AbortController();
  fetch(`/api/regulatory-history/${data.jurisdiction}/${registry}`,{signal:controller.signal})
   .then(r=>{if(!r.ok)throw Error("History unavailable");return r.json();})
   .then(body=>{if(controller.signal.aborted)return;setArchives(Array.isArray(body.snapshots)?body.snapshots:[]);setArchiveStatus("ready");})
   .catch(()=>{if(!controller.signal.aborted)setArchiveStatus("unavailable");});
  return ()=>controller.abort();
 },[registry,data.jurisdiction]);
 const archiveChanges=useMemo(()=>compareArchivedSnapshots(archives),[archives]);
 const annual=data.financials.annualHistory;
 const comparisons=useMemo(()=>compareAnnualHistory(data),[data]);
 const dataIssues=useMemo(()=>{
  const flagged=data.regulatoryData?.metrics.filter(m=>m.status==="conflict" || m.status==="missing")??[];
  const financial=data.financials.validationFlags?.filter(f=>/CONFLICT|RESTAT|MISMATCH|OCR|ANOMALY/i.test(f.code))??[];
  return [...flagged.map(m=>({name:m.key,detail:`${m.period??"—"} · ${m.status}`,source:m.source?.url??null})),
    ...financial.map(f=>({name:f.code,detail:`${f.period??"—"} · ${f.note}`,source:null}))];
 },[data]);
 if(!annual?.years.length) {
  return <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5"><h3 className="text-sm font-semibold text-white">{lang==="pt"?"Comparação financeira auditável":"Auditable financial comparison"}</h3><p className="mt-2 text-xs text-slate-400">{lang==="pt"?"O histórico anual verificado não está disponível. Não foram gerados valores fictícios.":"Verified annual history is unavailable. No historical values have been fabricated."}</p></section>;
 }
 const selected=comparisons.filter(c=>c.metric===metric);
 const conflicts=comparisons.filter(c=>c.discrepancy);
 const missing=comparisons.filter(c=>c.missing);
 const label=ROWS.find(row=>row[0]===metric);
 return <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 sm:p-5" aria-label={lang==="pt"?"Revisão do histórico anual":"Annual history review"}>
  <div className="flex flex-wrap items-start justify-between gap-3"><div>
   <h3 className="text-sm font-semibold text-white">{lang==="pt"?"Histórico anual e revisão de divergências":"Annual history & discrepancy review"}</h3>
   <p className="mt-1 text-xs text-slate-400">{annual.provider} · {annual.unit} · {annual.years.length} {lang==="pt"?"períodos":"periods"}</p>
  </div><div className="flex flex-wrap gap-2 text-[10px]">
   <span className="rounded-lg border border-slate-600 px-2 py-1 text-slate-300">{missing.length} {lang==="pt"?"não divulgados":"unavailable"}</span>
   <span className="rounded-lg border border-amber-600/50 px-2 py-1 text-amber-200">{conflicts.length+dataIssues.length} {lang==="pt"?"alertas":"flags"}</span>
  </div></div>
  {archiveStatus==="ready" && <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-300">
   {archives.length
    ?(lang==="pt"?"Instantâneos regulatórios arquivados":"Archived regulatory snapshots")+": "+archives.length+
      " · "+(lang==="pt"?"Último arquivo":"Last archived")+": "+archives[0].snapshotDay
    :(lang==="pt"?"Nenhum arquivo regulatório persistido para esta companhia ainda.":"No persisted regulatory snapshots for this company yet.")}
   {archiveChanges.length>0 && <ul className="mt-2 list-disc pl-4 text-amber-200">
     {archiveChanges.slice(0,12).map(c=><li key={c.metric+"-"+c.year}>{c.metric} · FY{c.year}: {fval(c.previous,lang)} → {fval(c.current,lang)} ({c.unit??"?"}) — {lang==="pt"?"revisão necessária":"review required"}</li>)}
   </ul>}
  </div>}
  {archiveStatus==="unavailable" && <p className="mt-2 text-[11px] text-slate-500">{lang==="pt"?"O arquivo persistido não está disponível; o histórico da análise atual permanece visível.":"Persisted history is unavailable; this analysis's financial history remains available."}</p>}
  <div className="mt-4 flex flex-wrap items-center gap-3">
   <label htmlFor="filinglens-history-metric" className="text-xs text-slate-300">{lang==="pt"?"Indicador":"Metric"}</label>
   <select id="filinglens-history-metric" value={metric} onChange={e=>setMetric(e.target.value as Metric)}
    className="max-w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-xs text-white">
    {ROWS.map(([key,en,pt])=><option key={key} value={key}>{lang==="pt"?pt:en}</option>)}
   </select>
  </div>
  <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead><tr className="border-b border-slate-700 text-slate-400"><th className="py-2 pr-2">{lang==="pt"?"Ano fiscal":"Fiscal year"}</th><th className="px-2 py-2">{label?.[lang==="pt"?2:1]}</th><th className="px-2 py-2">{lang==="pt"?"Documento atual":"Current filing"}</th><th className="py-2 pl-2">{lang==="pt"?"Situação":"Status"}</th></tr></thead><tbody>
   {selected.map(row=><tr key={row.year} className="border-b border-slate-800 text-slate-200">
    <td className="py-3 pr-2">{row.year}</td><td className="px-2 py-3 tabular-nums">{fval(row.historical,lang)}</td>
    <td className="px-2 py-3 tabular-nums">{fval(row.filing,lang)}</td>
    <td className={"py-3 pl-2 "+(row.discrepancy?"text-amber-200":"text-slate-400")}>
     {row.discrepancy?(lang==="pt"?"Revisar":"Review") : row.missing?(lang==="pt"?"Ausente":"Missing"):row.filing===null?(lang==="pt"?"Sem comparação":"Not comparable"):(lang==="pt"?"Alinhado":"Aligned")}
    </td>
   </tr>)}
  </tbody></table></div>
  <p className="mt-3 text-[11px] leading-5 text-slate-400">{lang==="pt"?"Comparações exigem unidade e moeda compatíveis, períodos anuais inequívocos e valores divulgados. Divergências podem refletir reapresentações, diferentes definições ou falha de extração; não constituem prova de erro.":"Comparisons require compatible units and currency, unambiguous annual periods and reported values. Differences may reflect restatements, different definitions or extraction errors; they are not proof of misstatement."}</p>
  {(conflicts.length>0 || dataIssues.length>0) && <div className="mt-4">
   <button type="button" onClick={()=>setShowIssues(v=>!v)} className="rounded-lg border border-amber-600/40 px-3 py-2 text-xs text-amber-200" aria-expanded={showIssues}>{showIssues?(lang==="pt"?"Ocultar alertas":"Hide review flags"):(lang==="pt"?"Ver alertas e conflitos":"Review flags & conflicts")}</button>
   {showIssues && <ul className="mt-2 space-y-2">{conflicts.slice(0,30).map(c=><li key={c.year+"-"+c.metric} className="rounded-lg bg-amber-900/10 p-3 text-xs text-amber-200">{c.metric} · FY{c.year}: {fval(c.historical,lang)} / {fval(c.filing,lang)} — {lang==="pt"?"revisão manual necessária":"manual review required"}</li>)}{dataIssues.slice(0,30).map((item,i)=><li key={i} className="rounded-lg bg-amber-900/10 p-3 text-xs text-amber-200">{item.name} · {item.detail} {item.source?.startsWith("https://")&&<a href={item.source} target="_blank" rel="noopener noreferrer" className="underline">{lang==="pt"?"Fonte":"Source"}</a>}</li>)}</ul>}
  </div>}
  {!!annual.sources.length && <details className="mt-4 text-xs text-slate-400"><summary className="cursor-pointer text-slate-300">{lang==="pt"?"Fontes do histórico":"Historical sources"} ({annual.sources.length})</summary><ul className="mt-2 space-y-1">{annual.sources.map((source,i)=><li key={i}>{safeLink(source)?<a href={safeLink(source)!} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{source.publisher??source.section} · {source.item??source.sourceForm??""}</a>:source.section}</li>)}</ul></details>}
 </section>;
}
