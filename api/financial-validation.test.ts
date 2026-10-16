import { describe, expect, it } from "vitest";
import { financialsSchema } from "../contracts/analysis";
import { applyFinancialValidation } from "./financial-validation";
import { computeFinancialMetrics } from "../contracts/financial-metrics";

const source = () => financialsSchema.parse({ financials: {
  unit: "USD millions", years: ["FY2025"], revenue: [200], netIncome: [10],
  eps: null, grossMargin: null, operatingMargin: null, operatingCashFlow: [100],
  capex: [-20], freeCashFlow: [999], dividends: null, buybacks: null,
  totalAssets: null, totalDebt: null, cash: null,
} });

describe("independent free cash flow reconciliation", () => {
  it.each([-20, 20])("checks OCF less capex independently of the reported amount (capex %s)", async capex => {
    const input = source(); input.financials.capex = [capex];
    const result = await applyFinancialValidation(input);
    // Independent cash arithmetic: 100 generated less 20 invested leaves 80.
    const cashFlow = result.financials.computed?.find(metric => metric.key === "freeCashFlowCalculated");
    expect(cashFlow?.values).toEqual([80]);
    expect(cashFlow?.type).toBe("calculated");
    expect(cashFlow?.components).toEqual(["operatingCashFlow", "capex"]);
    expect(result.financials.freeCashFlow).toEqual([999]);
    expect(input.financials.freeCashFlow).toEqual([999]);
    expect(result.financials.validation?.relationshipWarnings).toEqual(["freeCashFlow:FY2025"]);
  });

  it("keeps a reported amount when components are missing without claiming a reconciliation", async () => {
    const input = source(); input.financials.capex = null;
    const result = await applyFinancialValidation(input);
    expect(result.financials.freeCashFlow).toEqual([999]);
    expect(result.financials.computed?.find(metric => metric.key === "freeCashFlowCalculated")).toBeUndefined();
    expect(result.financials.validation?.relationshipWarnings).toEqual([]);
  });

  it("accepts a reconciled report and calculates missing reported cash flow", async () => {
    const input = source(); input.financials.freeCashFlow = [80];
    const reconciled = await applyFinancialValidation(input);
    expect(reconciled.financials.validation?.relationshipWarnings).toEqual([]);
    input.financials.freeCashFlow = null;
    const calculated = await applyFinancialValidation(input);
    expect(calculated.financials.freeCashFlow).toBeNull();
    expect(calculated.financials.computed?.find(metric => metric.key === "freeCashFlowCalculated")?.values).toEqual([80]);
    expect(calculated.financials.validation?.relationshipWarnings).toEqual([]);
  });
});


describe("whole-series source coverage", () => {
  it("requires component evidence for every period rather than borrowing a citation from another year", async () => {
    const financials = source().financials;
    const evidence = (metric: string, period: string) => ({ metric, period, source: { section: "Synthetic test balance sheet", quote: "Fixture only; not a public-company source." } });
    financials.years = ["FY2024", "FY2025"];
    financials.totalDebt = [40, 40]; financials.cash = [10, 10];
    financials.totalAssets = [100, 100]; financials.totalEquity = [60, 60];
    financials.revenue = [200, 200]; financials.netIncome = [10, 10]; financials.ebit = [20, 20];
    financials.evidence = [evidence("totalDebt", "FY2024"), evidence("cash", "FY2024"),
      evidence("revenue", "FY2024"), evidence("ebit", "FY2024")];
    const incomplete = computeFinancialMetrics(financials).find(metric => metric.key === "netDebt");
    expect(incomplete?.confidence).toBe("medium");
    // Full ratio inputs exercise the exact skill bridge, which must preserve period coverage.
    const bridged = await applyFinancialValidation({ financials });
    expect(bridged.financials.computed?.find(metric => metric.key === "netDebt")?.confidence).toBe("medium");
    expect(bridged.financials.computed?.find(metric => metric.key === "ebitMargin")?.confidence).toBe("medium");
    financials.evidence.push(evidence("totalDebt", "FY2025"), evidence("cash", "FY2025"));
    const covered = computeFinancialMetrics(financials).find(metric => metric.key === "netDebt");
    expect(covered?.confidence).toBe("high");
  });
});
