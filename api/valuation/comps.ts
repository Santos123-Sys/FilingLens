import { annualBasis, moneyBasis } from "./basis";
import { tradingSnapshotSchema } from "../../contracts/analysis";
import { withModelExecution } from "../ai/execution";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { CompsValuationResult, FilingAnalysis, ValuationAssumption } from "../../contracts/analysis";
import { filingModel, marketWebSearchTool, openAIProviderOptions } from "../ai/provider";
import { classifyAiError } from "../lib/ai-client";
import {evaluateTradingPeer,commonQuoteDate} from "../../contracts/trading-comps-eligibility";
import type {TradingPeerResult,TradingPeerSnapshot} from "../../contracts/trading-comps-eligibility";
import { ValuationGateError, ValuationInputError, makeAssumption, netDebt, num, resolved, round, range, shares, text, validatedRows } from "./common";

const tradingPeer = tradingSnapshotSchema;
const peerOutput=z.object({peers:z.array(tradingPeer).max(12)});
const canon = (value:string) => { try { const u=new URL(value); u.hash=""; return `${u.origin}${u.pathname}`.replace(/\/$/,"").toLowerCase(); } catch { return null; } };

function preferredMetric(a:FilingAnalysis): "EV/EBITDA"|"EV/Revenue"|"P/E" {
  const ebitda = annualBasis(a)?.value("ebitda") ?? null;
  if (ebitda !== null && ebitda > 0) return "EV/EBITDA";
  const revenue = annualBasis(a)?.value("revenue") ?? null; if (revenue !== null && revenue > 0) return "EV/Revenue";
  return "P/E";
}
function metricValue(a:FilingAnalysis, metric:string) {
 const basis = annualBasis(a);
 return basis?.value(metric === "EV/EBITDA" ? "ebitda" : metric === "EV/Revenue" ? "revenue" : "netIncome") ?? null;
}
async function research(a:FilingAnalysis, metric:"EV/EBITDA"|"EV/Revenue"|"P/E", names:string[], issuerPeriodEnd:string, fiscalToleranceDays:number):Promise<TradingPeerResult[]> {
 if(!process.env.OPENAI_API_KEY||!names.length)return [];
 const unit=moneyBasis(a.financials.unit)?.currency;
 const basis=a.financials.accountingBasis;
 if(!unit||!basis||basis==="unknown"||a.financials.statementScope!=="consolidated")return [];
 const today=new Date().toISOString().slice(0,10);
 try {
  const result=await withModelExecution("market",signal=>generateText({
   abortSignal:signal,model:filingModel("market"),
   output:Output.object({schema:peerOutput}),
   tools:{web_search:marketWebSearchTool() as never},stopWhen:stepCountIs(3),maxRetries:0,
   maxOutputTokens:3600,providerOptions:openAIProviderOptions("market",3600),
   system:"Use cited web search sources, never memory. Return only issuer-identified, consolidated peer market and annual financial components needed to calculate a multiple. Include actual quotation_date, financial_period_end, and debt_as_of dates and explicit currency and accounting basis. market_cap_millions and net_debt_millions must be components of a traceable enterprise value at the quoted dates. NEVER report a pre-computed trading multiple as if its raw numerator and denominator were verified. When a component or exact date cannot be sourced, return null (numbers) or empty dates. Never invent source URLs or market quotes. Include financial_period_start and financial_period_kind=FY only for a full annual denominator, and explicit minority_interest_millions and preferred_equity_millions for an enterprise-value multiple (null if unavailable). Do not substitute adjusted EBITDA for reported EBITDA.",
   prompt:`Issuer: ${a.company.name}. Required metric: ${metric}. Annual denominator fiscal year end: ${issuerPeriodEnd}. Maximum analyst-selected fiscal end tolerance: ${fiscalToleranceDays} days. Reporting currency: ${unit}. Accounting basis: ${basis}. As of ${today}. Named peers: ${names.join(", ")}. Provide two real cited sources per peer: quotation_source_url and financial_source_url. Explicitly distinguish the equity quote date from the financial/debt reporting date.`,
  }));
  const catalog=new Set(result.sources.filter(x=>x.sourceType==="url").map(x=>canon(x.url)).filter((x):x is string=>Boolean(x)));
  const permitted=new Set(result.sources.filter(x=>x.sourceType==="url").map(x=>x.url));
  const vetted:TradingPeerResult[]=[];
  for(const raw of result.output.peers){
   if(!permitted.has(raw.quotation_source_url)||!permitted.has(raw.financial_source_url)||
      !catalog.has(canon(raw.quotation_source_url)??"")||!catalog.has(canon(raw.financial_source_url)??""))continue;
   const candidate=evaluateTradingPeer(raw,metric,{peer:raw.name,issuerPeriodEnd,
    currency:unit,basis,today,sourceUrls:permitted,fiscalToleranceDays});
   if(candidate&&names.some(n=>n.trim().toLowerCase()===raw.name.trim().toLowerCase()))vetted.push(candidate);
  }
  const distinct=vetted.filter((v,i,all)=>all.findIndex(x=>x.name.toLowerCase()===v.name.toLowerCase())===i);
  return distinct; // Keep individual candidates reviewable; the final cohort gate enforces one quote date.
 }catch(e){const mapped=classifyAiError(e);console.warn("[valuation:comps] sourced inputs unavailable",mapped.name,mapped.message);return [];}
}
export async function prepareComps(a:FilingAnalysis, manualSnapshots?:TradingPeerSnapshot[], options: { metric?: "EV/EBITDA" | "EV/Revenue" | "P/E"; fiscalToleranceDays?: number; issuerPeriodEnd?: string } = {}) {
  const metric=options.metric ?? preferredMetric(a), target=metricValue(a,metric), debt=netDebt(a), sh=shares(a);
  const basisPeriod = annualBasis(a);
  const issuerPeriodEnd = options.issuerPeriodEnd ?? basisPeriod?.periodEnd ?? "";
  const fiscalToleranceDays = range(options.fiscalToleranceDays ?? 0, "fiscal_tolerance_days", 0, 90);
  const moneyUnit = `${moneyBasis(a.financials.unit)?.currency ?? "Currency"} millions`;
  const manual=manualSnapshots?.length?manualSnapshots.slice(0,12):null;
  const names=[...new Set((manual?manual.map(x=>x.name):a.market.competitors).map(x=>x.trim()).filter(Boolean))].slice(0,12);
  const unit=moneyBasis(a.financials.unit)?.currency;
  const basis=a.financials.accountingBasis;
  const today=new Date().toISOString().slice(0,10);
  const reviewed=manual&&unit&&basis&&basis!=="unknown"&&a.financials.statementScope==="consolidated"?
   manual.flatMap(raw=>{
    const result=evaluateTradingPeer(raw,metric,{peer:raw.name,issuerPeriodEnd,
      currency:unit,basis,today,sourceUrls:new Set([raw.quotation_source_url,raw.financial_source_url]),fiscalToleranceDays});
    return result?[result]:[];
   }):[];
  const researched=manual ? reviewed : issuerPeriodEnd ? await research(a,metric,names,issuerPeriodEnd,fiscalToleranceDays) : [];
  const byName=new Map(researched.map(p=>[p.name.toLowerCase(),p]));
  const peerNames=[...names]; while(peerNames.length<3) peerNames.push(`Manual peer ${peerNames.length+1}`);
  const assumptions:ValuationAssumption[]=[
    makeAssumption("comps","comps.target_period_end","baseline","Issuer annual denominator end date",issuerPeriodEnd || null,null,"Exact end date of the issuer annual denominator; no quarterly or YTD denominator is inferred.",issuerPeriodEnd ? "high" : "low","high"),
    makeAssumption("comps","comps.fiscal_tolerance_days","baseline","Allowed peer fiscal-end difference",fiscalToleranceDays,"days","0 means exact dates. Up to 90 days requires analyst review of seasonality; no FX or accounting-basis conversion is implied.","medium","high"),
    makeAssumption("comps","comps.multiple_metric","framework","Primary trading multiple",metric,null,"Selected mechanically from available issuer metrics; validate suitability for the industry.","medium","high"),
    makeAssumption("comps","comps.target_metric","issuer_metric",`Issuer ${metric === "EV/EBITDA" ? "EBITDA" : metric === "EV/Revenue" ? "Revenue" : "Net income"}`,target,moneyUnit,"Annual filing-derived operating metric, normalized to millions. Quarter and YTD figures are never annualized.",target===null?"low":"high","high"),
    makeAssumption("comps","comps.net_debt","equity_bridge","Net debt",metric==="P/E"?0:debt,moneyUnit,metric==="P/E"?"Not used for P/E.":"Total debt less cash from the filing.",debt===null&&metric!=="P/E"?"low":"high","high"),
    makeAssumption("comps","comps.equity_adjustment","equity_bridge","Other equity bridge adjustments",metric==="P/E"?0:null,moneyUnit,metric==="P/E"?"Not used for P/E.":"Nonoperating assets minus minority/preferred claims; explicitly enter 0 if none. Exclude cash already in net debt.","low","high"),
    makeAssumption("comps","comps.shares_outstanding","equity_bridge","Shares outstanding",sh,"million shares","Annual net income / diluted EPS estimates weighted-average diluted shares. Replace with valuation-date diluted shares in millions.",sh===null?"low":"medium","high"),
  ];
  const values:number[]=[];
  peerNames.forEach((name,i)=>{ const p=byName.get(name.toLowerCase()); const v=p?p.multiple:null; if(v!==null&&v!==undefined) values.push(v); const row=makeAssumption("comps",`comps.peer.${i+1}`,"peer_multiple",`${name} — ${metric}`,v,"x",p?`Recomputed ${metric} from quoted market cap, debt, preferred/minority adjustments and annual financial components. Quote as of ${p.quotationDate}; financial FY end ${p.periodEnd}. Verify manually before accepting.`:"Required annual dates, compatible currency/accounting basis, quote/debt/financial components or source links are missing. Correct the peer input form and rebuild, or exclude this peer. Entering a multiple alone cannot resolve it.",p?"medium":"low","high"); if(p){
  row.source={section:"Trading quotation + financial facts (two sources)",kind:"citation",
   url:p.sourceUrls[0],publisher:manual?"Analyst-attested quote":"Cited quote source",accessed:p.quotationDate};
  row.tradingSnapshot=p.snapshot;
  row.snapshotOrigin=manual?"analyst_attested":"web_cited";
 } assumptions.push(row); });
  const median = commonQuoteDate(researched) ? quantile(values, .5) : null;
  assumptions.splice(1,0,makeAssumption("comps","comps.selected_multiple","framework","Selected multiple",median,"x",median===null?"No comparable, same-date market multiple cohort; review peer sources and a selected multiple.":"Proposed from recovered peer multiples; user validation is mandatory.",median===null?"low":"medium","high"));
  return {method:"comps" as const,status:"awaiting_validation" as const,assumptions,notes:["Valuation is gated until assumptions are accepted/edited and at least three peer multiples are validated.","Automated proposals require three distinct peers, one quote date, explicit annual duration, reviewed fiscal-end tolerance, common accounting basis/currency and verified source-catalog links; model-supplied multiples are never trusted."]};
}

