import {describe,it,expect} from "vitest";
import type {FilingAnalysis,FilingDelta} from "./analysis";
import {buildDecisionDossier,cleanAnalystReview,emptyAnalystReview} from "./decision-dossier";
const filing={kind:"excerpt",section:"Item 8",quote:"Revenue: 100"};
const citation={kind:"citation",section:"Competitor",url:"https://sec.gov/Archives/edgar/data/320193/report.htm"};
const stub=()=>({
 jurisdiction:"us",company:{name:"Example Inc.",periodEnd:"FY2025",filedAt:"2026-02-10"},
 metadata:{cik:"0000320193"},
 financials:{years:["FY2025"],evidence:[
  {metric:"revenue",period:"FY2025",source:filing},
  {metric:"revenue",period:"FY2025",source:filing},
  {metric:"netIncome",period:"FY2025",source:{kind:"citation",section:"Spoof",url:"http://bad.example"}},
 ]},
 risks:[{title:"Competition",source:{kind:"excerpt",section:"Item 1A",quote:"Competitor risk"}}],
 market:{peerEvidence:[{name:"Peer",sourceType:"external",source:citation}],
 competitiveAnalysis:{peerProfiles:[]}},confidenceNotes:[],missingData:[],
}) as unknown as FilingAnalysis;
describe("Phase 5 analyst dossier",()=>{
 it("creates a bounded, source-separated register without claiming SEC official proof",()=>{
  const r=buildDecisionDossier(stub(),emptyAnalystReview());
  expect(r.status).toBe("draft");
  expect(r.coverage).toMatchObject({filingExcerpts:2,externalCitations:1,total:3,omitted:1});
  expect(r.evidence.map(x=>x.origin)).toEqual(["filing_excerpt","filing_excerpt","external_citation"]);
  expect(r.notices.join(" ")).toMatch(/SEC CompanyFacts/);
  expect(r.issuer.registryId).toBe("0000320193");
 });
 it("requires all manual review declarations and three nonempty balanced sections",()=>{
  const x=emptyAnalystReview();
  x.thesis="Revenue growth supported by filings";
  x.counterCase="Margin pressure";
  x.catalysts="Next earnings";
  expect(buildDecisionDossier(stub(),x).status).toBe("draft");
  x.checks={financials:true,sources:true,risks:true,valuation:true};
  expect(buildDecisionDossier(stub(),x).status).toBe("analyst_review_recorded");
  x.counterCase="   ";
  expect(buildDecisionDossier(stub(),x).status).toBe("draft");
 });
 it("rejects invalid user review shapes or overlong notes",()=>{
  expect(()=>cleanAnalystReview({...emptyAnalystReview(),thesis:"x".repeat(3001)})).toThrow();
  const x=emptyAnalystReview();(x.checks as unknown as Record<string,unknown>).sources="true";
  expect(()=>cleanAnalystReview(x)).toThrow();
 });
 it("excludes insecure or invalid URLs and keeps citations separate from filing excerpts",()=>{
  const x=stub();
  x.market.peerEvidence=[{name:"Peer",sourceType:"external",
   source:{kind:"citation",section:"Bad",url:"https://bob:pass@example.org"}}];
  const r=buildDecisionDossier(x,emptyAnalystReview());
  expect(r.coverage.externalCitations).toBe(0);
  expect(r.evidence.every(y=>y.origin==="filing_excerpt")).toBe(true);
 });
 it("carries mismatch counts only as unconfirmed review candidates",()=>{
  const d={status:"ready",changes:[{metric:"revenue",period:"FY2025"}]} as unknown as FilingDelta;
  const r=buildDecisionDossier(stub(),emptyAnalystReview(),d);
  expect(r.research.flaggedDiscrepancies).toBe(1);
  expect(r.notices.join(" ")).toContain("not confirmed restatements");
 });
 it("omits excessive source lists instead of generating huge exports",()=>{
  const x=stub();
  x.financials.evidence=Array.from({length:120},(_,i)=>({
   metric:"revenue",period:"FY2025",source:{kind:"excerpt",section:`Item ${i}`,quote:"source"},
  }));
  const r=buildDecisionDossier(x,emptyAnalystReview());
  expect(r.evidence.length).toBe(100);
  expect(r.coverage.omitted).toBeGreaterThan(0);
 });
});
