import {describe,it,expect} from "vitest";
import {auditMoatDurability} from "./moat-diligence";
import type {MarketResult} from "./analysis";
const source=(host:string)=>({section:"Competition note",kind:"citation" as const,url:`https://${host}/materials`});
const make=(counter=false)=>({peerProfiles:[{
 name:"Peer A",moatAssessment:{rating:"strong",confidence:"high",
 evidence:[{dimension:"Switching costs",assessment:"Long customer contracts",source:source("company.example")}],
 ...(counter?{counterEvidence:[{dimension:"Switching costs",challenge:"Customer renewal declined",source:source("industry.example")}]}:{})
 }}]} as unknown as NonNullable<MarketResult["market"]["competitiveAnalysis"]>);
describe("moat source coverage",()=>{
 it("does not interpret missing counter evidence as no threat",()=>{
  const result=auditMoatDurability(make());
  expect(result[0].evidenceBalance).toBe("one_sided");
  expect(result[0].reviewFlags).toContain("No contrary evidence documented; durability is not established");
 });
 it("links disconfirming facts against the same mechanism",()=>{
  const result=auditMoatDurability(make(true));
  expect(result[0].evidenceBalance).toBe("two_sided");
  expect(result[0].challenges).toHaveLength(1);
 });
 it("rejects uncited counterclaims as evidence",()=>{
  const a=make(true);const item=a.peerProfiles[0].moatAssessment.counterEvidence![0];
  item.source.url="http://invalid.example";
  expect(auditMoatDurability(a).at(0)?.challenges).toHaveLength(0);
 });
});
