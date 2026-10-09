import { describe, expect, it } from "vitest";
import type { FilingAnalysis, ValuationAssumption } from "../contracts/analysis";
import { calculateDcf, prepareDcf } from "./valuation/dcf";
import { prepareComps, calculateComps } from "./valuation/comps";
import { annualBasis, moneyBasis } from "./valuation/basis";
import { num, validatedRows } from "./valuation/common";
import { discountCashFlows } from "../vendor/financetoolkit/valuation";
import { evaluateTradingPeer } from "../contracts/trading-comps-eligibility";

export const valuationFixture = (): FilingAnalysis => ({ schemaVersion: "2.0", jurisdiction: "us",
  metadata: { jurisdiction: "us", filingType: "10-K", reportingPeriod: "2025-12-31", filedAt: null, confidence: 1, cnpj: null, cvmDocumentClass: null, registryData: null, cik: "1", sicCode: null, fiscalYearEnd: null, stateOfIncorporation: null, sources: [] },
  company: { name: "Valuation test issuer", ticker: "TST", exchange: "NYSE", filingType: "10-K", periodEnd: "2025-12-31", filedAt: null, description: "Synthetic arithmetic fixture; not a real valuation." },
  financials: { unit: "USD millions", accountingBasis: "us_gaap", statementScope: "consolidated", years: ["2024", "2025"], revenue: [100, 100], ebit: [20, 20], ebitda: [25, 25], netIncome: [20, 20], eps: [2, 2], incomeBeforeTax: [20, 20], incomeTaxExpense: [5, 5], grossMargin: null, operatingMargin: [0.2, 0.2], operatingCashFlow: [20, 20], capex: [-5, -5], freeCashFlow: [15, 15], dividends: null, buybacks: null, totalAssets: [100, 100], totalDebt: [40, 40], cash: [10, 10], accountsReceivable: [20, 20], inventory: [10, 10], accountsPayable: [20, 20], interestExpense: [0, 0] },
  kpis: [], market: { industry: "Synthetic", competitors: ["A", "B", "C"], segments: [], geographies: [] }, risks: [], timeline: [], events: [], summary: [], confidenceNotes: [], missingData: [] });
function reviewedDcf(a = valuationFixture()): ValuationAssumption[] {
  const inputs: Record<string, number> = { "dcf.risk_free_rate": 10, "dcf.beta": 0, "dcf.equity_risk_premium": 0, "dcf.debt_weight": 0, "dcf.terminal_growth": 0, "dcf.equity_adjustment": 0 };
  return prepareDcf(a).assumptions.map(row => ({ ...row, proposed_value: inputs[row.id] ?? row.proposed_value, status: "accepted" }));
}
const snapshots = () => [7, 9, 11, 13].map((multiple, i) => ({
  name: `Peer ${i + 1}`, currency: "USD" as const, basis: "us_gaap" as const, consolidated: true,
  financial_period_start: "2025-01-01", financial_period_end: "2025-12-31", financial_period_kind: "FY" as const,
  debt_as_of: "2025-12-31", quotation_date: new Date().toISOString().slice(0, 10), market_cap_millions: multiple * 100 - 20,
  net_debt_millions: 20, minority_interest_millions: 0, preferred_equity_millions: 0,
  revenue_millions: 100, ebitda_millions: 100, net_income_millions: 100,
  quotation_source_url: `https://quote.example.com/${i}`, financial_source_url: `https://issuer.example.com/${i}/annual` }));

