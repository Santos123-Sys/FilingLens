import { withModelExecution } from "../ai/execution";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { CompsValuationResult, FilingAnalysis, ValuationAssumption } from "../../contracts/analysis";
import { filingModel, marketWebSearchTool, openAIProviderOptions } from "../ai/provider";
import { classifyAiError } from "../lib/ai-client";
import {evaluateTradingPeer,commonQuoteDate} from "../../contracts/trading-comps-eligibility";
import type {TradingPeerResult,TradingPeerSnapshot} from "../../contracts/trading-comps-eligibility";
import { ValuationGateError, ValuationInputError, latest, makeAssumption, netDebt, num, resolved, round, shares, text, validatedRows } from "./common";

const tradingPeer=z.object({
 name:z.string(),currency:z.enum(["USD","BRL","EUR","GBP","CHF"]),
 basis:z.enum(["us_gaap","ifrs","br_gaap"]),consolidated:z.boolean(),
 quotation_date:z.string(),financial_period_end:z.string(),debt_as_of:z.string(),
 market_cap_millions:z.number().nullable(),net_debt_millions:z.number().nullable(),
 ebitda_millions:z.number().nullable(),revenue_millions:z.number().nullable(),
 net_income_millions:z.number().nullable(),
 quotation_source_url:z.string(),financial_source_url:z.string(),
});
const peerOutput=z.object({peers:z.array(tradingPeer).max(12)});
const canon = (value:string) => { try { const u=new URL(value); u.hash=""; return `${u.origin}${u.pathname}`.replace(/\/$/,"").toLowerCase(); } catch { return null; } };