function quantile(values:number[],q:number){ const a=[...values].sort((x,y)=>x-y), pos=(a.length-1)*q, lo=Math.floor(pos), hi=Math.ceil(pos); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo); }
export function calculateComps(a:FilingAnalysis, assumptions:ValuationAssumption[]):CompsValuationResult {
  const r=validatedRows("comps",assumptions), metric=text(r,"comps.multiple_metric") as "EV/EBITDA"|"EV/Revenue"|"P/E";
  if(!["EV/EBITDA","EV/Revenue","P/E"].includes(metric)) throw new ValuationInputError("unsupported_comps_metric");
  const selected=num(r,"comps.selected_multiple"), target=num(r,"comps.target_metric"), sh=num(r,"comps.shares_outstanding"); if(sh<=0) throw new ValuationInputError("shares_must_be_positive");
  range(selected,"selected_multiple",0.000001,1000); range(target,"annual_target_metric",0.000001,1e10); range(sh,"million_shares",0.000001,1e10);
  const issuerPeriodEnd=text(r,"comps.target_period_end");
  const fiscalToleranceDays=range(num(r,"comps.fiscal_tolerance_days"),"fiscal_tolerance_days",0,90);
  const debt=metric==="P/E"?0:num(r,"comps.net_debt");
  const adjustment=metric==="P/E"?0:num(r,"comps.equity_adjustment");
  const peerRows=[...r.values()].filter(x=>x.category==="peer_multiple"&&(x.status==="accepted"||x.status==="edited"));
  const basis=a.financials.accountingBasis;
  const currency=moneyBasis(a.financials.unit)?.currency;
  if(!currency||!basis||basis==="unknown"||a.financials.statementScope!=="consolidated")
   throw new ValuationInputError("comps_issuer_comparability_unavailable");
  const today=new Date().toISOString().slice(0,10);
  const peers=peerRows.map(row=>{
   const snapshot=row.tradingSnapshot;
   if(!snapshot||!row.snapshotOrigin||!row.source?.url)
    throw new ValuationGateError("comps_requires_source_components",[row.id]);
   const computed=evaluateTradingPeer(snapshot,metric,{
     peer:row.label.replace(/\s+—\s+.+$/,""),issuerPeriodEnd,
     currency,basis,today,fiscalToleranceDays,
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
  const ev=metric==="P/E"?null:target*selected, equity=metric==="P/E"?target*selected:(ev as number)-debt+adjustment, per=equity/sh, unit=`${currency}/share`;
  const perFor=(m:number)=>(metric==="P/E"?target*m:target*m-debt+adjustment)/sh;
  return {method:"comps",status:"complete",multiple_metric:metric,peers,quartiles:{q1:{value:round(q1),unit:"x",assumption_ids:ids},median:{value:round(med),unit:"x",assumption_ids:ids},q3:{value:round(q3),unit:"x",assumption_ids:ids}},figures:{selected_multiple:{value:round(selected),unit:"x",assumption_ids:["comps.selected_multiple",...ids]},enterprise_value:{value:ev===null?null:round(ev),unit:`${currency} millions`,assumption_ids:metric==="P/E"?[]:["comps.selected_multiple","comps.target_metric"]},equity_value:{value:round(equity),unit:`${currency} millions`,assumption_ids:["comps.selected_multiple","comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt","comps.equity_adjustment"])]},implied_per_share:{value:round(per),unit,assumption_ids:["comps.selected_multiple","comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt","comps.equity_adjustment"])]}},sensitivity:[["Q1",q1],["Median",med],["Q3",q3],["Selected",selected]].filter((x,i,a2)=>a2.findIndex(y=>Math.abs(Number(y[1])-Number(x[1]))<1e-9)===i).map(([label,m])=>({label:String(label),multiple:round(Number(m)),implied_per_share:round(perFor(Number(m))),assumption_ids:[...ids,"comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt","comps.equity_adjustment"])]})),notes:[`Annual denominator end ${issuerPeriodEnd}; peer fiscal-end tolerance ${fiscalToleranceDays} days. All money inputs use millions and diluted shares use millions.`, "Source links and analyst attestation are not independent verification of the raw figures.", "Quartiles use only peer multiples explicitly accepted or edited by the user.","Rejected peers are excluded.",metric==="P/E"?"P/E produces equity value directly.":`${metric} produces enterprise value, then validated net debt bridges to equity value.`]};
}
