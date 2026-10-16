import { describe, expect, it } from "vitest";
import {
  buildDevelopmentCalibration,
  empiricalBand,
  fiveYearPath,
  fiveYearPlan,
} from "./five-year-forecast";
import type { CalibrationCase } from "./five-year-forecast";
import type { RevenueVintage } from "./forecast-qualification";
const series = (
  issuer = "dev",
  values = Array.from({ length: 16 }, (_, i) => 100 * Math.pow(1.1, i))
): RevenueVintage[] =>
  values.map((value, i) => ({
    id: `${issuer}-${2010 + i}`,
    issuer,
    fiscalYear: 2010 + i,
    periodEnd: `${2010 + i}-12-31`,
    publishedOn: `${2011 + i}-03-01`,
    value,
    currency: "BRL",
    unit: "millions",
    definition: "consolidated revenue",
    sourceUrl: "https://example.org/annual.csv",
    sourceSha256: "a".repeat(64),
  }));
describe("coherent bounded five-year forecasting", () => {
  it("compounds the exact transferred drivers and damps a known growth rate", () => {
    const path = fiveYearPath([100, 110, 121, 133.1, 146.41]);
    expect(path.rows).toHaveLength(5);
    expect(path.rows[0].growthPercent).toBe(10);
    expect(path.rows[1].growthPercent).toBeCloseTo(
      (Math.pow(1.1, 0.8) - 1) * 100,
      5
    );
    let previous = 146.41;
    for (const row of path.rows) {
      expect(row.revenue).toBe(previous * (1 + row.growthPercent / 100));
      previous = row.revenue;
    }
    expect(path.rows[4].growthPercent).toBeLessThan(path.rows[0].growthPercent);
  });
  it("bounds forecast growth without replacing the observed base or clipping actuals", () => {
    const values = [1, 10, 100, 1000, 10000];
    const path = fiveYearPath(values);
    expect(path.boundsApplied).toBe(true);
    expect(path.rows[0].growthPercent).toBe(25);
    expect(path.rows[0].revenue).toBe(12500);
    expect(path.rows[4].revenue).toBeLessThan(22000);
    expect(values).toEqual([1, 10, 100, 1000, 10000]);
    expect(fiveYearPath([100, 10, 1, 0.1, 0.01]).rows[0].growthPercent).toBe(
      -20
    );
    expect(fiveYearPath([100, 100, 100, 100, 1000]).rows[0].growthPercent).toBe(
      0
    );
  });
  it("does not learn from future values or later revisions in either predictions or pooled bands", () => {
    const original = series(),
      origin = "2021-07-01";
    const pool = buildDevelopmentCalibration(original, ["dev"]);
    const baseline = fiveYearPlan({ observations: original, origin }, pool);
    const revised = original.map(r =>
      r.publishedOn >= origin ? { ...r, value: r.value * 10 } : r
    );
    revised.push({
      ...original[8],
      id: "late-revision",
      publishedOn: "2022-08-01",
      value: 1e8,
    });
    expect(
      fiveYearPlan(
        { observations: revised, origin },
        buildDevelopmentCalibration(revised, ["dev"])
      )
    ).toEqual(baseline);
    expect(baseline.trainingIds).not.toContain("late-revision");
  });
  it("requires five consecutive positive same-basis vintages and calendar origins", () => {
    const observations = series();
    for (const patch of [
      { value: 0 },
      { currency: "USD" as const },
      { definition: "changed" },
    ]) {
      const r = fiveYearPlan({
        observations: observations.map(o =>
          o.fiscalYear === 2023 ? { ...o, ...patch } : o
        ),
        origin: "2026-07-01",
      });
      expect(r.status).toBe("unavailable");
      expect(r.rows).toEqual([]);
    }
    expect(() => fiveYearPlan({ observations, origin: "2026-08-01" })).toThrow(
      /July/
    );
    expect(() => fiveYearPath([1, 2, 3, 4])).toThrow();
    expect(() => fiveYearPath([1, 2, 3, NaN, 5])).toThrow();
  });
  it("refuses any held-out issuer in the development calibration pool", () => {
    expect(() =>
      buildDevelopmentCalibration([...series(), ...series("test")], ["dev"])
    ).toThrow("held_out_issuer");
  });
  it("uses the finite-sample upper rank, with minimum error/issuer counts and strict receipt cutoffs", () => {
    const pool: CalibrationCase[] = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      issuer: `dev${i}`,
      origin: "2015-07-01",
      horizon: 5,
      targetYear: 2019,
      scale: 100,
      prediction: 100 + i,
      currency: "BRL",
      definition: "consolidated revenue",
      trainingIds: [],
      targetVintages: [{ ...series()[9], issuer: `dev${i}`, value: 100 }],
    }));
    const band = empiricalBand(pool, "2021-07-01", 5, 100, 100, "BRL");
    expect(band.calibrationCount).toBe(30);
    expect(band.interval).toEqual({
      lower: 76,
      upper: 124,
      nominalPercent: 80,
    });
    expect(
      empiricalBand(pool.slice(0, 29), "2021-07-01", 5, 100, 100, "BRL")
        .interval
    ).toBeNull();
    expect(
      empiricalBand(
        pool.map(p => ({ ...p, issuer: "one" })),
        "2021-07-01",
        5,
        100,
        100,
        "BRL"
      ).interval
    ).toBeNull();
    expect(
      empiricalBand(pool, "2020-03-01", 5, 100, 100, "BRL").calibrationCount
    ).toBe(0);
    expect(
      empiricalBand(pool, "2021-07-01", 5, 100, 100, "USD").interval
    ).toBeNull();
  });
  it("fails closed on numeric calibration overflow and never serializes an infinite growth statistic", () => {
    const path = fiveYearPath([1e-320, 1e-240, 1e-160, 1e-80, 1]);
    expect(path.rows.every(r => Number.isFinite(r.revenue))).toBe(true);
    expect(JSON.stringify(path)).not.toContain("Infinity");
    const pool: CalibrationCase[] = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      issuer: `dev${i}`,
      origin: "2015-07-01",
      horizon: 5,
      targetYear: 2019,
      scale: 1e-320,
      prediction: 100,
      currency: "BRL",
      definition: "consolidated revenue",
      trainingIds: [],
      targetVintages: [{ ...series()[9], value: 200 }],
    }));
    expect(empiricalBand(pool, "2021-07-01", 5, 100, 100, "BRL").status).toBe(
      "nonfinite_calibration_or_bounds"
    );
  });
});