function preferredMetric(a:FilingAnalysis): "EV/EBITDA"|"EV/Revenue"|"P/E" {
  const ebitda = latest(a.financials.ebitda) ?? latest(a.financials.adjustedEbitda);
  if (ebitda !== null && ebitda > 0) return "EV/EBITDA";
  const revenue = latest(a.financials.revenue); if (revenue !== null && revenue > 0) return "EV/Revenue";
  return "P/E";
}
function metricValue(a:FilingAnalysis, metric:string) { return metric === "EV/EBITDA" ? latest(a.financials.ebitda) ?? latest(a.financials.adjustedEbitda) : metric === "EV/Revenue" ? latest(a.financials.revenue) : latest(a.financials.netIncome); }
async function research(a:FilingAnalysis, metric:"EV/EBITDA"|"EV/Revenue"|"P/E", names:string[]):Promise<TradingPeerResult[]> {
 if(!process.env.OPENAI_API_KEY||!names.length)return [];
 const unit=/^(USD|BRL|EUR|GBP|CHF) /i.exec(a.financials.unit)?.[1]?.toUpperCase();
 const basis=a.financials.accountingBasis;
 if(!unit||!basis||basis==="unknown"||a.financials.statementScope!=="consolidated")return [];
 const today=new Date().toISOString().slice(0,10);
 try {
  const result=await withModelExecution("market",signal=>generateText({
   abortSignal:signal,model:filingModel("market"),
   output:Output.object({schema:peerOutput}),
   tools:{web_search:marketWebSearchTool() as never},stopWhen:stepCountIs(3),maxRetries:0,
   maxOutputTokens:3600,providerOptions:openAIProviderOptions("market",3600),
   system:"Use cited web search sources, never memory. Return only issuer-identified, consolidated peer market and annual financial components needed to calculate a multiple. Include actual quotation_date, financial_period_end, and debt_as_of dates and explicit currency and accounting basis. market_cap_millions and net_debt_millions must be components of a traceable enterprise value at the quoted dates. NEVER report a pre-computed trading multiple as if its raw numerator and denominator were verified. When a component or exact date cannot be sourced, return null (numbers) or empty dates. Never invent source URLs or market quotes.",
   prompt:`Issuer: ${a.company.name}. Required metric: ${metric}. Fiscal year end: ${a.company.periodEnd}. Reporting currency: ${unit}. Accounting basis: ${basis}. As of ${today}. Named peers: ${names.join(", ")}. Provide two real cited sources per peer: quotation_source_url and financial_source_url. Explicitly distinguish the equity quote date from the financial/debt reporting date.`,
  }));
  const catalog=new Set(result.sources.filter(x=>x.sourceType==="url").map(x=>canon(x.url)).filter((x):x is string=>Boolean(x)));
  const permitted=new Set(result.sources.filter(x=>x.sourceType==="url").map(x=>x.url));
  const vetted:TradingPeerResult[]=[];
  for(const raw of result.output.peers){
   if(!permitted.has(raw.quotation_source_url)||!permitted.has(raw.financial_source_url)||
      !catalog.has(canon(raw.quotation_source_url)??"")||!catalog.has(canon(raw.financial_source_url)??""))continue;
   const candidate=evaluateTradingPeer(raw,metric,{peer:raw.name,issuerPeriodEnd:a.company.periodEnd,
    currency:unit,basis,today,sourceUrls:permitted});
   if(candidate&&names.some(n=>n.trim().toLowerCase()===raw.name.trim().toLowerCase()))vetted.push(candidate);
  }
  const distinct=vetted.filter((v,i,all)=>all.findIndex(x=>x.name.toLowerCase()===v.name.toLowerCase())===i);
  return commonQuoteDate(distinct)?distinct:[];
 }catch(e){const mapped=classifyAiError(e);console.warn("[valuation:comps] sourced inputs unavailable",mapped.name,mapped.message);return [];}
}
export async function prepareComps(a:FilingAnalysis, manualSnapshots?:TradingPeerSnapshot[]) {
  const metric=preferredMetric(a), target=metricValue(a,metric), debt=netDebt(a), sh=shares(a);
  const manual=manualSnapshots?.length?manualSnapshots.slice(0,12):null;
  const names=[...new Set((manual?manual.map(x=>x.name):a.market.competitors).map(x=>x.trim()).filter(Boolean))].slice(0,12);
  const unit=/^(USD|BRL|EUR|GBP|CHF) /i.exec(a.financials.unit)?.[1]?.toUpperCase();
  const basis=a.financials.accountingBasis;
  const today=new Date().toISOString().slice(0,10);
  const reviewed=manual&&unit&&basis&&basis!=="unknown"&&a.financials.statementScope==="consolidated"?
   manual.flatMap(raw=>{
    const result=evaluateTradingPeer(raw,metric,{peer:raw.name,issuerPeriodEnd:a.company.periodEnd,
      currency:unit,basis,today,sourceUrls:new Set([raw.quotation_source_url,raw.financial_source_url])});
    return result?[result]:[];
   }):[];
  const researched=manual?commonQuoteDate(reviewed)?reviewed:[]:await research(a,metric,names);
  const byName=new Map(researched.map(p=>[p.name.toLowerCase(),p]));
  const peerNames=[...names]; while(peerNames.length<3) peerNames.push(`Manual peer ${peerNames.length+1}`);
  const assumptions:ValuationAssumption[]=[
    makeAssumption("comps","comps.multiple_metric","framework","Primary trading multiple",metric,null,"Selected mechanically from available issuer metrics; validate suitability for the industry.","medium","high"),
    makeAssumption("comps","comps.target_metric","issuer_metric",`Issuer ${metric === "EV/EBITDA" ? "EBITDA" : metric === "EV/Revenue" ? "Revenue" : "Net income"}`,target,a.financials.unit,"Latest filing-derived operating metric used as valuation denominator.",target===null?"low":"high","high"),
    makeAssumption("comps","comps.net_debt","equity_bridge","Net debt",metric==="P/E"?0:debt,a.financials.unit,metric==="P/E"?"Not used for P/E.":"Total debt less cash from the filing.",debt===null&&metric!=="P/E"?"low":"high","high"),
    makeAssumption("comps","comps.shares_outstanding","equity_bridge","Shares outstanding",sh,"shares","Derived from net income / EPS when available; validate carefully.",sh===null?"low":"medium","high"),
  ];
  const values:number[]=[];
  peerNames.forEach((name,i)=>{ const p=byName.get(name.toLowerCase()); const v=p?p.multiple:null; if(v!==null&&v!==undefined) values.push(v); const row=makeAssumption("comps",`comps.peer.${i+1}`,"peer_multiple",`${name} — ${metric}`,v,"x",p?`Recomputed ${metric} from source-catalog market cap, debt and annual financial components. Quote as of ${p.quotationDate}; financial FY end ${p.periodEnd}. Verify manually before accepting.`:"No complete same-date, same-basis source-backed numerator/denominator; enter a manually verified value or exclude this peer.",p?"medium":"low","high"); if(p){
  row.source={section:"Trading quotation + financial facts (two sources)",kind:"citation",
   url:p.sourceUrls[0],publisher:manual?"Analyst-attested quote":"Cited quote source",accessed:p.quotationDate};
  row.tradingSnapshot=p.snapshot;
  row.snapshotOrigin=manual?"analyst_attested":"web_cited";
 } assumptions.push(row); });
  values.sort((a,b)=>a-b); const median=values.length ? values[Math.floor(values.length/2)] : null;
  assumptions.splice(1,0,makeAssumption("comps","comps.selected_multiple","framework","Selected multiple",median,"x",median===null?"No comparable, same-date market multiple cohort; validate sources and a selected multiple manually.":"Proposed from recovered peer multiples; user validation is mandatory.",median===null?"low":"medium","high"));
  return {method:"comps" as const,status:"awaiting_validation" as const,assumptions,notes:["Valuation is gated until assumptions are accepted/edited and at least three peer multiples are validated.","Automated proposals require three distinct peers, one quote date, explicit financial year end, common accounting basis/currency and verified source-catalog links; model-supplied multiples are never trusted."]};
}

