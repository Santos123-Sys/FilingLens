export type SecEdgarIssuer={ticker:string;cik:string;forms:string[]};
export type SecEdgarWatchlist={
 schema:"filinglens.sec_edgar_watchlist.v1";
 lookbackDays:number;
 limitPerForm:number;
 issuers:SecEdgarIssuer[];
};

const isRecord=(value:unknown):value is Record<string,unknown>=>
 !!value&&typeof value==="object"&&!Array.isArray(value);
const allowedForms=new Set(["10-K","10-Q","8-K"]);

/** Keep scheduled SEC work intentionally small and reviewable. */
export function parseSecEdgarWatchlist(value:unknown):SecEdgarWatchlist{
 if(!isRecord(value)||value.schema!=="filinglens.sec_edgar_watchlist.v1"||
  !Number.isInteger(value.lookbackDays)||Number(value.lookbackDays)<1||Number(value.lookbackDays)>31||
  !Number.isInteger(value.limitPerForm)||Number(value.limitPerForm)<1||Number(value.limitPerForm)>5||
  !Array.isArray(value.issuers)||value.issuers.length<1||value.issuers.length>12)
  throw new Error("invalid SEC EDGAR watchlist");
 const issuers=value.issuers.map((candidate,index)=>{
  if(!isRecord(candidate)||typeof candidate.ticker!=="string"||
   !/^[A-Z][A-Z0-9.-]{0,9}$/.test(candidate.ticker)||
   typeof candidate.cik!=="string"||!/^\d{10}$/.test(candidate.cik)||
   !Array.isArray(candidate.forms)||candidate.forms.length<1||candidate.forms.length>3||
   candidate.forms.some(form=>typeof form!=="string"||!allowedForms.has(form))||
   new Set(candidate.forms).size!==candidate.forms.length)
   throw new Error(`invalid SEC EDGAR issuer at index ${index}`);
  return {ticker:candidate.ticker,cik:candidate.cik,forms:[...candidate.forms]};
 });
 if(new Set(issuers.map(issuer=>issuer.ticker)).size!==issuers.length||
  new Set(issuers.map(issuer=>issuer.cik)).size!==issuers.length)
  throw new Error("SEC EDGAR watchlist contains duplicate issuer identity");
 return {schema:value.schema,lookbackDays:Number(value.lookbackDays),
  limitPerForm:Number(value.limitPerForm),issuers};
}
