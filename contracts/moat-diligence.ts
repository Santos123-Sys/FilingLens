import type {MarketResult,EvidenceReference} from "./analysis";
import {evidenceUrl} from "./peer-evidence-audit";
type Competitive=NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
export type MoatDiligence={
 peer:string;rating:string;reportedConfidence:string;
 supporting:Array<{dimension:string;claim:string;source:EvidenceReference}>;
 challenges:Array<{dimension:string;claim:string;source:EvidenceReference}>;
 reviewFlags:string[];
 evidenceBalance:"two_sided"|"one_sided"|"missing";
};
const canon=(ref:EvidenceReference)=>{const u=evidenceUrl(ref);if(!u)return "";try{const x=new URL(u);return x.hostname.toLowerCase()+x.pathname.replace(/\/$/,"");}catch{return ""}};
/** Research-source balance audit, not an objective moat strength score. */
export function auditMoatDurability(analysis:Competitive|undefined):MoatDiligence[]{
 if(!analysis)return [];
 return analysis.peerProfiles.map(peer=>{
  const moat=peer.moatAssessment;
  const supporting=(moat?.evidence??[]).filter(x=>evidenceUrl(x.source)).map(x=>({
   dimension:x.dimension,claim:x.assessment,source:x.source}));
  const challenges=(moat?.counterEvidence??[]).filter(x=>evidenceUrl(x.source)).map(x=>({
   dimension:x.dimension,claim:x.challenge,source:x.source}));
  const reviewFlags:string[]=[];
  if(!supporting.length)reviewFlags.push("Moat assessment has no cited supporting evidence");
  if(!challenges.length)reviewFlags.push("No contrary evidence documented; durability is not established");
  const claimed=new Set(supporting.map(x=>x.dimension.toLowerCase().trim()));
  for(const x of challenges){
   if(!claimed.has(x.dimension.toLowerCase().trim()))
    reviewFlags.push(`Counter-evidence dimension '${x.dimension}' does not match a supported moat mechanism`);
  }
  if(challenges.some(x=>supporting.some(y=>canon(x.source)===canon(y.source))))
   reviewFlags.push("Support and challenge cite the same source; independent corroboration unavailable");
  if(moat?.rating==="strong" && (!challenges.length || supporting.length<2))
   reviewFlags.push("Strong moat rating lacks two-sided source coverage");
  const evidenceBalance=!supporting.length?"missing":challenges.length?"two_sided":"one_sided";
  return {peer:peer.name,rating:moat?.rating??"unclear",
   reportedConfidence:moat?.confidence??"low",supporting,challenges,reviewFlags,evidenceBalance};
 });
}
