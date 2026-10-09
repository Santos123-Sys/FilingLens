import {describe,expect,it} from "vitest";
import type {MarketResult} from "./analysis";
import {APPLE_2025_DISCLOSURE,verifyIssuerApple2025Point} from "./issuer-statement-proof";
type Peer=NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number];
type Point=NonNullable<Peer["dataPoints"]>[number];
const text=`Apple Inc.
CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)
(In millions, except number of shares)
Three Months Ended Twelve Months Ended
September 27, 2025 September 28, 2024 September 27, 2025 September 28, 2024
Products 73,716 69,958 307,003 294,866
Services 28,750 24,972 109,158 96,169
Total net sales (1) 102,466 94,930 416,161 391,035
Total cost of sales 54,125 51,051 220,960 210,352
Gross margin 48,341 43,879 195,201 180,683
Operating income 32,427 29,591 133,050 123,216
Net income 27,466 14,736 112,010 93,736
`.repeat(12);
const doc={url:APPLE_2025_DISCLOSURE.url,sha256:"a".repeat(64),text,
 retrievedAt:"2026-10-09T09:00:00.000Z"};
const source="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm";
const point=(label="Revenue",value="USD 416161 millions"):Point=>({
 label,value,period:"FY2025",context:"consolidated US GAAP; period end 2025-09-27",
 source:{kind:"citation",section:"Apple FY2025 filing",url:source}
});
describe("issuer-first disclosure numeric proof",()=>{
 it("matches unrounded FY2025 annual net sales from real issuer table shape",()=>{
  const proof=verifyIssuerApple2025Point("Apple Inc.",point(),doc);
  expect(proof).toMatchObject({status:"verified",provider:"issuer_published_statement",
   sourceMode:"issuer_published_unaudited_pdf",page:1,
   proofUrl:APPLE_2025_DISCLOSURE.url,periodEnd:"2025-09-27"});
 });
 it("validates independent operating income and net income rows",()=>{
  expect(verifyIssuerApple2025Point("Apple Inc.",point("Operating income","USD 133050 millions"),doc).status).toBe("verified");
  expect(verifyIssuerApple2025Point("Apple Inc.",point("Net income","USD 112010 millions"),doc).status).toBe("verified");
  expect(verifyIssuerApple2025Point("Apple Inc.",point("Gross profit","USD 195201 millions"),doc).status).toBe("verified");
 });
 it("fails on a mismatched amount, year, CIK, accession, or source",()=>{
  expect(verifyIssuerApple2025Point("Apple Inc.",point("Revenue","USD 1 millions"),doc).status).toBe("amount_mismatch");
  expect(verifyIssuerApple2025Point("Other Inc.",point(),doc).status).toBe("source_mismatch");
  expect(verifyIssuerApple2025Point("Apple Inc.",{...point(),period:"FY2024"},doc).status).toBe("source_mismatch");
  expect(verifyIssuerApple2025Point("Apple Inc.",{...point(),source:{kind:"citation",section:"fake",
   url:source.replace("320193","789019")}},doc).status).toBe("source_mismatch");
  expect(verifyIssuerApple2025Point("Apple Inc.",{...point(),source:{kind:"citation",section:"wrong",
   url:source.replace("000032019325000079","000032019325000078")}},doc).status).toBe("source_mismatch");
  expect(verifyIssuerApple2025Point("Apple Inc.",point(),{...doc,url:"https://attacker.example/pdf"}).status).toBe("source_mismatch");
 });
 it("cannot produce proof without a fetched document and fails on wrong period header",()=>{
  expect(verifyIssuerApple2025Point("Apple Inc.",point(),null).status).toBe("unavailable");
  expect(verifyIssuerApple2025Point("Apple Inc.",point(),{...doc,text:doc.text.replaceAll("September 27, 2025","September 27, 2024")}).status).toBe("source_mismatch");
 });
 it("parses the four PDF monetary columns when pdf-parse removes inter-column spaces",()=>{
  const compressed=doc.text
   .replaceAll("102,466 94,930 416,161 391,035","102,46694,930416,161391,035")
   .replaceAll("32,427 29,591 133,050 123,216","32,42729,591133,050123,216")
   .replaceAll("27,466 14,736 112,010 93,736","27,46614,736112,01093,736");
  expect(verifyIssuerApple2025Point("Apple Inc.",point(),{...doc,text:compressed}).status).toBe("verified");
  expect(verifyIssuerApple2025Point("Apple Inc.",point("Operating income","USD 133050 millions"),{...doc,text:compressed}).status).toBe("verified");
 });
});
