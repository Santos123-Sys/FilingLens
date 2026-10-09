import {createHash} from "node:crypto";
import type {MarketResult} from "./analysis";
import {metricOf,parseValue,periodEndOf} from "./peer-financial-benchmark";
import {secFilingIdentity} from "./sec-peer-proof";

/** A separately labeled issuer-PUBLISHED financial statement, not SEC CompanyFacts. */
export const APPLE_2025_DISCLOSURE={
 cik:"0000320193",issuer:"Apple Inc.",fiscalYear:2025,periodEnd:"2025-09-27",
 filingAccession:"000032019325000079",
 url:"https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf",
} as const;
export type IssuerDisclosureDocument={
 url:string;text:string;sha256:string;retrievedAt:string;
};
export type IssuerStatementProof={
 status:"verified"|"unavailable"|"source_mismatch"|"amount_mismatch";
 provider:"issuer_published_statement";
 sourceMode?:"issuer_published_unaudited_pdf";
 issuer?:string;periodEnd?:string;currency?:string;
 pdfSha256?:string;proofUrl?:string;page?:number;
};
type Peer=NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number];
type Point=NonNullable<Peer["dataPoints"]>[number];

const numeric=(s:string)=>Number(s.replaceAll(",",""));
const rows:Record<string,string>={
 revenue:"Total net sales",
 netIncome:"Net income",
 operatingIncome:"Operating income",
 grossProfit:"Gross margin",
};
export function issuerApple2025Point(peerName:string,point:Point){
 if(!/^apple\s+inc\.?$/i.test(peerName.trim()))return false;
 const id=secFilingIdentity(point.source);
 return id?.cik===APPLE_2025_DISCLOSURE.cik&&
  id.accession===APPLE_2025_DISCLOSURE.filingAccession &&
  point.period.trim()==="FY2025"&&
  periodEndOf(point.context)===APPLE_2025_DISCLOSURE.periodEnd&&
  /\bconsolidated\b/i.test(point.context)&&
  /\bus[ -]?gaap\b/i.test(point.context)&&
  !/\bifrs\b/i.test(point.context)&&
  Boolean(metricOf(point.label));
}
function annualRowAmount(text:string,label:string):number|null{
 // pdftotext and pdf-parse differ: adjacent PDF columns can become
 // "102,46694,930416,161391,035" with no whitespace.
 const head=text.slice(0,Math.min(text.length,24_000));
 const values=new Set<number>();
 const pattern=new RegExp(label,"gi"); // Labels are fixed letters/spaces from rows map.
 let match:RegExpExecArray|null;
 while((match=pattern.exec(head))!==null){
  const after=head.slice(match.index+match[0].length,match.index+match[0].length+260);
  const content=after.replace(/^\s*(?:\(\s*1\s*\))?\s*\$?\s*/,"");
  const firstLine=content.split(/\r?\n(?=\s*[A-Za-z])/)[0].slice(0,180);
  const cells=[...firstLine.matchAll(/\(?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?/g)];
  if(cells.length!==4)continue;
  const candidate=numeric(cells[2][0].replace(/[()]/g,""));
  if(Number.isFinite(candidate))values.add(candidate);
 }
 return values.size===1?[...values][0]:null;
}
export function verifyIssuerApple2025Point(peerName:string,point:Point,
 doc:IssuerDisclosureDocument|null):IssuerStatementProof{
 const fallback=(status:IssuerStatementProof["status"]):IssuerStatementProof=>({
  status,provider:"issuer_published_statement",
 });
 if(!issuerApple2025Point(peerName,point))return fallback("source_mismatch");
 if(!doc)return fallback("unavailable");
 if(doc.url!==APPLE_2025_DISCLOSURE.url||
    !/^[a-f0-9]{64}$/.test(doc.sha256)||doc.text.length<400||
    doc.text.length>400_000)return fallback("source_mismatch");
 const head=doc.text.slice(0,24_000);
 if(!/Apple\s+Inc\./i.test(head)||
  !/CONDENSED\s+CONSOLIDATED\s+STATEMENTS\s+OF\s+OPERATIONS/i.test(head)||
  !/Unaudited/i.test(head)||
  !/Twelve\s+Months\s+Ended/i.test(head)||
  !/In\s+millions/i.test(head)||
  !/September\s+27,?\s*2025/i.test(head))return fallback("source_mismatch");
 const metric=metricOf(point.label),amount=parseValue(point.value);
 if(!metric||!amount||amount.currency!=="USD")return fallback("source_mismatch");
 const value=annualRowAmount(head,rows[metric]);
 if(value===null)return fallback("source_mismatch");
 if(Math.abs(value-amount.millions)>Math.max(0.001,Math.abs(value)*0.000001))
  return fallback("amount_mismatch");
 return {status:"verified",provider:"issuer_published_statement",
  sourceMode:"issuer_published_unaudited_pdf",issuer:APPLE_2025_DISCLOSURE.issuer,
  periodEnd:APPLE_2025_DISCLOSURE.periodEnd,currency:"USD",
  pdfSha256:doc.sha256,proofUrl:doc.url,page:1};
}
export function issuerSourceHash(raw:Buffer){return createHash("sha256").update(raw).digest("hex");}
