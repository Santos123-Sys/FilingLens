import { describe, expect, it } from "vitest";
import {
  applyForecastReliability,
  horizonReliability,
  usablePlanningBand,
} from "./forecast-reliability";
import { fiveYearPlan } from "./five-year-forecast";
import source from "../public/evaluations/five-year-cohort-cvm-v3.json";
describe("forecast precision gate enforcement", () => {
  it("separates passing historical comparisons from useful uncertainty and future proof", () => {
    for (let h = 1; h <= 5; h++) {
      const result = horizonReliability(h, true);
      expect(result.pointComparisonPassed).toBe(true);
      expect(result.activeBandAllowed).toBe(h <= 2);
      expect(result.historicalPrecisionPassed).toBe(h <= 2);
      expect(result.futureAccuracyProven).toBe(false);
      expect(result.automaticForecastPublicationAllowed).toBe(false);
    }
    expect(horizonReliability(6, true).activeBandAllowed).toBe(false);
    expect(horizonReliability(1, false).activeBandAllowed).toBe(false);
  });
  it("preserves frozen point forecasts but removes failed precision from API and older UI/export responses", () => {
    const observations = source.observations.filter(
      o => o.issuer === source.cohort[0].code
    );
    const plan = fiveYearPlan({ observations, origin: "2026-07-01" });
    for (const row of plan.rows)
      row.band.interval = { lower: 1, upper: 100, nominalPercent: 80 };
    const copy = structuredClone(plan),
      served = applyForecastReliability(plan, true);
    expect(plan).toEqual(copy);
    expect(served.rows.map(r => r.revenue)).toEqual(
      plan.rows.map(r => r.revenue)
    );
    for (let i = 0; i < 5; i++) {
      expect(served.rows[i].band.interval === null).toBe(i >= 2);
      expect(usablePlanningBand(plan, i, false) === null).toBe(i >= 2);
      expect(usablePlanningBand(plan, i, true)).toBeNull();
    }
    expect(
      applyForecastReliability(plan, false).rows.every(
        r => r.band.interval === null
      )
    ).toBe(true);
  });
});
