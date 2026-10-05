import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { CompsValuationResult, FilingAnalysis, ValuationAssumption } from "../../contracts/analysis";
import { filingModel, marketWebSearchTool, openAIProviderOptions } from "../ai/provider";
import { classifyAiError } from "../lib/ai-client";
import { ValuationGateError, ValuationInputError, latest, makeAssumption, netDebt, num, resolved, round, shares, text, validatedRows } from "./common";

const peerOutput = z.object({ peers: z.array(z.object({ name:z.string(), ev_ebitda:z.number().positive().nullable(), ev_revenue:z.number().positive().nullable(), pe:z.number().positive().nullable(), source_url:z.string().url(), source_label:z.string() })).max(12) });
type Peer = z.infer<typeof peerOutput>["peers"][number];
const canon = (value:string) => { try { const u=new URL(value); u.hash=""; return `${u.origin}${u.pathname}`.replace(/\/$/,"").toLowerCase(); } catch { return null; } };

function preferredMetric(a:FilingAnalysis): "EV/EBITDA"|"EV/Revenue"|"P/E" {
  const ebitda = latest(a.financials.ebitda) ?? latest(a.financials.adjustedEbitda);
  if (ebitda !== null && ebitda > 0) return "EV/EBITDA";
  const revenue = latest(a.financials.revenue); if (revenue !== null && revenue > 0) return "EV/Revenue";
  return "P/E";
}
function metricValue(a:FilingAnalysis, metric:string) { return metric === "EV/EBITDA" ? latest(a.financials.ebitda) ?? latest(a.financials.adjustedEbitda) : metric === "EV/Revenue" ? latest(a.financials.revenue) : latest(a.financials.netIncome); }
function multiple(p:Peer, metric:string) { return metric === "EV/EBITDA" ? p.ev_ebitda : metric === "EV/Revenue" ? p.ev_revenue : p.pe; }

async function research(a:FilingAnalysis, metric:string, names:string[]): Promise<Peer[]> {
  if (!process.env.OPENAI_API_KEY || names.length === 0) return [];
  try {
    const result = await generateText({
      model: filingModel("market"), output: Output.object({schema:peerOutput}),
      tools:{ web_search: marketWebSearchTool() as never }, stopWhen:stepCountIs(3), maxRetries:0, maxOutputTokens:2500,
      providerOptions: openAIProviderOptions("market",2500),
      system:"You are a cautious valuation researcher. Use web search now. For the supplied named public peers, return only current trading multiples explicitly supported by cited URLs. Never estimate a missing multiple. Prefer exchange, company filings, investor relations or reputable market-data pages. Return null for unsupported fields.",
      prompt:`Issuer: ${a.company.name}. Jurisdiction: ${a.jurisdiction}. Industry: ${a.market.industry}. Required primary multiple: ${metric}. Named peers: ${names.join(", ")}. Find exact current multiples and exact citation URLs.`,
    });
    const cited = new Set(result.sources.filter(s=>s.sourceType==="url").map(s=>canon(s.url)).filter(Boolean));
    return result.output.peers.filter(p=>cited.has(canon(p.source_url)));
  } catch (e) { const mapped=classifyAiError(e); console.warn("[valuation:comps] research unavailable",mapped.name,mapped.message); return []; }
}

export async function prepareComps(a:FilingAnalysis) {
  const metric=preferredMetric(a), target=metricValue(a,metric), debt=netDebt(a), sh=shares(a);
  const names=[...new Set(a.market.competitors.map(x=>x.trim()).filter(Boolean))].slice(0,12);
  const researched=await research(a,metric,names); const byName=new Map(researched.map(p=>[p.name.toLowerCase(),p]));
  const peerNames=[...names]; while(peerNames.length<3) peerNames.push(`Manual peer ${peerNames.length+1}`);
  const assumptions:ValuationAssumption[]=[
    makeAssumption("comps","comps.multiple_metric","framework","Primary trading multiple",metric,null,"Selected mechanically from available issuer metrics; validate suitability for the industry.","medium","high"),
    makeAssumption("comps","comps.target_metric","issuer_metric",`Issuer ${metric === "EV/EBITDA" ? "EBITDA" : metric === "EV/Revenue" ? "Revenue" : "Net income"}`,target,a.financials.unit,"Latest filing-derived operating metric used as valuation denominator.",target===null?"low":"high","high"),
    makeAssumption("comps","comps.net_debt","equity_bridge","Net debt",metric==="P/E"?0:debt,a.financials.unit,metric==="P/E"?"Not used for P/E.":"Total debt less cash from the filing.",debt===null&&metric!=="P/E"?"low":"high","high"),
    makeAssumption("comps","comps.shares_outstanding","equity_bridge","Shares outstanding",sh,"shares","Derived from net income / EPS when available; validate carefully.",sh===null?"low":"medium","high"),
  ];
  const values:number[]=[];
  peerNames.forEach((name,i)=>{ const p=byName.get(name.toLowerCase()); const v=p?multiple(p,metric):null; if(v!==null&&v!==undefined) values.push(v); const row=makeAssumption("comps",`comps.peer.${i+1}`,"peer_multiple",`${name} — ${metric}`,v,"x",p?`Citation-backed ${metric} recovered by bounded web research.`:"No citable multiple recovered; enter a value manually or exclude this peer.",p?"medium":"low","high"); if(p) row.source={section:"Independent web valuation research",kind:"citation",url:p.source_url,publisher:p.source_label,accessed:new Date().toISOString().slice(0,10)}; assumptions.push(row); });
  values.sort((a,b)=>a-b); const median=values.length ? values[Math.floor(values.length/2)] : null;
  assumptions.splice(1,0,makeAssumption("comps","comps.selected_multiple","framework","Selected multiple",median,"x",median===null?"No citation-backed peer median available; validate a selected multiple manually.":"Proposed from recovered peer multiples; user validation is mandatory.",median===null?"low":"medium","high"));
  return {method:"comps" as const,status:"awaiting_validation" as const,assumptions,notes:["Valuation is gated until assumptions are accepted/edited and at least three peer multiples are validated.","Web-researched multiples are accepted only when the provider returned the same URL as a citation; otherwise the ledger stays blank."]};
}

