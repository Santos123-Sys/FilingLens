import {describe,expect,it} from "vitest";
import { officialSource,preparePublicSnapshot } from "./regulatory-snapshot-store";
import type { RegulatoryDataSnapshot } from "../contracts/regulatory-data";
const snapshot:RegulatoryDataSnapshot={
 status:"complete",jurisdiction:"us",provider:"sec_edgar",company:{},sources:[],warnings:[],raw:{},
 resolvedIdentifier:"0000320193",
 metrics:[
  {key:"revenue",value:1200000,unit:"USD",period:"2025-09-27",fiscalYear:2025,statementType:"annual",
   status:"verified",source:{provider:"sec_edgar",sourceType:"SEC Companyfacts",url:"https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",retrievedAt:"2026-10-08"}},
  {key:"netIncome",value:15,unit:"USD",period:"2025-09-27",fiscalYear:2025,statementType:"interim",
   status:"verified",source:{provider:"sec_edgar",sourceType:"SEC Companyfacts",url:"https://data.sec.gov/other",retrievedAt:"2026-10-08"}},
  {key:"revenue",value:999,unit:"USD",period:"2025-09-27",fiscalYear:2025,statementType:"annual",
   status:"verified",source:{provider:"other",sourceType:"scrape",url:"https://competitor.example",retrievedAt:"2026-10-08"}},
 ]
};
describe("public regulatory archive",()=>{
 it("only admits HTTPS official regulator hosts",()=>{
  expect(officialSource("https://data.sec.gov/filing","us")).toBe(true);
  expect(officialSource("https://evil.sec.gov.attacker.com","us")).toBe(false);
  expect(officialSource("http://data.sec.gov","us")).toBe(false);
 });
 it("rejects nonannual and unsupported publisher facts",()=>{
  const result=preparePublicSnapshot(snapshot,"0000320193");
  expect(result?.payload.metrics).toHaveLength(1);
  expect(result?.payload.metrics[0].value).toBe(1200000);
 });
 it("rejects identifier mismatch and missing verified metrics",()=>{
  expect(preparePublicSnapshot(snapshot,"1234567890")).toBeNull();
  expect(preparePublicSnapshot({...snapshot,metrics:[]},"0000320193")).toBeNull();
 });
});
