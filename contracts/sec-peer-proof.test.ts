import {describe,expect,it} from "vitest";
import type { MarketResult } from "./analysis";
import {corroborateSecPeerPoint,secFilingIdentity,secProofUrl} from "./sec-peer-proof";
import type { SecCompanyFacts } from "./sec-peer-proof";
type Profile=NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number];
type Point=NonNullable<Profile["dataPoints"]>[number];
const url="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20251231.htm";
const point=(urlValue=url):Point=>({label:"Revenue",value:"USD 300 millions",period:"FY2025",
 context:"consolidated US GAAP; period end 2025-12-31",
 source:{section:"Statements of operations",kind:"citation",url:urlValue}});
const record={accn:"0000320193-25-000079",form:"10-K",fp:"FY",fy:2025,
 start:"2025-01-01",end:"2025-12-31",val:300000000};
const data=(rows=[record],name="APPLE INC.",cik=320193):SecCompanyFacts=>({
 cik,entityName:name,facts:{"us-gaap":{
  RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:rows}},
 }}
});
describe("SEC primary issuer and XBRL proof",()=>{
 it("accepts only exact SEC EDGAR CIK and accession paths",()=>{
  expect(secFilingIdentity(point().source)).toEqual({cik:"0000320193",accession:"000032019325000079"});
  expect(secFilingIdentity(point("https://sec.gov.attacker.tld/Archives/edgar/data/320193/000032019325000079/x").source)).toBeNull();
  expect(secFilingIdentity(point("http://www.sec.gov/Archives/edgar/data/320193/000032019325000079/x").source)).toBeNull();
  expect(secFilingIdentity(point("https://www.sec.gov/Archives/edgar/data/320193/other/x").source)).toBeNull();
  expect(secProofUrl("0000320193")).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json");
 });
 it("confirms exact issuer name, CIK, citation accession, duration, amount and FY end",()=>{
  const result=corroborateSecPeerPoint("Apple Inc.",point(),data());
  expect(result.status).toBe("verified");
  expect(result.cik).toBe("0000320193");
  expect(result.proofUrl).toContain("companyfacts/CIK0000320193.json");
 });
 it("refuses mismatched CIK or issuer legal name",()=>{
  expect(corroborateSecPeerPoint("Apple Inc.",point(),data([record],"APPLE INC.",10)).status).toBe("identity_mismatch");
  expect(corroborateSecPeerPoint("Unrelated Co.",point(),data()).status).toBe("identity_mismatch");
 });
 it("refuses exact citation accession mismatches even if reported amount matches",()=>{
  const changed={...record,accn:"0000320193-24-000079"};
  expect(corroborateSecPeerPoint("Apple Inc.",point(),data([changed])).status).toBe("source_mismatch");
 });
 it("refuses a number the SEC does not corroborate",()=>{
  expect(corroborateSecPeerPoint("Apple Inc.",point(),data([{...record,val:250000000}])).status).toBe("amount_mismatch");
 });
 it("rejects quarterly periods or nonannual durations",()=>{
  const interim={...record,start:"2025-10-01"};
  expect(corroborateSecPeerPoint("Apple Inc.",point(),data([interim])).status).toBe("source_mismatch");
  expect(corroborateSecPeerPoint("Apple Inc.",{...point(),period:"Q4 2025"},data()).status).toBe("source_mismatch");
 });
 it("refuses ambiguous official taxonomy values in the same accession",()=>{
  const d=data();
  d.facts!["us-gaap"].Revenues={units:{USD:[{...record,val:240000000}]}};
  expect(corroborateSecPeerPoint("Apple Inc.",point(),d).status).toBe("source_mismatch");
 });
 it("preserves unknown status when SEC retrieval is unavailable",()=>{
  expect(corroborateSecPeerPoint("Apple Inc.",point(),null).status).toBe("unavailable");
  expect(corroborateSecPeerPoint("Apple Inc.",point("https://investor.example.com/annual"),data()).status).toBe("not_in_sec");
 });
});
