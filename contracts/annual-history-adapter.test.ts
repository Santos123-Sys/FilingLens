import {describe,expect,it} from "vitest";
import {buildAnnualHistory} from "./annual-history-adapter";
import type {FinancialObservation} from "./financial-history";
const base:FinancialObservation={metric:"revenue",periodKind:"FY",periodEnd:"2025-12-31",fiscalYear:2025,value:100,unit:"millions",currency:"USD",filingId:"10-K-2025",filedAt:"2026-02-01",sourceSection:"Financial Statements"};
describe("annual history adapter",()=>{
 it("builds aligned years in ascending order and pads unavailable metrics with null",()=>{
   const r=buildAnnualHistory([{...base,fiscalYear:2024,periodEnd:"2024-12-31",value:90},base]);
   expect(r.history?.years).toEqual(["2024","2025"]);
   expect(r.history?.revenue).toEqual([90,100]);
   expect(r.history?.netIncome).toEqual([null,null]);
   expect(r.history?.status).toBe("partial");
 });
 it("does not mix FY with quarters or different currencies",()=>{
   const r=buildAnnualHistory([base,{...base,periodKind:"Q",fiscalQuarter:4,value:30},{...base,currency:"BRL",value:500}]);
   expect(r.history?.revenue).toEqual([100]);
   expect(r.excluded).toBe(2);
 });
 it("does not present conflicted values as resolved",()=>{
   const r=buildAnnualHistory([base,{...base,filingId:"10-K-A",filedAt:"2026-03-01",value:120}]);
   expect(r.history).toBeNull();
   expect(r.flags.some(f=>f.code==="CONFLICT")).toBe(true);
 });
 it("rejects missing currency or evidence",()=>{
   expect(buildAnnualHistory([{...base,currency:null}]).history).toBeNull();
   expect(buildAnnualHistory([{...base,sourceSection:""}]).history).toBeNull();
 });
 it("rejects multiple year-end dates sharing one FY designation",()=>{
   const r=buildAnnualHistory([base,{...base,metric:"netIncome",periodEnd:"2025-09-30"}]);
   expect(r.history).toBeNull();
   expect(r.flags.some(f=>f.code==="UNRESOLVED")).toBe(true);
 });
 it("preserves provenance in annual-history sources",()=>{
   const r=buildAnnualHistory([{...base,sourceUrl:"https://www.sec.gov/example"}]);
   expect(r.history?.sources[0]).toMatchObject({section:"Financial Statements",sourceForm:"10-K-2025",url:"https://www.sec.gov/example"});
 });
});
