import { describe, expect, it } from "vitest";
import { valuationFixture } from "../api/fixtures/valuation-case";
import { calculateDcf, prepareDcf } from "../api/valuation/dcf";
import {
  alignedPlanningHistory,
  calculateFiveYearScenario,
  fiveYearPlanningContext,
  transferFiveYearScenario,
} from "./five-year-scenario";
import { financialAuditExport } from "./financial-lineage";
const fixture = () => ({
  issuer: valuationFixture().company.name,
  baseYear: 2025,
  baseRevenue: 100,
  currency: "USD" as const,
  growthPercent: [0, 0, 0, 0, 0],
  note: "Documented level-revenue analyst scenario.",
  sourceUrl: null,
  origin: null,
  reviewed: true,
});
describe("reviewed five-year scenario to DCF", () => {
  it("requires explicit review/rationale and ties issuer, period, currency and base before transfer", () => {
    const a = valuationFixture(),
      ledger = prepareDcf(a).assumptions;
    for (const patch of [
      { reviewed: false },
      { note: "" },
      { issuer: "another" },
      { baseYear: 2024 },
      { baseRevenue: 101 },
      { currency: "BRL" },
    ])
      expect(() =>
        transferFiveYearScenario(
          ledger,
          { ...fixture(), ...patch },
          a.company.name
        )
      ).toThrow();
    expect(() =>
      transferFiveYearScenario(
        ledger,
        { ...fixture(), origin: "2025-02-31" },
        a.company.name
      )
    ).toThrow();
    expect(() =>
      transferFiveYearScenario(
        ledger,
        { ...fixture(), sourceUrl: "https://example.org/?token=secret" },
        a.company.name
      )
    ).toThrow();
  });
  it("retains draft status, does not zero-fill blanks or inherit intervals on manual drivers", () => {
    const draft = calculateFiveYearScenario({ ...fixture(), reviewed: false });
    expect(draft.reviewStatus).toBe("draft");
    expect(draft.intervals).toBeNull();
    expect(() =>
      calculateFiveYearScenario({
        ...fixture(),
        growthPercent: [0, 0, NaN, 0, 0],
      })
    ).toThrow();
    expect(() =>
      calculateFiveYearScenario({ ...fixture(), growthPercent: [0, 0, 0, 0] })
    ).toThrow();
  });
  it("produces the same five revenue rows in the real FCFF engine and preserves scenario provenance on export", () => {
    const a = valuationFixture(),
      ledger = prepareDcf(a).assumptions;
    const old = ledger.find(r => r.id === "dcf.revenue_growth_y1")!;
    old.source = { section: "Old driver", url: "https://old.example/forecast" };
    const transferred = transferFiveYearScenario(
      ledger,
      fixture(),
      a.company.name
    );
    const inputs: Record<string, number> = {
      "dcf.risk_free_rate": 10,
      "dcf.beta": 0,
      "dcf.equity_risk_premium": 0,
      "dcf.debt_weight": 0,
      "dcf.terminal_roic": 10,
      "dcf.terminal_growth": 0,
      "dcf.equity_adjustment": 0,
    };
    const reviewed = transferred.map(r => ({
      ...r,
      status:
        r.status === "edited" ? ("edited" as const) : ("accepted" as const),
      final_value: inputs[r.id] ?? r.final_value ?? r.proposed_value,
    }));
    const result = calculateDcf(a, reviewed),
      scenario = calculateFiveYearScenario(fixture());
    expect(result.projections.map(r => r.revenue)).toEqual(
      scenario.rows.map(r => r.revenue)
    );
    expect(result.figures.implied_per_share.value).toBe(12);
    const exported = financialAuditExport(a, {
      assumptions: { dcf: reviewed },
      dcf: result,
    });
    expect(JSON.stringify(exported)).toContain(
      "empirical bands and cohort qualification do not transfer"
    );
    expect(transferred.find(r => r.id === old.id)?.source).toBeUndefined();
    expect(old.source.url).toBe("https://old.example/forecast");
    expect(
      transferred
        .filter(r => r.id.startsWith("dcf.revenue_growth_y"))
        .every(r => r.status === "edited" && r.confidence === "low")
    ).toBe(true);
    expect(transferred[0]).toBe(ledger[0]);
  });
  it("suggests history only when five annual values and units reconcile to the current ledger", () => {
    const a = valuationFixture();
    a.financials.years = ["2021", "2022", "2023", "2024", "2025"];
    a.financials.revenue = [80, 85, 90, 95, 100];
    const context = fiveYearPlanningContext(a, prepareDcf(a).assumptions)!;
    expect(context.baseYear).toBe(2025);
    expect(alignedPlanningHistory(a, context)?.values).toEqual([
      80, 85, 90, 95, 100,
    ]);
    expect(
      alignedPlanningHistory(a, { ...context, baseRevenue: 110 })
    ).toBeNull();
    a.financials.years[1] = "2022 Q1";
    expect(alignedPlanningHistory(a, context)).toBeNull();
    expect(fiveYearPlanningContext(a, [])).toBeNull();
  });
});
