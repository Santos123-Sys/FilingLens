import { useEffect, useState } from "react";
type Lang="en"|"pt";
type Saved={issuerName:string;periodEnd:string;savedAt:string;analysis:{
 jurisdiction:"us"|"br";company:{name:string;filingType:string};financials:{
 years:string[];revenue:number[];netIncome:number[];unit:string;annualHistory?:{
 years:string[];revenue:Array<number|null>;netIncome:Array<number|null>;unit:string;
 }}}
};
function lastValue(values:Array<number|null>|undefined) {
 const last=values?.at(-1);return typeof last==="number"&&Number.isFinite(last)?last:null;
}
const fmt=(x:number|null,lang:Lang)=>x===null?"—":new Intl.NumberFormat(lang==="pt"?"pt-BR":"en-US",{maximumFractionDigits:2}).format(x);
export default function PrivateHistoryPanel({lang,refreshKey}:{lang:Lang;refreshKey:number}) {
 const [items,setItems]=useState<Saved[]>([]);
 const [active,setActive]=useState(false);
 const [error,setError]=useState(false);
 useEffect(()=>{
  const abort=new AbortController();
  fetch("/api/history/mine",{credentials:"same-origin",cache:"no-store",signal:abort.signal})
   .then(async r=>{
    if(r.status===401||r.status===503)return null;
    if(!r.ok)throw Error("history read failed");
    return await r.json() as {items:Saved[]};
   })
   .then(d=>{if(!abort.signal.aborted){setActive(Boolean(d));setItems(d?.items??[]);}})
   .catch(()=>{if(!abort.signal.aborted)setError(true);});
  return ()=>abort.abort();
 },[refreshKey]);
 if(!active || !items.length)return null;
 const clear=async()=>{
  if(!window.confirm(lang==="pt"?"Apagar todo o histórico salvo neste navegador?":"Delete all history saved for this browser?"))return;
  try {
   const auth=await fetch("/api/history/session",{credentials:"same-origin"}).then(r=>r.json()) as {csrf:string};
   const res=await fetch("/api/history/mine",{method:"DELETE",credentials:"same-origin",headers:{"X-History-CSRF":auth.csrf}});
   if(!res.ok)throw Error("delete failed");
   setItems([]);
  }catch{setError(true);}
 };
 return <section className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/65 p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{lang==="pt"?"Meu histórico de análises":"My saved analysis history"}</h3>
   <p className="mt-1 text-xs text-slate-400">{lang==="pt"?"Privado deste navegador; não é uma conta sincronizada. Apagar cookies pode remover o acesso.":"Private to this browser; not a synchronized account. Clearing cookies may remove access."}</p></div>
   <button type="button" onClick={clear} className="rounded-lg border border-rose-800/60 px-3 py-2 text-xs text-rose-300">{lang==="pt"?"Apagar histórico":"Delete saved history"}</button></div>
  <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[510px] text-left text-xs">
   <thead><tr className="border-b border-slate-700 text-slate-400"><th className="py-2">{lang==="pt"?"Companhia":"Company"}</th><th className="p-2">{lang==="pt"?"Período":"Period"}</th><th className="p-2">{lang==="pt"?"Receita":"Revenue"}</th><th className="p-2">{lang==="pt"?"Lucro líquido":"Net income"}</th><th className="p-2">{lang==="pt"?"Unidade":"Unit"}</th></tr></thead>
   <tbody>{items.map((item,i)=>{
    const annual=item.analysis.financials.annualHistory;
    const years=annual?.years??item.analysis.financials.years;
    const revenue=lastValue(annual?.revenue??item.analysis.financials.revenue);
    const earnings=lastValue(annual?.netIncome??item.analysis.financials.netIncome);
    return <tr key={i} className="border-b border-slate-800 text-slate-200"><td className="py-3 pr-2 font-medium">{item.issuerName}</td><td className="p-2">{years.at(-1)??item.periodEnd}</td><td className="p-2 tabular-nums">{fmt(revenue,lang)}</td><td className="p-2 tabular-nums">{fmt(earnings,lang)}</td><td className="p-2 text-slate-400">{annual?.unit??item.analysis.financials.unit}</td></tr>;
   })}</tbody>
  </table></div>
  {error&&<p className="mt-3 text-xs text-rose-300">{lang==="pt"?"Não foi possível atualizar o histórico.":"History could not be updated."}</p>}
 </section>;
}
