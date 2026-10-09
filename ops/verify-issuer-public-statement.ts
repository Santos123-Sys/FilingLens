/**
 * Real source acceptance: independently retrieve an issuer-owned PDF.
 * No SEC request, no proprietary FilingLens payload, no API credentials.
 * SEC CompanyFacts verification is NOT claimed by this report.
 */
import {APPLE_2025_DISCLOSURE,verifyIssuerApple2025Point} from "../contracts/issuer-statement-proof";
import {fetchAppleIssuerDisclosure} from "../api/issuer-pdf-proof";
import type {MarketResult} from "../contracts/analysis";
type Point=NonNullable<NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number]["dataPoints"]>[number];
const sourceUrl="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm";
const point=(label:string,amount:number,period="FY2025"):Point=>({
 label,value:`USD ${amount} millions`,period,
 context:"consolidated US GAAP; period end 2025-09-27",
 source:{kind:"citation",section:"Apple FY2025 indexed filing",url:sourceUrl},
});
async function main(){
 const doc=await fetchAppleIssuerDisclosure();
 if(!doc)throw new Error("Official Apple issuer-hosted PDF unavailable or unreadable");
 const expected=[
  ["Revenue",416161],["Operating income",133050],
  ["Net income",112010],["Gross profit",195201],
 ] as const;
 const positives=expected.map(([metric,amount])=>({
  metric,amountMillions:amount,
  proof:verifyIssuerApple2025Point("Apple Inc.",point(metric,amount),doc),
 }));
 const controls={
  wrongAmount:verifyIssuerApple2025Point("Apple Inc.",point("Revenue",416162),doc).status,
  wrongIssuer:verifyIssuerApple2025Point("Unrelated Inc.",point("Revenue",416161),doc).status,
  wrongYear:verifyIssuerApple2025Point("Apple Inc.",point("Revenue",416161,"FY2024"),doc).status,
  wrongAccession:verifyIssuerApple2025Point("Apple Inc.",{
   ...point("Revenue",416161),source:{kind:"citation",section:"wrong",
    url:sourceUrl.replace("000032019325000079","000032019325000078")}
  },doc).status,
 };
 const passed=positives.every(p=>p.proof.status==="verified")&&
  controls.wrongAmount==="amount_mismatch"&&
  controls.wrongIssuer==="source_mismatch"&&
  controls.wrongYear==="source_mismatch"&&controls.wrongAccession==="source_mismatch";
 console.log(JSON.stringify({schema:"filinglens.issuer_primary_statement_acceptance.v1",
  verified:passed,origin:"issuer_published_unaudited_pdf",secCompanyFactsVerified:false,
  issuer:APPLE_2025_DISCLOSURE.issuer,periodEnd:APPLE_2025_DISCLOSURE.periodEnd,
  sourceUrl:doc.url,sourceSha256:doc.sha256,retrievedAt:doc.retrievedAt,
  matched:positives.map(p=>({metric:p.metric,amountMillions:p.amountMillions,status:p.proof.status})),
  negativeControls:controls}));
 if(!passed){
  // Public Apple PDF only; no user/private data ever enters this command.
  console.warn("ISSUER_PUBLIC_PDF_TEXT_SAMPLE",JSON.stringify(doc.text.slice(0,2400)));
  process.exitCode=1;
 }
}
main().catch(e=>{console.error("ISSUER_DISCLOSURE_ACCEPTANCE_UNAVAILABLE",
 e instanceof Error?e.message:"unknown");process.exitCode=1;});
