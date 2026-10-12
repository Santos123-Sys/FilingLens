import {useState,useEffect} from 'react';
import type {FilingAnalysis,ValuationAssumption,ValuationMethod} from '@contracts/analysis';
export function PublishValuation({analysis,method,assumptions}:{analysis:FilingAnalysis;method:ValuationMethod;assumptions:ValuationAssumption[]}) {
 const [ticket,setTicket]=useState(''),[checked,setChecked]=useState(false),[message,setMessage]=useState(''),[url,setUrl]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setTicket(sessionStorage.getItem('gpi-workspace-handoff')??'');},[]);
 if(!ticket)return <p className="mt-4 text-xs text-slate-400">Open FilingLens from GPI to share a reviewed valuation with your portfolio workspace.</p>;
 async function publish(){setBusy(true);setMessage('');setUrl('');try{
  const res=await fetch('/api/integration/v1/valuations',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({ticket,method,assumptions,analysis,scenario:'base',confirmed:checked})});
  const body=await res.json();if(!res.ok)throw Error(body.error);
  setMessage(body.synchronization==='synchronized'?'Reviewed valuation approved and synchronized with GPI.':'Reviewed valuation approved in FilingLens. GPI synchronization is pending; the return link will retry automatically.');setUrl(body.returnUrl);
 }catch(e){setMessage(e instanceof Error?e.message:'Publication unavailable');}finally{setBusy(false);}}
 return <div className="mt-4 rounded-lg border border-cyan-700 p-4 text-xs text-slate-200">
  <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>I confirmed this company matches the GPI issuer, reviewed the sources and assumptions, and authorize sharing this valuation and its audit data with my GPI workspace.</label>
  <button disabled={!checked||busy} onClick={()=>void publish()} className="mt-3 rounded border border-cyan-600 p-2 disabled:opacity-40">{busy?'Publishing…':'Approve and publish to portfolio'}</button>
  {message&&<p role="status" className="mt-2 break-all">{message}</p>}
  {url&&<a href={url} className="mt-2 inline-block text-cyan-300">Return to GPI portfolio workspace</a>}
 </div>;
}

