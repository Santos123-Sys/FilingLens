import { describe, expect, it } from "vitest";
import { observationKey, reconcileFinancialHistory, seriesForMetric, type FinancialObservation } from "./financial-history";

const sample: FinancialObservation = {
  metric:"revenue", periodEnd:"2025-12-31", periodKind:"FY", fiscalYear:2025,
  value:100, unit:"millions", currency:"USD", filingId:"10K-2025",
  filedAt:"2026-02-20", sourceSection:"Consolidated statements"
};
describe("financial history reconciliation", () => {
  it("keeps fiscal year and quarterly observations separate", () => {
    const q:FinancialObservation={...sample,periodKind:"Q",periodEnd:"2025-12-31",fiscalQuarter:4,value:25};
    const out=reconcileFinancialHistory([sample,q]);
    expect(out.points).toHaveLength(2);
    expect(observationKey(sample)).not.toBe(observationKey(q));
  });
  it("keeps multiple currencies and units separate",()=>{
    const out=reconcileFinancialHistory([sample,{...sample,currency:"BRL"},{...sample,unit:"thousands"}]);
    expect(out.points).toHaveLength(3);
  });
  it("does not silently overwrite conflicting reports",()=>{
    const later={...sample,filingId:"10K-A",filedAt:"2026-03-01",value:120};
    const out=reconcileFinancialHistory([sample,later]);
    expect(out.points[0].status).toBe("conflicted");
    expect(out.points[0].value).toBeNull();
    expect(out.flags.map(f=>f.code)).toContain("CONFLICT");
  });
  it("treats a null as missing rather than zero",()=>{
    const out=reconcileFinancialHistory([{...sample,value:null}]);
    expect(out.points[0].status).toBe("missing");
    expect(seriesForMetric(out,"revenue","FY")[0].value).toBeNull();
  });
  it("ignores invalid numbers and dates",()=>{
    const out=reconcileFinancialHistory([{...sample,value:NaN},{...sample,periodEnd:"2025-02-30"}]);
    expect(out.points).toHaveLength(0);
    expect(out.flags).toHaveLength(2);
  });
  it("accepts repeated same-value observations with latest evidence",()=>{
    const out=reconcileFinancialHistory([sample,{...sample,filingId:"10K-A",filedAt:"2026-03-01"}]);
    expect(out.points[0].status).toBe("verified");
    expect(out.points[0].filingId).toBe("10K-A");
  });
  it("flags missing provenance",()=>{
    const out=reconcileFinancialHistory([{...sample,sourceSection:""}]);
    expect(out.flags.some(f=>f.code === "MISSING_EVIDENCE")).toBe(true);
  });
});
