import type { ValuationAssumption } from "../contracts/analysis";
import { describe, it, expect } from "vitest";
import { valuationFixture } from "./fixtures/valuation-case";
import { prepareDcf, calculateDcf } from "./valuation/dcf";
import { discountCashFlows } from "../vendor/financetoolkit/valuation";
function ledger(): ValuationAssumption[] {
  const values: Record<string, number> = {
    "dcf.risk_free_rate": 10,
    "dcf.beta": 0,
    "dcf.equity_risk_premium": 0,
    "dcf.debt_weight": 0,
    "dcf.terminal_growth": 2,
    "dcf.terminal_roic": 10,
    "dcf.equity_adjustment": 0,
  };
  return prepareDcf(valuationFixture()).assumptions.map(r => ({
    ...r,
    status: "accepted" as const,
    final_value: values[r.id] ?? (r.id.startsWith("dcf.revenue_growth_y") ? 0 : r.proposed_value),
  }));
}
describe("sustainable terminal cash flow and method suitability", () => {
  it("discounts an explicit next-year terminal cash flow without regrowing it", () => {
    // PV of five 15 flows = 56.86159854; PV of 120 terminal FCFF / (10%-2%) = 931.38198459.
    const result = discountCashFlows([15, 15, 15, 15, 15], 0.1, 0.02, 120);
    expect(result.terminalValue).toBe(1500);
    expect(result.enterpriseValue).toBeCloseTo(988.243786129859, 7);
  });
  it("ties terminal growth to reinvestment and keeps the explicit forecast separate", () => {
    const result = calculateDcf(valuationFixture(), ledger());
    // Terminal NOPAT 15*1.02=15.3; reinvestment 2%/10%=20%; FCFF6=12.24, TV=153.
    expect(result.figures.terminal_value.value).toBe(153);
    expect(result.figures.enterprise_value.value).toBe(151.86);
    expect(result.calculation_version).toBe("fcff-roic.v2");
    expect(result.terminal?.reinvestment_rate_percent).toBe(20);
    expect(result.terminal?.fcff).toBeCloseTo(12.24);
  });
  it("requires a new terminal ROIC assumption and rejects impossible reinvestment", () => {
    expect(() =>
      calculateDcf(
        valuationFixture(),
        ledger().filter(r => r.id !== "dcf.terminal_roic")
      )
    ).toThrow("missing_dcf.terminal_roic");
    const rows = ledger();
    rows.find(r => r.id === "dcf.terminal_roic")!.final_value = 1;
    expect(() => calculateDcf(valuationFixture(), rows)).toThrow(
      "terminal_growth_exceeds_roic"
    );
  });
  it("prevents unsupported financial-company FCFF and currency relabelling", () => {
    const bank = valuationFixture();
    bank.market.industry = "Commercial Banking";
    expect(() => calculateDcf(bank, ledger())).toThrow("unsupported_sector");
    const rows = ledger();
    rows.find(r => r.id === "dcf.currency")!.final_value = "BRL";
    expect(() => calculateDcf(valuationFixture(), rows)).toThrow(
      "currency_conversion_not_supported"
    );
  });
  it("does not recognize a tax benefit for operating losses without a tax-loss schedule", () => {
    const rows = ledger();
    rows.find(r => r.id === "dcf.ebit_margin_y1")!.final_value = -20;
    const result = calculateDcf(valuationFixture(), rows);
    expect(result.projections[0].nopat).toBe(-20);
  });
});
