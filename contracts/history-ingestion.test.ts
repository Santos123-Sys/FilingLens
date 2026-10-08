import {describe,it,expect} from "vitest";
import {prepareFinancialObservations} from "./history-ingestion";
import type {FinancialsResult} from "./analysis";
const financials={unit:"USD millions",years:["2024","2025"],revenue:[100,120],netIncome:[10,15],
 evidence:[{metric:"revenue",period:"2024",source:{section:"Income statement 2024"}},{metric:"revenue",period:"2025",source:{section:"Income statement 2025"}}]
} as unknown as FinancialsResult["financials"];
const input={financials,periods:[{label:"2024",endDate:"2024-12-31",fiscalYear:2024,periodKind:"FY" as const},{label:"2025",endDate:"2025-12-31",fiscalYear:2025,periodKind:"FY" as const}],filingId:"10K-2025",filedAt:"2026-02-01",currency:"USD",unit:"millions"};
describe("source-backed history ingestion",()=>{
 it("requires metric-and-period matched evidence",()=>{
   const r=prepareFinancialObservations(input);
   expect(r.observations.map(x=>x.value)).toEqual([100,120]);
   expect(r.issues.filter(x=>x.code==="NO_EVIDENCE")).toHaveLength(2);
 });
 it("refuses misaligned periods",()=>{
   const r=prepareFinancialObservations({...input,periods:[input.periods[1],input.periods[0]]});
   expect(r.observations).toHaveLength(0);
   expect(r.issues[0].code).toBe("MISALIGNED_SERIES");
 });
 it("does not accept a missing filing identity",()=>{
   expect(prepareFinancialObservations({...input,filingId:""}).issues[0].code).toBe("INVALID_INPUT");
 });
 it("does not invent financial period end from labels",()=>{
   const r=prepareFinancialObservations({...input,periods:[{...input.periods[0],endDate:"wrong"},input.periods[1]]});
   expect(r.issues.some(x=>x.code==="INVALID_INPUT")).toBe(true);
 });
 it("does not treat zero as unavailable",()=>{
   const r=prepareFinancialObservations({...input,financials:{...financials,revenue:[0,120]}});
   expect(r.observations[0].value).toBe(0);
 });
});
