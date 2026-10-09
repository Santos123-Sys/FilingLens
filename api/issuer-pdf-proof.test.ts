import {describe,expect,it} from "vitest";
import type {MarketResult} from "../contracts/analysis";
import {corroborateIssuerPublishedPeers} from "./issuer-pdf-proof";
import {crosscheckCompetitiveFacts} from "./peer-sec-crosscheck";
import {APPLE_2025_DISCLOSURE} from "../contracts/issuer-statement-proof";
const doc={url:APPLE_2025_DISCLOSURE.url,sha256:"b".repeat(64),
 retrievedAt:"2026-10-09T09:00:00.000Z",
 text:(`Apple Inc.
CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)
(In millions)
Three Months Ended Twelve Months Ended
September 27, 2025 September 28, 2024 September 27, 2025 September 28, 2024
Total net sales (1) 102,466 94,930 416,161 391,035
Operating income 32,427 29,591 133,050 123,216
Net income 27,466 14,736 112,010 93,736
`).repeat(13)};
const url="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm";
const peer=(amount="416161",proof?:string):NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number]=>({
 name:"Apple Inc.",relationship:"direct",positioning:"",strengths:[],vulnerabilities:[],
 source:{kind:"citation",section:"Filing",url},
 dataPoints:[{label:"Revenue",value:`USD ${amount} millions`,period:"FY2025",
  context:"consolidated US GAAP; period end 2025-09-27",
  source:{kind:"citation",section:"Filing",url},
  ...(proof?{primaryVerification:{status:proof as "amount_mismatch",provider:"sec_companyfacts" as const}}:{})}]
});
describe("issuer published PDF peer integration",()=>{
 it("recovers numeric corroboration with no direct SEC request",async()=>{
  let read=0;
  const [out]=await corroborateIssuerPublishedPeers([peer()],{retrieve:async()=>{read++;return doc;}});
  expect(read).toBe(1);
  expect(out.dataPoints?.[0].issuerVerification).toMatchObject({
   status:"verified",sourceMode:"issuer_published_unaudited_pdf"});
  expect(out.dataPoints?.[0].primaryVerification).toBeUndefined();
 });
 it("keeps wrong figures blocked and never overrides SEC contradictions",async()=>{
  const [bad]=await corroborateIssuerPublishedPeers([peer("300")],{retrieve:async()=>doc});
  expect(bad.dataPoints?.[0].issuerVerification?.status).toBe("amount_mismatch");
  const [conflict]=await corroborateIssuerPublishedPeers([peer("416161","amount_mismatch")],
   {retrieve:async()=>doc});
  expect(conflict.dataPoints?.[0].issuerVerification).toBeUndefined();
 });
 it("crosscheck retains separate SEC unavailable versus issuer verification",async()=>{
  const research={peerEvidence:[],competitiveAnalysis:{
   status:"partial",methodology:"market-research-brief",
   peerProfiles:[peer()],findings:[],
  }} as unknown as Parameters<typeof crosscheckCompetitiveFacts>[0];
  const out=await crosscheckCompetitiveFacts(research,{userAgent:"",
   retrieveIssuer:async()=>doc,readBulk:async()=>null});
  const record=out.competitiveAnalysis.peerProfiles[0].dataPoints?.[0];
  expect(record?.primaryVerification?.status).toBe("unavailable");
  expect(record?.issuerVerification?.status).toBe("verified");
 });
});
