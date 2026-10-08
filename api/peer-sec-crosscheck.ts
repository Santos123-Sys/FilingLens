import type { MarketResult } from "../contracts/analysis";
import { corroborateSecPeerPoint, secFilingIdentity, secProofUrl } from "../contracts/sec-peer-proof";
import type { SecCompanyFacts } from "../contracts/sec-peer-proof";
import { collectSecHistoricalFacts } from "../contracts/sec-peer-history";
import {cachedSecCompanyFacts} from "./sec-bulk-cache";

type Profiles=NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
type Research={peerEvidence:NonNullable<MarketResult["market"]["peerEvidence"]>;competitiveAnalysis:Profiles};
const MAX_CIK=3;
let secRestrictedUntil=0;
/**
 * Official SEC HTTP calls use a fixed host and a numeric CIK derived from an
 * SEC filing URL, never a generated/arbitrary model URL. Runs only on server.
 */
export async function crosscheckCompetitiveFacts(
  research:Research,
  options:{
    userAgent?:string;
    retrieve?: (url:string,agent:string)=>Promise<SecCompanyFacts|null>;
    readBulk?: (cik:string)=>Promise<{facts:SecCompanyFacts;retrievedDay:string}|null>;
  }={}
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
   if(response.status===403||response.status===429){
    secRestrictedUntil=Date.now()+60*60*1000;
    console.warn("[peer-sec-proof] SEC access restricted; pause further API calls, use official bulk cache if available");
    return null;
   }
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
 if(agent.length>=12&&Date.now()>=secRestrictedUntil){
  await Promise.all(uniqueCiks.map(async cik=>{
   try{results.set(cik,await fetcher(secProofUrl(cik),agent));}
   catch{results.set(cik,null);}
  }));
 }
 const sourceModes=new Map<string,"sec_api"|"operator_attested_sec_bulk">();
 for(const [cik,facts] of results)if(facts)sourceModes.set(cik,"sec_api");
 // SEC fair-access restrictions may block cloud egress (HTTP 403). Do not
 // rotate egress IPs, proxy, scrape alternate SEC hosts or retry forbidden calls.
 // A separately imported *official ZIP member* is checked using the same
 // exact accession/identity/numeric validator as live SEC API data.
 const bulk=options.readBulk??cachedSecCompanyFacts;
 await Promise.all(uniqueCiks.filter(cik=>!results.get(cik)).map(async cik=>{
  try{
   const saved=await bulk(cik);
   if(saved){
    results.set(cik,saved.facts);
    sourceModes.set(cik,"operator_attested_sec_bulk");
   }
  }catch{ /* fail closed */ }
 }));
 const peers=research.competitiveAnalysis.peerProfiles.map(peer=>{
  const dataPoints=(peer.dataPoints??[]).map(item=>{
   const id=secFilingIdentity(item.source);
   const proof=corroborateSecPeerPoint(peer.name,item,id?(results.get(id.cik)??null):null);
   return {...item,primaryVerification:{...proof,
    ...(proof.status==="verified"&&id&&sourceModes.get(id.cik)?
      {sourceMode:sourceModes.get(id.cik)}:{})}};
  });
  const verifiedCiks=[...new Set(dataPoints.filter(x=>x.primaryVerification.status==="verified")
   .map(x=>x.primaryVerification.cik).filter((x):x is string=>Boolean(x)))];
  const history=verifiedCiks.length===1
   ?collectSecHistoricalFacts(peer.name,verifiedCiks[0],results.get(verifiedCiks[0])??null)
   :[];
  return {...peer,...(peer.dataPoints?{dataPoints}:{}),...(history.length?{officialHistory:history}:{})};
 });
 const validated=peers.reduce((sum,peer)=>sum+(peer.dataPoints??[])
  .filter(x=>x.primaryVerification?.status==="verified").length,0);
 console.info(`[peer-sec-proof] candidate_peers=${peers.length} matched_xbrl_points=${validated} lookups=${results.size} peer_history=${peers.reduce((n,p)=>n+(p.officialHistory?.length??0),0)}`);
 return {...research,competitiveAnalysis:{...research.competitiveAnalysis,peerProfiles:peers}};
}