function quantile(values:number[],q:number){ const a=[...values].sort((x,y)=>x-y), pos=(a.length-1)*q, lo=Math.floor(pos), hi=Math.ceil(pos); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo); }
export function calculateComps(a:FilingAnalysis, assumptions:ValuationAssumption[]):CompsValuationResult {
  const r=validatedRows("comps",assumptions), metric=text(r,"comps.multiple_metric") as "EV/EBITDA"|"EV/Revenue"|"P/E";
  if(!["EV/EBITDA","EV/Revenue","P/E"].includes(metric)) throw new ValuationInputError("unsupported_comps_metric");
  const selected=num(r,"comps.selected_multiple"), target=num(r,"comps.target_metric"), sh=num(r,"comps.shares_outstanding"); if(sh<=0) throw new ValuationInputError("shares_must_be_positive");
  const debt=metric==="P/E"?0:num(r,"comps.net_debt");
  const peerRows=[...r.values()].filter(x=>x.category==="peer_multiple"&&(x.status==="accepted"||x.status==="edited"));
  const peers=peerRows.flatMap(row=>{const v=resolved(row),n=typeof v==="number"?v:Number(v); return Number.isFinite(n)&&n>0?[{name:row.label.replace(/\s+—\s+.+$/, ""),multiple:n,source:row.source??null,assumption_id:row.id}]:[];});
  if(peers.length<3) throw new ValuationGateError("comps_requires_three_validated_peers",peerRows.map(x=>x.id));
  const vals=peers.map(x=>x.multiple as number), q1=quantile(vals,.25), med=quantile(vals,.5), q3=quantile(vals,.75), ids=peers.map(x=>x.assumption_id);
  const ev=metric==="P/E"?null:target*selected, equity=metric==="P/E"?target*selected:(ev as number)-debt, per=equity/sh, unit=`${a.jurisdiction==="br"?"BRL":"USD"}/share`;
  const perFor=(m:number)=>(metric==="P/E"?target*m:target*m-debt)/sh;
  return {method:"comps",status:"complete",multiple_metric:metric,peers,quartiles:{q1:{value:round(q1),unit:"x",assumption_ids:ids},median:{value:round(med),unit:"x",assumption_ids:ids},q3:{value:round(q3),unit:"x",assumption_ids:ids}},figures:{selected_multiple:{value:round(selected),unit:"x",assumption_ids:["comps.selected_multiple",...ids]},enterprise_value:{value:ev===null?null:round(ev),unit:a.financials.unit,assumption_ids:metric==="P/E"?[]:["comps.selected_multiple","comps.target_metric"]},equity_value:{value:round(equity),unit:a.financials.unit,assumption_ids:["comps.selected_multiple","comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt"])]},implied_per_share:{value:round(per),unit,assumption_ids:["comps.selected_multiple","comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt"])]}},sensitivity:[["Q1",q1],["Median",med],["Q3",q3],["Selected",selected]].filter((x,i,a2)=>a2.findIndex(y=>Math.abs(Number(y[1])-Number(x[1]))<1e-9)===i).map(([label,m])=>({label:String(label),multiple:round(Number(m)),implied_per_share:round(perFor(Number(m))),assumption_ids:[...ids,"comps.target_metric","comps.shares_outstanding",...(metric==="P/E"?[]:["comps.net_debt"])]})),notes:["Quartiles use only peer multiples explicitly accepted or edited by the user.","Rejected peers are excluded.",metric==="P/E"?"P/E produces equity value directly.":`${metric} produces enterprise value, then validated net debt bridges to equity value.`]};
}
