export type TradingPeerSnapshot={
 name:string;
 currency:"USD"|"BRL"|"EUR"|"GBP"|"CHF";
 basis:"us_gaap"|"ifrs"|"br_gaap";
 consolidated:boolean;
 quotation_date:string;
 financial_period_end:string;
 debt_as_of:string;
 market_cap_millions:number|null;
 net_debt_millions:number|null;
 ebitda_millions:number|null;
 revenue_millions:number|null;
 net_income_millions:number|null;
 quotation_source_url:string;
 financial_source_url:string;
};
export type ValuationMultiple="EV/EBITDA"|"EV/Revenue"|"P/E";
export type TradingPeerResult={name:string;multiple:number;quotationDate:string;
 periodEnd:string;sourceUrls:string[];snapshot:TradingPeerSnapshot};
const date=(raw:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(raw)&&
 !Number.isNaN(Date.parse(raw))&&new Date(raw).toISOString().slice(0,10)===raw;
const http=(raw:string)=>{try{const u=new URL(raw);return u.protocol==="https:";}catch{return false;}};
const num=(n:number|null):n is number=>typeof n==="number"&&Number.isFinite(n);
const equal=(a:string,b:string)=>a.trim().toLowerCase()===b.trim().toLowerCase();
/**
 * Source-catalog URLs are supplied by the caller, never trusted merely because
 * the model wrote a URL. Missing dates, issuer scope, or financial components
 * are ineligible. No inferred FX or comparison across accounting regimes.
 */
export function evaluateTradingPeer(snapshot:TradingPeerSnapshot,metric:ValuationMultiple,
 context:{peer:string;issuerPeriodEnd:string;currency:string;basis:string;today:string;sourceUrls:Set<string>}
):TradingPeerResult|null {
 if(!equal(snapshot.name,context.peer)||!snapshot.consolidated||
   snapshot.currency!==context.currency||snapshot.basis!==context.basis ||
   !date(snapshot.quotation_date)||!date(snapshot.financial_period_end)||
   !date(context.today)||snapshot.financial_period_end!==context.issuerPeriodEnd ||
   !http(snapshot.quotation_source_url)||!http(snapshot.financial_source_url)||
   !context.sourceUrls.has(snapshot.quotation_source_url)||
   !context.sourceUrls.has(snapshot.financial_source_url))return null;
 const elapsed=(Date.parse(context.today)-Date.parse(snapshot.quotation_date))/86400000;
 if(elapsed<0||elapsed>7)return null;
 if(!num(snapshot.market_cap_millions)||snapshot.market_cap_millions<=0)return null;
 let value:number|null=null;
 if(metric==="P/E"){
   if(!num(snapshot.net_income_millions)||snapshot.net_income_millions<=0)return null;
   value=snapshot.market_cap_millions/snapshot.net_income_millions;
 }else{
   if(!date(snapshot.debt_as_of)||snapshot.debt_as_of!==snapshot.financial_period_end||
     !num(snapshot.net_debt_millions))return null;
   const enterprise=snapshot.market_cap_millions+snapshot.net_debt_millions;
   const denominator=metric==="EV/EBITDA"?snapshot.ebitda_millions:snapshot.revenue_millions;
   if(!num(denominator)||denominator<=0||enterprise<=0)return null;
   value=enterprise/denominator;
 }
 if(!Number.isFinite(value)||value<=0||value>1000)return null;
 return {name:snapshot.name,multiple:Number(value.toFixed(6)),
   quotationDate:snapshot.quotation_date,periodEnd:snapshot.financial_period_end,
   sourceUrls:[snapshot.quotation_source_url,snapshot.financial_source_url],snapshot:{...snapshot}};
}
/** One coherent quote snapshot date is needed for median peer multiples. */
export function commonQuoteDate(peers:TradingPeerResult[]):string|null {
 if(peers.length<3)return null;
 const dates=[...new Set(peers.map(x=>x.quotationDate))];
 return dates.length===1?dates[0]:null;
}
