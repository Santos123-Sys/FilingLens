import {describe,it,expect} from "vitest";
import type {FilingAnalysis} from "../contracts/analysis";
import {emptyAnalystReview} from "../contracts/decision-dossier";
import {buildAuditPayload,type AuditBundle} from "../contracts/analysis-assurance";
import {auditPayloadSha256,verifyAuditBundle} from "./verify-phase6-audit";

const data=()=>({
 schemaVersion:"2.0",jurisdiction:"us",
 company:{name:"Fixture Co",ticker:"FX",exchange:"NYSE",periodEnd:"FY2025",filedAt:"2026-02-10"},
 metadata:{cik:"0000320193"},
 financials:{years:["FY2025"],unit:"USD millions",revenue:[100],netIncome:[10],
  evidence:[{metric:"revenue",period:"FY2025",source:{kind:"excerpt",section:"Item 8",quote:"Revenue of 100"}}]},
 risks:[],market:{peerEvidence:[]},confidenceNotes:[],missingData:[],diagnostics:{financials:{status:"complete"}},
}) as unknown as FilingAnalysis;
const bundle=():AuditBundle=>{
 const body=buildAuditPayload(data(),emptyAnalystReview(),null,"2026-10-09T15:00:00.000Z");
 return {...body,sha256:auditPayloadSha256(body)};
};
describe("Phase 6 offline audit bundle integrity",()=>{
 it("accepts a reproducible local export and states remaining official gate",()=>{
  const report=verifyAuditBundle(JSON.parse(JSON.stringify(bundle())));
  expect(report).toEqual({valid:true,issuer:"Fixture Co",reviewReadiness:"attention",
   officialRegulatoryAcceptance:"not_demonstrated"});
 });
 it("rejects modification without updating checksum",()=>{
  const b=bundle();
  b.analysis.company.name="Malicious co";
  expect(()=>verifyAuditBundle(b)).toThrow(/checksum_mismatch/);
 });
 it("rejects internally inconsistent assurance even with recomputed SHA256",()=>{
  const b=bundle();
  b.assurance.reviewReadiness="reviewable";
  const {sha256:_unused,...payload}=b;
  b.sha256=auditPayloadSha256(payload);
  expect(()=>verifyAuditBundle(b)).toThrow(/recomputation_mismatch/);
 });
 it("rejects malformed checksum and object",()=>{
  const b=bundle();b.sha256="not-sha";
  expect(()=>verifyAuditBundle(b)).toThrow(/invalid_audit_schema/);
  expect(()=>verifyAuditBundle(null)).toThrow(/invalid_audit_object/);
 });
});
