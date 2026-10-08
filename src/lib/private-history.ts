import type { FilingAnalysis } from "@contracts/analysis";
export async function savePrivateAnalysisSnapshot(analysis:FilingAnalysis) {
 const sessionResponse=await fetch("/api/history/session",{credentials:"same-origin",cache:"no-store"});
 if(!sessionResponse.ok)throw new Error("history_session_unavailable");
 const session=await sessionResponse.json() as {csrf:string};
 const response=await fetch("/api/history/save",{
  method:"POST",credentials:"same-origin",
  headers:{"Content-Type":"application/json","X-History-CSRF":session.csrf},
  body:JSON.stringify({jurisdiction:analysis.jurisdiction,company:analysis.company,
   financials:{unit:analysis.financials.unit,years:analysis.financials.years,revenue:analysis.financials.revenue,
    netIncome:analysis.financials.netIncome,annualHistory:analysis.financials.annualHistory,
    validationFlags:analysis.financials.validationFlags}})
 });
 if(!response.ok)throw new Error("history_save_failed_"+response.status);
 return await response.json();
}
