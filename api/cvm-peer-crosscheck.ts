import type {MarketResult} from "../contracts/analysis";
import type {RegulatoryDataSnapshot} from "../contracts/regulatory-data";
import {verifiedCvmDfpPeerFacts} from "../contracts/cvm-peer-proof";
import {dataToolsConfigured,dataToolsJson} from "./data-tools-client";

type Research={
 peerEvidence:NonNullable<MarketResult["market"]["peerEvidence"]>;
 competitiveAnalysis:NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
};
const cnpjValid=(raw:string)=>{
 const s=raw.replace(/\D/g,"");
 if(!/^\d{14}$/.test(s)||/^(\d)\1{13}$/.test(s))return false;
 const digit=(length:number,weights:number[])=>{
  const sum=weights.reduce((total,n,i)=>total+Number(s[i])*n,0);
  return sum%11<2?0:11-sum%11;
 };
 return digit(12,[5,4,3,2,9,8,7,6,5,4,3,2])===Number(s[12]) &&
  digit(13,[6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(s[13]);
};
/**
 * The CVM data tools provide primary DFP financial observations. CNPJ,
 * regulator resolved identity, legal name and source URI all must match.
 * Model-declared CNPJs are candidates, never trusted at face value.
 */
export async function crosscheckCvmPeers(
 research:Research,
 retrieve?: (cnpj:string,companyName:string)=>Promise<RegulatoryDataSnapshot>
):Promise<Research>{
 if(!retrieve && !dataToolsConfigured())return research;
 const fetcher=retrieve??((cnpj:string,companyName:string)=>dataToolsJson<RegulatoryDataSnapshot>(
  "/v1/regulatory/enrich",{jurisdiction:"br",cnpj,companyName,filingType:"DFP",historyYears:5}));
 const peers=research.competitiveAnalysis.peerProfiles.slice(0,3);
 const results=await Promise.all(peers.map(async peer=>{
  const cnpj=peer.candidateCnpj?.replace(/\D/g,"")??"";
  if(!cnpjValid(cnpj))return {name:peer.name,history:[]};
  try{
   const source=await fetcher(cnpj,peer.name);
   const history=verifiedCvmDfpPeerFacts(peer.name,cnpj,source);
   return {name:peer.name,history};
  }catch{return {name:peer.name,history:[]};}
 }));
 const byName=new Map(results.map(x=>[x.name,x.history]));
 const updated=research.competitiveAnalysis.peerProfiles.map(peer=>{
  const history=byName.get(peer.name)??[];
  // Candidate identities are not exposed as verified facts.
  const {candidateCnpj:_unverified,...safe}=peer;
  return {...safe,...(history.length?{officialHistory:history}:{})};
 });
 console.info("[peer-cvm-dfp] peers_checked="+results.length+" verified_rows="+
  results.reduce((n,r)=>n+r.history.length,0));
 return {...research,competitiveAnalysis:{...research.competitiveAnalysis,peerProfiles:updated}};
}