describe("rebuilt valuation arithmetic and analyst gates", () => {
  it("matches an independent level perpetuity hand calculation", () => {
    const result = calculateDcf(valuationFixture(), reviewedDcf());
    // A perpetual 15 FCFF discounted at 10% is 150 EV, regardless of forecast horizon.
    expect(result.projections.map(p => p.fcff)).toEqual([15, 15, 15, 15, 15]);
    expect(result.figures.enterprise_value.value).toBe(150);
    expect(result.figures.equity_value.value).toBe(120);
    expect(result.figures.implied_per_share.value).toBe(12);
    expect(result.sensitivity.values[2][2]).toBe(12);
    expect(result.figures.equity_value.unit).toBe("USD millions");
  });
  it("honors accepted edits, signed bridge adjustments, and rejects empty or duplicate inputs", () => {
    const rows = reviewedDcf();
    rows.find(r => r.id === "dcf.equity_adjustment")!.final_value = "20";
    expect(calculateDcf(valuationFixture(), rows).figures.implied_per_share.value).toBe(14);
    rows.find(r => r.id === "dcf.shares_outstanding")!.final_value = "";
    expect(() => calculateDcf(valuationFixture(), rows)).toThrow("invalid_dcf.shares_outstanding");
    expect(() => validatedRows("dcf", [rows[0], rows[0]])).toThrow("duplicate_assumption_ids");
    const blank = { ...rows[0], id: "blank", proposed_value: " " };
    expect(() => num(new Map([["blank", blank]]), "blank")).toThrow("invalid_blank");
  });
  it("blocks unreasonable rates, unsupported SBC and a terminal growth at WACC", () => {
    for (const [id, value, error] of [["dcf.tax_rate", 150, "out_of_range_tax"], ["dcf.terminal_growth", 10, "wacc_must_exceed"], ["dcf.sbc_treatment", "add_back", "unsupported_sbc"]] as const) {
      const rows = reviewedDcf(); rows.find(r => r.id === id)!.final_value = value;
      expect(() => calculateDcf(valuationFixture(), rows)).toThrow(error);
    }
  });
  it("uses explicit scales and never annualizes quarter or YTD data", () => {
    expect(moneyBasis("USD thousands")?.toMillions).toBe(0.001);
    expect(moneyBasis("USD billions")?.toMillions).toBe(1000);
    expect(moneyBasis("USD unknown scale")).toBeNull();
    const a = valuationFixture(); a.financials.years = ["2025 Q3", "2026 YTD"];
    expect(annualBasis(a)).toBeNull();
    expect(prepareDcf(a).assumptions.find(r => r.id === "dcf.base_revenue")?.proposed_value).toBeNull();
    const ambiguous = valuationFixture(); ambiguous.company.filingType = "8-K";
    expect(annualBasis(ambiguous)).toBeNull();
    ambiguous.financials.years = ["FY2024", "FY2025"];
    expect(annualBasis(ambiguous)?.value("revenue")).toBe(100);
    const different = valuationFixture(); different.financials.unit = "USD thousands";
    for (const key of ["revenue", "ebit", "ebitda", "netIncome", "incomeBeforeTax", "incomeTaxExpense", "capex", "totalDebt", "cash", "accountsReceivable", "inventory", "accountsPayable", "interestExpense"] as const) different.financials[key] = different.financials[key]!.map(v => v * 1000);
    expect(calculateDcf(different, reviewedDcf(different)).figures.implied_per_share.value).toBe(12);
  });
  it("integrates the FinanceToolkit terminal discount timing", () => {
    const result = discountCashFlows([100, 110, 121, 133.1, 146.41], 0.1, 0);
    // Five cash flows growing at the discount rate each have PV 90.90909; TV PV=909.0909.
    expect(result.enterpriseValue).toBeCloseTo(1363.63636363636, 8);
    expect(result.presentTerminalValue).toBeCloseTo(909.0909090909, 8);
  });
  it("computes an even-cohort median, rejects quarterly peers, and includes minority/preferred claims", async () => {
    const a = valuationFixture(), peers = snapshots();
    const proposal = await prepareComps(a, peers, { metric: "EV/Revenue" });
    expect(proposal.assumptions.find(r => r.id === "comps.selected_multiple")?.proposed_value).toBe(10);
    const result = calculateComps(a, proposal.assumptions.map(r => ({ ...r, status: "accepted", ...(r.id === "comps.equity_adjustment" ? { final_value: 0 } : {}) })));
    expect(result.figures.implied_per_share.value).toBe(97);
    expect(result.quartiles.q1.value).toBe(8.5);
    const p = peers[0], ctx = { peer: p.name, issuerPeriodEnd: "2025-12-31", currency: "USD", basis: "us_gaap", today: p.quotation_date, sourceUrls: new Set([p.quotation_source_url, p.financial_source_url]) };
    expect(evaluateTradingPeer({ ...p, financial_period_start: "2025-10-01" }, "EV/Revenue", ctx)).toBeNull();
    expect(evaluateTradingPeer({ ...p, minority_interest_millions: undefined }, "EV/Revenue", ctx)).toBeNull();
    expect(evaluateTradingPeer({ ...p, minority_interest_millions: 100, preferred_equity_millions: 200 }, "EV/Revenue", ctx)?.multiple).toBe(10);
    expect(evaluateTradingPeer(p, "EV/Revenue", { ...ctx, issuerPeriodEnd: "2025-09-30" })).toBeNull();
    expect(evaluateTradingPeer(p, "EV/Revenue", { ...ctx, issuerPeriodEnd: "2025-10-02", fiscalToleranceDays: 90 })?.multiple).toBe(7);
  });
});
