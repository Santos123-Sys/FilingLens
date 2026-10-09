import type {FilingAnalysis} from "./analysis";
import type {FilingDelta} from "./filing-change-intelligence";
import {buildDecisionDossier,type AnalystReview,type DecisionDossier} from "./decision-dossier";

export type AssuranceCheck={
 id:"issuer_identity"|"financial_periods"|"financial_reconciliation"|"module_diagnostics"|
    "evidence_inventory"|"analyst_review"|"valuation"|"prior_filing_comparison";
 status:"pass"|"attention"|"blocked"|"not_applicable";
 detail:string;
};
export type AnalysisAssurance={
 schema:"filinglens.analysis_assurance.v1";
 reviewReadiness:"reviewable"|"attention"|"blocked";
 officialRegulatoryAcceptance:"not_demonstrated";
 checks:AssuranceCheck[];
 issues:{blocked:number;attention:number};
 notices:string[];
};
export type AuditPayload={
 schema:"filinglens.audit_bundle.v1";
 createdAt:string;
 analysis:FilingAnalysis;
 delta:FilingDelta|null;
 dossier:DecisionDossier;
 assurance:AnalysisAssurance;
};
export type AuditBundle=AuditPayload & {sha256:string};
const num=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const checksumDate=(s:string)=>!Number.isNaN(Date.parse(s))&&new Date(s).toISOString()===s;
/**
 * Phase 6: a repeatable *analysis quality* gate, not source authentication.
 * This can never, on its own, authorize SEC CompanyFacts production acceptance.
 */
export function assessAnalysisQuality(data:FilingAnalysis,dossier:DecisionDossier,
 delta?:FilingDelta|null):AnalysisAssurance {
 const checks:AssuranceCheck[]=[];
 const add=(id:AssuranceCheck["id"],status:AssuranceCheck["status"],detail:string)=>
  checks.push({id,status,detail});
 const registry=data.jurisdiction==="us"?data.metadata.cik:data.metadata.cnpj;
 const registryValid=data.jurisdiction==="us"?/^\d{10}$/.test(registry??""):
  /^\d{14}$/.test((registry??"").replace(/\D/g,""));
 add("issuer_identity",!data.company.name?.trim()?"blocked":registryValid?"pass":"attention",
  registryValid?"Regulator issuer identifier present; value is not independently registry-authenticated.":
   "Issuer name or exact CIK/CNPJ is absent or malformed; automatic issuer matching is not proven.");
 const years=data.financials.years??[];
 const series=[data.financials.revenue,data.financials.netIncome];
 const malformed=years.length>5||new Set(years).size!==years.length||
  years.some(y=>typeof y!=="string"||!y.trim())||
  series.some(x=>!Array.isArray(x)||x.length!==years.length||x.some(v=>!num(v)));
 add("financial_periods",malformed?"blocked":years.length?"pass":"attention",
  malformed?"Core revenue/net-income arrays are malformed, duplicated or period-misaligned.":
   years.length?"Basic financial series are period-aligned; extraction correctness is not independently audited.":
   "No financial statement periods in this filing analysis.");
 const errors=(data.financials.validationFlags??[]).filter(x=>x.severity==="error");
 const warnings=(data.financials.validationFlags??[]).filter(x=>x.severity==="warning");
 const identity=data.financials.validation?.balanceSheetIdentity;
 add("financial_reconciliation",identity==="mismatch"||errors.length?"blocked":
  identity==="reconciled"&&!warnings.length?"pass":"attention",
  identity==="mismatch"?"Balance-sheet identity mismatch: figures require manual review.":
   errors.length?"Financial validation returned blocking errors.":
   identity==="reconciled"&&!warnings.length?"Reported balance-sheet arithmetic reconciles; it is not source authentication.":
   "Balance-sheet proof is absent or nonblocking financial warnings exist.");
 const modules=Object.entries(data.diagnostics??{});
 const degraded=modules.filter(([,v])=>v && (v.status==="failed"||v.status==="incomplete"));
 add("module_diagnostics",degraded.length?"attention":modules.length?"pass":"attention",
  degraded.length?`${degraded.length} modules are failed/incomplete; only available analysis may be used.`:
   modules.length?"Available module diagnostics have no failed/incomplete state.":
   "Module execution diagnostics are missing.");
 add("evidence_inventory",dossier.coverage.filingExcerpts>0?"pass":"attention",
  dossier.coverage.filingExcerpts>0?
   `${dossier.coverage.filingExcerpts} source-quoted filing excerpts present; link counts are not an independent audit.`:
   "No exact filing excerpts; linked secondary sources alone do not establish issuer figures.");
 add("analyst_review",dossier.status==="analyst_review_recorded"?"pass":"attention",
  dossier.status==="analyst_review_recorded"?
   "User declared review of financials, sources, risks and valuation; not an audit certification.":
   "An analyst-reviewed thesis and counter-case with explicit review declarations are not complete.");
 const dcf=data.valuation?.dcf;
 add("valuation",dcf?
  (dcf.status==="complete"&&num(dcf.figures.implied_per_share.value)?"pass":"attention"):
  "not_applicable",dcf?
   "Valuation computed from user-approved assumptions; source and current price truth remain unverified.":
   "No approved DCF was supplied; no target price or margin of safety is inferred.");
 add("prior_filing_comparison",!delta?"not_applicable":delta.status==="ready"?
  (delta.changes.some(x=>x.status==="missing_source")||delta.exclusions.length?"attention":"pass"):"attention",
  !delta?"No prior filing was compared.":
   delta.status!=="ready"?"Prior-file comparison failed an identity, chronology or input gate.":
   "Cross-filing differences are review candidates and never authenticated restatements.");
 const blocked=checks.filter(x=>x.status==="blocked").length;
 const attention=checks.filter(x=>x.status==="attention").length;
 return {
  schema:"filinglens.analysis_assurance.v1",
  reviewReadiness:blocked?"blocked":attention?"attention":"reviewable",
  officialRegulatoryAcceptance:"not_demonstrated",
  checks,issues:{blocked,attention},
  notices:[
   "Review readiness evaluates internal analytical consistency, not investment suitability or regulator data authenticity.",
   "Operator-attested SEC imports or a SEC CompanyFacts verification label do not close the separate production numerical acceptance gate.",
   "This report cannot certify the issuer, an SEC accession, a market quote, a valuation conclusion or an official filing restatement.",
  ],
 };
}
/** The payload can be independently re-calculated by the offline audit verifier. */
export function buildAuditPayload(data:FilingAnalysis,review:AnalystReview,
 delta:FilingDelta|null,createdAt:string):AuditPayload {
 if(!checksumDate(createdAt))throw new Error("invalid_audit_timestamp");
 const dossier=buildDecisionDossier(data,review,delta);
 const assurance=assessAnalysisQuality(data,dossier,delta);
 return {schema:"filinglens.audit_bundle.v1",createdAt,analysis:data,delta,dossier,assurance};
}
