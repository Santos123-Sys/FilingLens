import type {MarketResult} from "./analysis";
import {corroborateSecPeerPoint,secFilingIdentity} from "./sec-peer-proof";
import type {SecCompanyFacts} from "./sec-peer-proof";
import {metricOf} from "./peer-financial-benchmark";

type Peer=NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number];
type Point=NonNullable<Peer["dataPoints"]>[number];

export type SecAcceptanceInput={
 cik:string;peerName:string;filingUrl:string;metric:string;
 fiscalYear:number;periodEnd:string;basis:"US GAAP"|"IFRS";
 currency:"USD"|"EUR"|"GBP"|"CHF";amountMillions:number;
};
export function evaluateSecAcceptance(input:SecAcceptanceInput, facts:SecCompanyFacts){
 const identity=secFilingIdentity({url:input.filingUrl,section:"Filing",kind:"citation"});
 if(!/^\d{10}$/.test(input.cik)||!identity||identity.cik!==input.cik||
   !metricOf(input.metric)||!Number.isSafeInteger(input.fiscalYear)||
   !/^20\d{2}-\d{2}-\d{2}$/.test(input.periodEnd)||
   !Number.isFinite(input.amountMillions)||
   !/^-?\d+(?:\.\d{1,3})?$/.test(String(input.amountMillions)))
   throw new Error("invalid_or_unmatched_acceptance_arguments");
 const point:Point={
  label:input.metric,value:`${input.currency} ${input.amountMillions} millions`,
  period:`FY${input.fiscalYear}`,
  context:`consolidated ${input.basis}; period end ${input.periodEnd}`,
  source:{kind:"citation",section:"SEC primary filing",url:input.filingUrl},
 };
 const verified=corroborateSecPeerPoint(input.peerName,point,facts);
 const displaced=Number((input.amountMillions+Math.max(1000,Math.abs(input.amountMillions)*0.2)).toFixed(3));
 const wrongAmount=corroborateSecPeerPoint(input.peerName,{
  ...point,value:`${input.currency} ${displaced} millions`},facts);
 const wrongCik=corroborateSecPeerPoint(input.peerName,{...point,source:{
  ...point.source,url:input.filingUrl.replace(/(\/Archives\/edgar\/data\/)\d+\//,
    (_match,prefix:string)=>prefix+(identity.cik==="0000000001"?"2":"1")+"/"),
 }},facts);
 const wrongAccession=corroborateSecPeerPoint(input.peerName,{...point,source:{
  ...point.source,url:input.filingUrl.replace(/\/(\d{18})\//,(_match,acc:string)=>
   "/"+acc.slice(0,-1)+(acc.endsWith("0")?"1":"0")+"/"),
 }},facts);
 return {
  cik:input.cik,filingAccession:identity.accession,
  proof:verified,
  negativeControls:{amount:wrongAmount.status,cik:wrongCik.status,accession:wrongAccession.status},
  passed:verified.status==="verified"&&wrongAmount.status==="amount_mismatch"&&
   wrongCik.status==="identity_mismatch"&&wrongAccession.status==="source_mismatch",
 };
}
