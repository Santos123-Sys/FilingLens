import { describe, expect, it } from "vitest";
import type { FilingAnalysis } from "./analysis";
import { annualValueDriverSignals } from "./value-driver-signals";

function sample(form: string, financials: Record<string, unknown>): FilingAnalysis {
  return {
    company: { name: "Test Company", filingType: form },
    financials,
  } as unknown as FilingAnalysis;
}
describe("Annual value-driver filing monitor", () => {
  const apple = sample("10-K", {
    unit: "USD millions", years: ["FY2024", "FY2025"],
    revenue: [391035, 416161], ebit: [123216, 133050],
    operatingCashFlow: [118254, 111482], capex: [9447, 12715],
  });
  it("computes only annual source-observations, never causal claims", () => {
    const signals = annualValueDriverSignals(apple);
    expect(signals).toHaveLength(4);
    const revenue = signals.find(x => x.metric === "revenue_growth")!;
    expect(revenue.delta).toBeCloseTo((416161 / 391035 - 1) * 100, 7);
    expect(revenue.evidence).toBe("filing_observation");
    const fcf = signals.find(x => x.metric === "free_cash_flow")!;
    expect(fcf.previousValue).toBe(108807);
    expect(fcf.currentValue).toBe(98767);
    expect(fcf.unit).toBe("percent");
  });
  it("rejects 10-Q periods without explicitly separate annualHistory", () => {
    expect(annualValueDriverSignals(sample("10-Q", apple.financials))).toEqual([]);
  });
  it("flags material annual margin movements using threshold in percentage points", () => {
    const x = sample("DFP", {unit:"BRL millions",years:["FY2024","FY2025"],revenue:[1000,1200],ebit:[120,240]});
    const signals = annualValueDriverSignals(x);
    expect(signals.find(s=>s.metric==="operating_margin")!.delta).toBeCloseTo(8);
    expect(signals.find(s=>s.metric==="operating_margin")!.material).toBe(true);
  });
  it("does not fabricate incomplete cash-flow inputs", () => {
    const x = sample("10-K", {unit:"USD millions",years:["2024","2025"],revenue:[100,120],ebit:null,operatingCashFlow:null,capex:null});
    expect(annualValueDriverSignals(x).map(s=>s.metric)).toEqual(["revenue_growth"]);
  });
});
