import type { EvidenceReference, MarketResult } from "./analysis";
import { metricOf, parseValue, periodEndOf } from "./peer-financial-benchmark";

type Peer = NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number];
type Point = NonNullable<Peer["dataPoints"]>[number];
export type SecProof = NonNullable<Point["primaryVerification"]>;
export type SecCompanyFacts = {
  cik?: number;
  entityName?: string;
  facts?: Record<string, Record<string, {units?:Record<string,Array<{
    accn?:string; form?:string; start?:string; end?:string;
    fp?:string; fy?:number; val?:number;
  }>>}>>;
};
const tags:Record<string,string[]>={
 revenue:["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet"],
 netIncome:["NetIncomeLoss","ProfitLoss"],
 operatingIncome:["OperatingIncomeLoss"],
 grossProfit:["GrossProfit"],
};
const compact=(s:string)=>s.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ")
 .replace(/\b(?:inc|incorporated|corporation|corp|limited|ltd|plc|company|co)\b/g,"")
 .replace(/\s+/g," ").trim();
const accn=(s:string)=>s.replaceAll("-","");
const isoDate=(s:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const duration=(start:string,end:string)=> (Date.parse(end)-Date.parse(start))/86400000;
export function secFilingIdentity(source:EvidenceReference):{cik:string;accession:string}|null{
 if(!source.url)return null;
 try{
  const u=new URL(source.url);
  if(u.protocol!=="https:"||!["sec.gov","www.sec.gov"].includes(u.hostname.toLowerCase()))return null;
  const m=/^\/Archives\/edgar\/data\/([1-9]\d{0,9})\/(\d{18})\/[^/?#]+/i.exec(u.pathname);
  if(!m)return null;
  return {cik:m[1].padStart(10,"0"),accession:m[2]};
 }catch{return null;}
}
export function secProofUrl(cik:string):string{
 if(!/^\d{10}$/.test(cik))throw Error("CIK must be 10 numeric digits");
 return `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
}
const fallback=(status:SecProof["status"],identity:{cik:string;accession:string}|null):SecProof=>({
 status,provider:"sec_companyfacts",...(identity?{cik:identity.cik,filingAccession:identity.accession}:{}),
});
/**
 * Confirm a model-extracted FY amount against the exact SEC accession cited by
 * the peer research point and the XBRL companyfacts issuer identity.
 * This refuses comparisons across different filings, years or duration.
 */
export function corroborateSecPeerPoint(peerName:string,point:Point,companyFacts:SecCompanyFacts|null):SecProof{
 const identity=secFilingIdentity(point.source);
 if(!identity)return fallback("not_in_sec",null);
 if(!companyFacts)return fallback("unavailable",identity);
 if(!Number.isSafeInteger(companyFacts.cik)||String(companyFacts.cik).padStart(10,"0")!==identity.cik||
  !companyFacts.entityName||compact(peerName)!==compact(companyFacts.entityName)){
  return fallback("identity_mismatch",identity);
 }
 const metric=metricOf(point.label),value=parseValue(point.value),end=periodEndOf(point.context);
 const year=/^FY(20\d{2})$/i.exec(point.period.trim());
 if(!metric||!value||value.currency!=="USD"||!end||!isoDate(end)||!year||
    Number(end.slice(0,4))!==Number(year[1])){
  return fallback("source_mismatch",identity);
 }
 const namespace=companyFacts.facts?.["us-gaap"];
 if(!namespace)return fallback("source_mismatch",identity);
 const valid:number[]=[];
 for(const tag of tags[metric]??[]){
  for(const row of namespace[tag]?.units?.USD??[]){
   if(!Number.isFinite(row.val)||row.form!=="10-K"&&row.form!=="10-K/A"||
      row.fp!=="FY"||row.end!==end||!row.start||!isoDate(row.start))continue;
   if(!row.accn||accn(row.accn)!==identity.accession)continue;
   const days=duration(row.start,row.end);
   if(days<330||days>400)continue;
   valid.push(row.val!/1_000_000);
  }
 }
 if(!valid.length)return fallback("source_mismatch",identity);
 // Multiple filing facts with differing values mean taxonomy/restatement
 // ambiguity. A coincidence with the model candidate is not enough.
 if(valid.some(x=>Math.abs(x-valid[0])>Math.max(0.001,Math.abs(valid[0])*0.000001))){
  return fallback("source_mismatch",identity);
 }
 const tolerance=Math.max(0.001,Math.abs(valid[0])*0.00001); // 0.001 million / 10 ppm
 if(Math.abs(valid[0]-value.millions)>tolerance)return fallback("amount_mismatch",identity);
 return {...fallback("verified",identity),proofUrl:secProofUrl(identity.cik)};
}
