import type { FilingAnalysis } from "@contracts/analysis";

type AnnualPeriod = {label:string;endDate:string;fiscalYear:number;periodKind:"FY"};
/**
 * Fail closed: free-form chart labels are not dates. Only the filing's explicit
 * period-end can authorize an annual observation for a matching fiscal year.
 * Older years remain empty until another dated source is analyzed.
 */
export function buildHistorySubmission(data:FilingAnalysis) {
 const registryId=(data.jurisdiction==="br"?data.metadata.cnpj:data.metadata.cik)?.replace(/\D/g,"")??"";
 const filedAt=data.metadata.filedAt??data.company.filedAt??"";
 const periodEnd=data.company.periodEnd;
 const annual=/10-K|20-F|40-F|DFP|ANNUAL/i.test(data.company.filingType);
 const years=data.financials.years;
 const last=years.at(-1)??"";
 const fiscal=last.match(/^(?:FY[\s-]*)?(\d{4})$/i)?.[1];
 if(!annual||registryId.length<6||!/^\d{4}-\d{2}-\d{2}$/.test(filedAt)||
   !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||!fiscal||
   Number(fiscal)!==Number(periodEnd.slice(0,4))||!years.length) return null;
 const rawUnit=data.financials.unit;
 const currency=/BRL|R\$/i.test(rawUnit)?"BRL":/USD|US\$|\$/i.test(rawUnit)?"USD":null;
 const unit=/million|milh[oõ]es|milh[aã]o/i.test(rawUnit)?"millions":/thousand|milhar/i.test(rawUnit)?"thousands":null;
 if(!currency||!unit)return null;
 const fields=["revenue","grossProfit","ebit","ebitda","adjustedEbitda","incomeBeforeTax","incomeTaxExpense",
  "reportedRoic","netIncome","eps","grossMargin","operatingMargin","operatingCashFlow","capex","freeCashFlow",
  "dividends","buybacks","totalAssets","totalLiabilities","totalEquity","totalDebt","shortTermDebt","longTermDebt",
  "cash","currentAssets","currentLiabilities","interestExpense","accountsReceivable","inventory","accountsPayable","costOfGoodsSold","goodwill"] as const;
 // Avoid mixing historical periods with the latest year. All non-period arrays
 // such as computed metrics, trends and validation flags remain untouched.
 const financials={...data.financials,years:[last]};
 for(const key of fields) {
   const values=data.financials[key];
   if(Array.isArray(values)) (financials as Record<string,unknown>)[key]=values.length===years.length?[values.at(-1)]:null;
 }
 return {
  company:{jurisdiction:data.jurisdiction,registryId,legalName:data.company.name,ticker:data.company.ticker},
  filing:{filingKey:data.company.filingReference??[registryId,data.company.filingType,periodEnd,filedAt].join(":"),
    formType:data.company.filingType,periodEnd,filedAt},
  financials,currency,unit,
  periods:[{label:last,endDate:periodEnd,fiscalYear:Number(fiscal),periodKind:"FY"} satisfies AnnualPeriod],
 };
}
