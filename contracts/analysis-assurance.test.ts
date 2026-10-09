import {describe,it,expect} from "vitest";
import type {FilingAnalysis} from "./analysis";
import {assessAnalysisQuality,buildAuditPayload} from "./analysis-assurance";
import {buildDecisionDossier,emptyAnalystReview} from "./decision-dossier";

const filing={kind:"excerpt",section:"Item 8",quote:"Revenue increased"};
const fixture=()=>({
 schemaVersion:"2.0",jurisdiction:"us",
 company:{name:"Example Inc.",ticker:"EX",exchange:"NASDAQ",periodEnd:"FY2025",filedAt:"2026-02-01"},
 metadata:{cik:"0000320193"},
 financials:{years:["FY2024","FY2025"],unit:"USD millions",
  revenue:[100,110],netIncome:[10,15],
  evidence:[{metric:"revenue",period:"FY2025",source:filing}],
  validation:{balanceSheetIdentity:"reconciled",difference:0,ocrAnomalies:[],jumpWarnings:[]}},
 risks:[],market:{peerEvidence:[],competitiveAnalysis:{peerProfiles:[]}},
 confidenceNotes:[],missingData:[],
 diagnostics:{financials:{status:"complete"}},
}) as unknown as FilingAnalysis;
const review=()=>{
 const r=emptyAnalystReview();
 r.thesis="Higher operating return";
 r.counterCase="Competitive pricing";
 r.catalysts="Future quarterly filings";
 r.checks={financials:true,sources:true,risks:true,valuation:true};
 return r;
};
describe("Phase 6 release assurance",()=>{
 it("allows internally reviewable while explicitly preserving unresolved official proof",()=>{
  const x=fixture(),d=buildDecisionDossier(x,review());
  const a=assessAnalysisQuality(x,d);
  expect(a.reviewReadiness).toBe("reviewable");
  expect(a.officialRegulatoryAcceptance).toBe("not_demonstrated");
  expect(a.checks.find(z=>z.id==="valuation")?.status).toBe("not_applicable");
 });
 it("blocks misaligned financial arrays and duplicate reporting periods",()=>{
  const x=fixture();x.financials.revenue=[100];
  const a=assessAnalysisQuality(x,buildDecisionDossier(x,review()));
  expect(a.reviewReadiness).toBe("blocked");
  expect(a.checks.find(z=>z.id==="financial_periods")?.status).toBe("blocked");
  const y=fixture();y.financials.years=["FY2025","FY2025"];
  expect(assessAnalysisQuality(y,buildDecisionDossier(y,review())).reviewReadiness).toBe("blocked");
 });
 it("refuses to greenlight a mismatched balance sheet or failed modules",()=>{
  const x=fixture();x.financials.validation!.balanceSheetIdentity="mismatch";
  expect(assessAnalysisQuality(x,buildDecisionDossier(x,review())).reviewReadiness).toBe("blocked");
  const y=fixture();y.diagnostics!.financials={status:"failed",reason:"timeout"};
  expect(assessAnalysisQuality(y,buildDecisionDossier(y,review())).reviewReadiness).toBe("attention");
 });
 it("does not treat manual draft as approved review",()=>{
  const x=fixture();
  const a=assessAnalysisQuality(x,buildDecisionDossier(x,emptyAnalystReview()));
  expect(a.reviewReadiness).toBe("attention");
  expect(a.checks.find(z=>z.id==="analyst_review")?.status).toBe("attention");
 });
 it("deterministically builds an export payload with explicit audit limits",()=>{
  const x=fixture();
  const a=buildAuditPayload(x,review(),null,"2026-10-09T12:30:00.000Z");
  const b=buildAuditPayload(x,review(),null,"2026-10-09T12:30:00.000Z");
  expect(a).toEqual(b);
  expect(a.dossier.issuer.name).toBe("Example Inc.");
  expect(a.assurance.officialRegulatoryAcceptance).toBe("not_demonstrated");
  expect(()=>buildAuditPayload(x,review(),null,"today")).toThrow(/invalid_audit_timestamp/);
 });
});