function quantile(values:number[],q:number){ const a=[...values].sort((x,y)=>x-y), pos=(a.length-1)*q, lo=Math.floor(pos), hi=Math.ceil(pos); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo); }
export function calculateComps(a:FilingAnalysis, assumptions:ValuationAssumption[]):CompsValuationResult {
  const r=validatedRows("comps",assumptions), metric=text(r,"comps.multiple_metric") as "EV/EBITDA"|"EV/Revenue"|"P/E";
  if(!["EV/EBITDA","EV/Revenue","P/E"].includes(metric)) throw new ValuationInputError("unsupported_comps_metric");
  const selected=num(r,"comps.selected_multiple"), target=num(r,"comps.target_metric"), sh=num(r,"comps.shares_outstanding"); if(sh<=0) throw new ValuationInputError("shares_must_be_positive");
  const debt=metric==="P/E"?0:num(r,"comps.net_debt");
  const peerRows=[...r.values()].filter(x=>x.category==="peer_multiple"&&(x.status==="accepted"||x.status==="edited"));
  const basis=a.financials.accountingBasis;
  const currency=/^(USD|BRL|EUR|GBP|CHF) /i.exec(a.financials.unit)?.[1]?.toUpperCase();
  if(!currency||!basis||basis==="unknown"||a.financials.statementScope!=="consolidated")
   throw new ValuationInputError("comps_issuer_comparability_unavailable");
  const today=new Date().toISOString().slice(0,10);
  const peers=peerRows.map(row=>{
   const snapshot=row.tradingSnapshot;
   if(!snapshot||!row.snapshotOrigin||!row.source?.url)
    throw new ValuationGateError("comps_requires_source_components",[row.id]);
   const computed=evaluateTradingPeer(snapshot,metric,{
     peer:row.label.replace(/\s+—\s+.+$/,""),issuerPeriodEnd:a.company.periodEnd,
     currency,basis,today,
     sourceUrls:new Set([snapshot.quotation_source_url,snapshot.financial_source_url])
   });
   if(!computed||row.source.url!==snapshot.quotation_source_url)
    throw new ValuationGateError("comps_peer_sources_incompatible",[row.id]);
   const v=resolved(row),n=typeof v==="number"?v:Number(v);
   if(!Number.isFinite(n)||Math.abs(n-computed.multiple)>0.00001)
    throw new ValuationInputError("comps_peer_multiple_component_mismatch");
   return {name:computed.name,multiple:computed.multiple,source:row.source,
     assumption_id:row.id,quotationDate:computed.quotationDate};
  });
  if(peers.length<3||new Set(peers.map(x=>x.name.toLowerCase())).size!==peers.length)
   throw new ValuationGateError("comps_requires_three_distinct_source_backed_peers",peerRows.map(x=>x.id));
  if(new Set(peers.map(x=>x.quotationDate)).size!==1)
   throw new ValuationGateError("comps_requires_synchronized_quote_dates",peerRows.map(x=>x.id));
  const vals=peers.map(x=>x.multiple as number), q1=quantile(vals,.25), med=quantile(vals,.5), q3=quantile(vals,.75), ids=peers.map(x=>x.assumption_id);
  const ev=metric==="P/E"?null:target*selected, equity=metric==="P/E"?target*selected:(ev as number)-debt, per=equity/sh, unit=`${a.jurisdiction==="br"?"BRL":"USD"}/share`;
  const perFor=(m:number)=>(metric==="P/E"?target*m:target*m-debt)/sh;
  return {method:"comps",status:"complete",multiple_metric:metric,peers,quartiles:{q1:{value:round(q1),unit:"x",assumption_ids:ids},median:{value:round(med),unit:"x",assumption_ids:ids},q3:{value:round(q3),unit:"x",assumption_ids:ids}},figures:{selected_multiple:{value:round(selected),unit:"x",assumption_ids:["comps.selected_multiple",...ids]},enterprise_value:{value:ev===null?null:round(ev),unit:a.financials.unit,assumption_ids:metric==="P/E"?[]:["comps.selected_multiple","comps.target_metric"]},equity_value:{value:round(equity),unit:a.financials.unit,assumption_ids:["comps.selected_multiple","comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt"])]},implied_per_share:{value:round(per),unit,assumption_ids:["comps.selected_multiple","comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt"])]}},sensitivity:[["Q1",q1],["Median",med],["Q3",q3],["Selected",selected]].filter((x,i,a2)=>a2.findIndex(y=>Math.abs(Number(y[1])-Number(x[1]))<1e-9)===i).map(([label,m])=>({label:String(label),multiple:round(Number(m)),implied_per_share:round(perFor(Number(m))),assumption_ids:[...ids,"comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt"])]})),notes:["Quartiles use only peer multiples explicitly accepted or edited by the user.","Rejected peers are excluded.",metric==="P/E"?"P/E produces equity value directly.":`${metric} produces enterprise value, then validated net debt bridges to equity value.`]};
}
