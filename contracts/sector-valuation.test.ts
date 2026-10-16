import { describe, expect, it } from "vitest";
import {
  calculateSectorValuation,
  type ResidualIncomeInput,
  type ReitNavInput,
} from "./sector-valuation";

export const bankCase = (): ResidualIncomeInput => ({
  method: "residual_income",
  sector: "bank",
  issuer: "Synthetic Bank",
  currency: "USD",
  valuationDate: "2026-10-16",
  inputAsOf: "2026-10-16",
  dilutedShares: 10,
  reviewed: true,
  sample: true,
  evidence: {},
  openingCommonEquity: 100,
  costOfEquityPercent: 10,
  netIncome: [10, 10, 10, 10, 10],
  dividends: [10, 10, 10, 10, 10],
  minimumCommonEquity: [80, 80, 80, 80, 80],
  terminalRoePercent: 10,
  terminalGrowthPercent: 0,
  cleanSurplusConfirmed: true,
  regulatoryCapitalReviewed: true,
});
export const reitCase = (): ReitNavInput => ({
  method: "reit_nav",
  sector: "equity_reit",
  issuer: "Synthetic REIT",
  currency: "USD",
  valuationDate: "2026-10-16",
  inputAsOf: "2026-10-16",
  dilutedShares: 10,
  reviewed: true,
  sample: true,
  evidence: {},
  properties: [
    {
      name: "A",
      annualForwardNoi: 12,
      capRatePercent: 6,
      ownershipPercent: 50,
    },
  ],
  cash: 10,
  otherAssets: 0,
  grossDebt: 50,
  otherLiabilities: 0,
  preferredEquity: 0,
  nonControllingInterests: 0,
  corporateCostValue: 0,
  ownershipAndClaimsReviewed: true,
});
describe("specialist common-equity models", () => {
  it("equals book value when ROE equals cost of equity", () => {
    const r = calculateSectorValuation(bankCase());
    expect(r.equityValue).toBeCloseTo(100, 10);
    expect(r.valuePerShare).toBeCloseTo(10, 10);
    expect(r.schedule[0].equityCharge).toBe(10);
    expect(r.schedule[0].residualIncome).toBe(0);
    expect(r.reconciliation?.dividendDiscountEquity).toBeCloseTo(100, 10);
  });
  it.each(["bank", "insurer"] as const)(
    "charges BEGINNING equity, preserves capital and reconciles dividends for %s",
    sector => {
      const x = bankCase();
      x.sector = sector;
      x.netIncome = [15, 16, 17, 18, 19];
      x.dividends = [7.5, 8, 8.5, 9, 9.5];
      x.terminalGrowthPercent = 2;
      const r = calculateSectorValuation(x);
      expect(r.schedule[0].equityCharge).toBe(10);
      expect(r.schedule[0].endingEquity).toBe(107.5);
      expect(r.schedule[1].equityCharge).toBeCloseTo(10.75, 8);
      expect(r.reconciliation?.difference).toBeCloseTo(0, 8);
      // Independent RI cash-flow reference, not values copied from the implementation.
      const pv = [5, 5.25, 5.45, 5.6, 5.7].reduce(
        (s, v, i) => s + v / 1.1 ** (i + 1),
        0
      );
      expect(r.equityValue).toBeCloseTo(100 + pv, 8);
    }
  );
  it("permits negative residual income instead of clipping it", () => {
    const x = bankCase();
    x.netIncome = [5, 5, 5, 5, 5];
    x.dividends = [5, 5, 5, 5, 5];
    x.terminalRoePercent = 5;
    const r = calculateSectorValuation(x);
    expect(r.valuePerShare).toBeCloseTo(5, 8);
  });
  it("rejects unreviewed, dirty-surplus, capital-deficient and impossible terminal cases", () => {
    for (const patch of [
      { reviewed: false },
      { cleanSurplusConfirmed: false },
      { regulatoryCapitalReviewed: false },
      { minimumCommonEquity: [101, 101, 101, 101, 101] },
      { costOfEquityPercent: 2, terminalGrowthPercent: 2 },
      { terminalRoePercent: 1, terminalGrowthPercent: 2 },
    ])
      expect(() =>
        calculateSectorValuation({ ...bankCase(), ...patch })
      ).toThrow();
  });
  it("uses look-through property ownership and deducts every common-equity claim once", () => {
    const r = calculateSectorValuation(reitCase());
    expect(r.equityValue).toBeCloseTo(60, 10);
    expect(r.valuePerShare).toBeCloseTo(6, 10);
    const x = reitCase();
    x.preferredEquity = 5;
    x.otherLiabilities = 4;
    x.nonControllingInterests = 3;
    x.corporateCostValue = 2;
    expect(calculateSectorValuation(x).equityValue).toBeCloseTo(46, 10);
  });
  it("rejects mortgage REITs, zero cap rates, invalid ownership and negative-NOI models", () => {
    for (const patch of [
      { sector: "mortgage_reit" },
      { ownershipAndClaimsReviewed: false },
      { properties: [{ ...reitCase().properties[0], capRatePercent: 0 }] },
      { properties: [{ ...reitCase().properties[0], ownershipPercent: 101 }] },
      { properties: [{ ...reitCase().properties[0], annualForwardNoi: -1 }] },
    ])
      expect(() =>
        calculateSectorValuation({ ...reitCase(), ...patch })
      ).toThrow();
  });
  it("rejects source credentials, future input dates, nonfinite amounts and zero shares", () => {
    for (const patch of [
      {
        evidence: {
          dilutedShares: {
            url: "https://x.example/?token=secret",
            note: "unsafe",
          },
        },
      },
      { inputAsOf: "2026-10-17" },
      { dilutedShares: 0 },
      { openingCommonEquity: Infinity },
    ])
      expect(() =>
        calculateSectorValuation({ ...bankCase(), ...patch })
      ).toThrow();
  });
  it("exports navigable derivations without upgrading input links to verified facts", () => {
    const x = bankCase();
    x.evidence.openingCommonEquity = {
      url: "https://example.org/statement",
      note: "Book equity input",
    };
    const r = calculateSectorValuation(x);
    expect(r.lineage.nodes.openingCommonEquity.status).toBe("user_supplied");
    expect(
      r.lineage.nodes.openingCommonEquity.sources[0].quote
    ).toBeUndefined();
    expect(r.lineage.nodes.openingCommonEquity.sources[0].url).toBe(
      x.evidence.openingCommonEquity.url
    );
    for (const node of Object.values(r.lineage.nodes))
      for (const id of node.inputs) expect(r.lineage.nodes[id]).toBeDefined();
    expect(r.publicationStatus).toBe("review_export_only");
  });
});
