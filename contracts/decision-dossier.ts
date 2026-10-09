import type { EvidenceReference, FilingAnalysis } from "./analysis";
import type { FilingDelta } from "./filing-change-intelligence";
import { buildDecisionMateriality } from "./decision-materiality";

export type AnalystReview = {
 thesis: string;
 counterCase: string;
 catalysts: string;
 reviewerNotes: string;
 checks: { financials: boolean; sources: boolean; risks: boolean; valuation: boolean };
};
export const emptyAnalystReview = (): AnalystReview => ({
 thesis: "", counterCase: "", catalysts: "", reviewerNotes: "",
 checks: { financials: false, sources: false, risks: false, valuation: false },
});
export type SourceEntry = {
 id: string;
 category: "financial" | "risk" | "guidance" | "competitor" | "confidence";
 section: string;
 origin: "filing_excerpt" | "external_citation";
 reference: EvidenceReference;
};
export type DecisionDossier = {
 schema: "filinglens.decision_dossier.v1";
 status: "draft" | "analyst_review_recorded";
 issuer: { name: string; jurisdiction: "us" | "br"; registryId: string | null; fiscalPeriod: string; filingDate: string | null };
 analyst: AnalystReview;
 evidence: SourceEntry[];
 coverage: { filingExcerpts: number; externalCitations: number; total: number; omitted: number };
 valuation: { dcfPerShare: number | null; compsPerShare: number | null; unit: string | null; reconciliation: string };
 research: { pendingItems: number; flaggedDiscrepancies: number; missingData: number };
 notices: string[];
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function cleanAnalystReview(value: AnalystReview): AnalystReview {
 const bound = (s: string, limit: number) => {
  if (typeof s !== "string" || s.length > limit) throw new Error("invalid_analyst_review_length");
  return s.trim();
 };
 if (!value?.checks || ["financials","sources","risks","valuation"].some(k =>
  typeof value.checks[k as keyof AnalystReview["checks"]] !== "boolean"))
  throw new Error("invalid_analyst_review_checklist");
 return {thesis:bound(value.thesis,3000),counterCase:bound(value.counterCase,3000),
  catalysts:bound(value.catalysts,2000),reviewerNotes:bound(value.reviewerNotes,2000),
  checks:{...value.checks}};
}
const validHttps = (input: string | undefined): boolean => {
 if (!input) return false;
 try {const u=new URL(input); return u.protocol==="https:" && !!u.hostname &&
  !u.username && !u.password;}catch{return false;}
};
function usableSource(source: EvidenceReference | null | undefined): SourceEntry["origin"] | null {
 if (!source || !source.section?.trim()) return null;
 if (source.kind === "excerpt" && source.quote?.trim()) return "filing_excerpt";
 if (source.kind === "citation" && validHttps(source.url)) return "external_citation";
 return null;
}
/**
 * Build a REVIEWABLE source inventory from existing analysis only.
 * Do not promote citations into regulator verification, or model-generated
 * competitor/moat text into primary filing disclosure.
 */
export function buildDecisionDossier(data: FilingAnalysis, input: AnalystReview,
 delta?: FilingDelta | null): DecisionDossier {
 const analyst=cleanAnalystReview(input);
 const register:SourceEntry[]=[];
 const seen=new Set<string>();
 let omitted=0;
 const collect=(category:SourceEntry["category"],ref:EvidenceReference|null|undefined)=>{
  const origin=usableSource(ref);
  if (!origin || !ref){omitted++;return;}
  const key=JSON.stringify([category,origin,ref.section,ref.page??"",ref.item??"",
   ref.url??"",ref.quote??""]);
  if(seen.has(key))return;
  seen.add(key);
  if(register.length>=100){omitted++;return;}
  register.push({id:`source-${register.length+1}`,category,section:ref.section.trim(),
   origin,reference:{...ref}});
 };
 for(const row of data.financials.evidence??[])collect("financial",row.source);
 for(const row of data.risks)collect("risk",row.source);
 for(const row of data.financials.forwardGuidance??[])collect("guidance",row.source);
 for(const row of data.market.peerEvidence??[])collect("competitor",row.source);
 for(const row of data.market.competitiveAnalysis?.peerProfiles??[]){
  collect("competitor",row.source);
  for(const dp of row.dataPoints??[])collect("competitor",dp.source);
  for(const support of row.moatAssessment?.evidence??[])collect("competitor",support.source);
  for(const challenge of row.moatAssessment?.counterEvidence??[])collect("competitor",challenge.source);
  if(row.outlook)collect("competitor",row.outlook.source);
 }
 for(const row of data.confidenceNotes??[])collect("confidence",row.source);
 const readiness=Object.values(analyst.checks).every(Boolean) &&
  !!analyst.thesis && !!analyst.counterCase && !!analyst.catalysts;
 const triage=buildDecisionMateriality(data,delta);
 const dcf=data.valuation?.dcf?.figures.implied_per_share;
 const comps=data.valuation?.comps?.figures.implied_per_share;
 const notices=[
  "Analyst-entered narrative is not a model-verified fact or an investment recommendation.",
  "Checked boxes record human review declarations; they do not authenticate financial statements or market prices.",
  "Source-linked evidence is not independently authenticated unless separately checked against the original regulator record.",
  "Official SEC CompanyFacts numerical production acceptance must be verified separately; this dossier is not that proof.",
 ];
 if(omitted)notices.push(`${omitted} invalid or excess evidence references omitted from the bounded inventory.`);
 if(delta?.status==="ready" && delta.changes.length)
  notices.push("Cross-filing numeric differences are review candidates, not confirmed restatements.");
 if(!data.valuation?.dcf)notices.push("No completed DCF; valuation per share is unavailable.");
 if(!register.length)notices.push("No usable source references in this analysis; research coverage remains incomplete.");
 return {
  schema:"filinglens.decision_dossier.v1",
  status:readiness?"analyst_review_recorded":"draft",
  issuer:{name:data.company.name,jurisdiction:data.jurisdiction,
   registryId:(data.jurisdiction==="us"?data.metadata.cik:data.metadata.cnpj)??null,
   fiscalPeriod:data.company.periodEnd,filingDate:data.company.filedAt},
  analyst,evidence:register,
  coverage:{filingExcerpts:register.filter(x=>x.origin==="filing_excerpt").length,
   externalCitations:register.filter(x=>x.origin==="external_citation").length,
   total:register.length,omitted},
  valuation:{dcfPerShare:finite(dcf?.value)?dcf.value:null,
   compsPerShare:finite(comps?.value)?comps.value:null,
   unit:dcf?.unit??comps?.unit??null,
   reconciliation:data.valuation?.reconciliation?.status??"unavailable"},
  research:{pendingItems:triage.reviewQueue.length,
   flaggedDiscrepancies:delta?.status==="ready"?delta.changes.length:0,
   missingData:data.missingData.length},
  notices,
 };
}
