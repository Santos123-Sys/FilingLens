import type { MarketResult } from "../contracts/analysis";
import { corroborateSecPeerPoint, secFilingIdentity, secProofUrl } from "../contracts/sec-peer-proof";
import type { SecCompanyFacts } from "../contracts/sec-peer-proof";

type Profiles=NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
type Research={peerEvidence:NonNullable<MarketResult["market"]["peerEvidence"]>;competitiveAnalysis:Profiles};
const MAX_CIK=3;
/**
 * Official SEC HTTP calls use a fixed host and a numeric CIK derived from an
 * SEC filing URL, never a generated/arbitrary model URL. Runs only on server.
 */
export async function crosscheckCompetitiveFacts(
  research:Research,
  options:{userAgent?:string;retrieve?: (url:string,agent:string)=>Promise<SecCompanyFacts|null>}={}
):Promise<Research>{
 const agent=(options.userAgent??process.env.SEC_USER_AGENT??"").trim();
 const uniqueCiks=[...new Set(research.competitiveAnalysis.peerProfiles.flatMap(peer=>
   (peer.dataPoints??[]).flatMap(item=>{
    const identity=secFilingIdentity(item.source);return identity?[identity.cik]:[];
   })))].slice(0,MAX_CIK);
 async function retrieve(url:string,ua:string):Promise<SecCompanyFacts|null>{
  try{
   const response=await fetch(url,{headers:{"User-Agent":ua,"Accept":"application/json"},
    redirect:"error",signal:AbortSignal.timeout(7_000)});
   if(!response.ok)return null;
   const length=Number(response.headers.get("content-length")??0);
   if(length>12_000_000)return null;
   const body=await response.text();
   if(body.length>12_000_000)return null;
   return JSON.parse(body) as SecCompanyFacts;
  }catch{return null;}
 }
 const fetcher=options.retrieve??retrieve;
 const results=new Map<string,SecCompanyFacts|null>();
 if(agent.length>=12){
  await Promise.all(uniqueCiks.map(async cik=>{
   try{results.set(cik,await fetcher(secProofUrl(cik),agent));}
   catch{results.set(cik,null);}
  }));
 }
 const peers=research.competitiveAnalysis.peerProfiles.map(peer=>({
  ...peer,
  ...(peer.dataPoints ? {dataPoints:peer.dataPoints.map(item=>{
   const id=secFilingIdentity(item.source);
   const proof=corroborateSecPeerPoint(peer.name,item,id?(results.get(id.cik)??null):null);
   return {...item,primaryVerification:proof};
  })}:{}),
 }));
 const validated=peers.reduce((sum,peer)=>sum+(peer.dataPoints??[])
  .filter(x=>x.primaryVerification?.status==="verified").length,0);
 console.info(`[peer-sec-proof] candidate_peers=${peers.length} matched_xbrl_points=${validated} lookups=${results.size}`);
 return {...research,competitiveAnalysis:{...research.competitiveAnalysis,peerProfiles:peers}};
}
