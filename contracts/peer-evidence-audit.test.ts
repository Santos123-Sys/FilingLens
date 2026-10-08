import {describe,expect,it} from "vitest";
import type {MarketResult} from "./analysis";
import {auditPeerEvidence,evidenceUrl} from "./peer-evidence-audit";
const citation=(url:string)=>({section:"Investor relations",kind:"citation" as const,url});
describe("competitive evidence audit",()=>{
 it("refuses unsafe or uncited source URLs",()=>{
  expect(evidenceUrl(citation("http://example.org"))).toBeNull();
  expect(evidenceUrl({...citation("https://example.org"),kind:"excerpt"})).toBeNull();
 });
 it("marks missing numerical, moat and outlook support without inventing a score",()=>{
  const data={
   peerProfiles:[{name:"Peer A",source:citation("https://example.org/peers")}]
  } as unknown as NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
  const a=auditPeerEvidence(data);
  expect(a[0].numericDataPoints).toBe(0);
  expect(a[0].secCorroboratedPoints).toBe(0);
  expect(a[0].moatEvidencePoints).toBe(0);
  expect(a[0].hasOutlookEvidence).toBe(false);
  expect(a[0].gaps).toHaveLength(4);
 });
 it("counts distinct source hosts, not duplicate citations as independent publications",()=>{
  const data={
   peerProfiles:[{
    name:"B",
    source:citation("https://a.example/a"),
    dataPoints:[{label:"Sales",value:"10",period:"FY2025",context:"",
     source:citation("https://a.example/b"),
     primaryVerification:{status:"verified",provider:"sec_companyfacts"}}],
    moatAssessment:{evidence:[{dimension:"Switching costs",assessment:"Limited",
     source:citation("https://b.example/c")}]},
    outlook:{source:citation("https://b.example/c")}
   }]
  } as unknown as NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
  const a=auditPeerEvidence(data);
  expect(a[0].uniqueSourceHosts).toBe(2);
  expect(a[0].numericDataPoints).toBe(1);
  expect(a[0].secCorroboratedPoints).toBe(1);
  expect(a[0].gaps).toEqual([]);
 });
 it("keeps a cited but unverified peer figure out of confirmed SEC evidence",()=>{
  const item={
   peerProfiles:[{
    name:"Unverified",source:citation("https://a.example/info"),
    dataPoints:[{
     label:"Revenue",value:"USD 100 millions",period:"FY2025",
     context:"consolidated US GAAP; period end 2025-12-31",
     source:citation("https://a.example/report"),
     primaryVerification:{status:"unavailable",provider:"sec_companyfacts"},
    }],
   }],
  } as unknown as NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
  const audit=auditPeerEvidence(item);
  expect(audit[0].numericDataPoints).toBe(1);
  expect(audit[0].secCorroboratedPoints).toBe(0);
  expect(audit[0].gaps.some(g=>g.includes("primary SEC"))).toBe(true);
 });
});
