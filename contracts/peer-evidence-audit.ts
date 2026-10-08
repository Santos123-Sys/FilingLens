import type { MarketResult, EvidenceReference } from "./analysis";
type Competitive = NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
export type PeerEvidenceAudit={
 name:string;
 numericDataPoints:number;
 moatEvidencePoints:number;
 hasOutlookEvidence:boolean;
 linkedSources:number;
 uniqueSourceHosts:number;
 gaps:string[];
};
export function evidenceUrl(source:EvidenceReference|null|undefined):string|null{
 if(!source?.url || source.kind==="excerpt")return null;
 try{const value=new URL(source.url);return value.protocol==="https:"?value.href:null;}catch{return null;}
}
export function auditPeerEvidence(analysis:Competitive|undefined):PeerEvidenceAudit[]{
 if(!analysis)return [];
 return analysis.peerProfiles.map(peer=>{
  const numeric=(peer.dataPoints??[]).filter(p=>evidenceUrl(p.source));
  const moat=(peer.moatAssessment?.evidence??[]).filter(x=>evidenceUrl(x.source));
  const outlook=Boolean(peer.outlook&&evidenceUrl(peer.outlook.source));
  const sources=[evidenceUrl(peer.source),...numeric.map(p=>evidenceUrl(p.source)),
   ...moat.map(m=>evidenceUrl(m.source)),...(outlook?[evidenceUrl(peer.outlook!.source)]:[])].filter((u):u is string=>Boolean(u));
  const hosts=new Set(sources.map(url=>new URL(url).hostname.toLowerCase().replace(/^www\./,"")));
  const gaps:string[]=[];
  if(!numeric.length)gaps.push("No independently cited numerical peer data");
  if(!moat.length)gaps.push("Moat claims lack independently linked evidence");
  if(!outlook)gaps.push("No cited forward outlook");
  if(hosts.size<2)gaps.push("Evidence limited to fewer than two source hosts");
  return {name:peer.name,numericDataPoints:numeric.length,moatEvidencePoints:moat.length,
   hasOutlookEvidence:outlook,linkedSources:sources.length,uniqueSourceHosts:hosts.size,gaps};
 });
}
