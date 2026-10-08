import {describe,it,expect} from "vitest";
import type {MarketResult} from "../contracts/analysis";
import {crosscheckCompetitiveFacts} from "./peer-sec-crosscheck";
const citation="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/annual.htm";
const research=()=>{
 const competitiveAnalysis={status:"partial",methodology:"market-research-brief",
  peerProfiles:[{name:"Apple Inc.",relationship:"direct",positioning:"",strengths:[],vulnerabilities:[],
   dataPoints:[{label:"Revenue",value:"USD 300 millions",period:"FY2025",
    context:"consolidated US GAAP; period end 2025-12-31",
    source:{section:"FY Statement",kind:"citation",url:citation}}],
   source:{section:"FY",url:citation}}],findings:[]
 } as unknown as NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
 return {competitiveAnalysis,peerEvidence:[] as NonNullable<MarketResult["market"]["peerEvidence"]>};
};
const facts={cik:320193,entityName:"APPLE INC.",facts:{"us-gaap":{
 RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{
  accn:"0000320193-25-000079",form:"10-K",fp:"FY",fy:2025,
  start:"2025-01-01",end:"2025-12-31",val:300000000
 }]}}
}}};
describe("official financial enrichment",()=>{
 it("uses a fixed SEC path based on the filing CIK and annotates exact matches",async()=>{
  let called="";
  const r=await crosscheckCompetitiveFacts(research(),{userAgent:"FilingLens research contact@example.com",
   retrieve:async (url)=>{called=url;return facts;}});
  expect(called).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json");
  expect(r.competitiveAnalysis.peerProfiles[0].dataPoints?.[0].primaryVerification?.status).toBe("verified");
  expect(r.competitiveAnalysis.peerProfiles[0].officialHistory).toHaveLength(1);
 });
 it("stays unverified when the SEC user agent is not configured",async()=>{
  const r=await crosscheckCompetitiveFacts(research(),{userAgent:""});
  expect(r.competitiveAnalysis.peerProfiles[0].dataPoints?.[0].primaryVerification?.status).toBe("unavailable");
 });
 it("does not trust data from an unrelated SEC entity",async()=>{
  const r=await crosscheckCompetitiveFacts(research(),{userAgent:"FilingLens research contact@example.com",
   retrieve:async()=>({...facts,cik:10})});
  expect(r.competitiveAnalysis.peerProfiles[0].dataPoints?.[0].primaryVerification?.status).toBe("identity_mismatch");
  expect(r.competitiveAnalysis.peerProfiles[0].officialHistory).toBeUndefined();
 });
});
