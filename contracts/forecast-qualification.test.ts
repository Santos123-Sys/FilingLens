import { describe, expect, it } from "vitest";
import {
  candidateForecast,
  checkedVintages,
  consecutiveTraining,
  forecastQuality,
} from "./forecast-qualification";
import type { RevenueVintage } from "./forecast-qualification";

const series = (
  values = Array.from({ length: 13 }, (_, i) => 100 + i * 10)
): RevenueVintage[] =>
  values.map((value, i) => ({
    id: `v-${2010 + i}`,
    issuer: "Synthetic",
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
describe("frozen prequential forecast qualification", () => {
  it("cannot learn from future target values, target revisions or same-day publications", () => {
    const observations = series(),
      origin = "2020-07-01";
    const baseline = forecastQuality({ observations, origin });
    const future = observations.map(r =>
      r.publishedOn >= origin ? { ...r, value: r.value * 100 } : r
    );
    future.push({
      ...observations[9],
      id: "later-revision",
      value: 1e8,
      publishedOn: "2020-07-01",
    });
    expect(forecastQuality({ observations: future, origin })).toEqual(baseline);
    expect(baseline.trainingIds).not.toContain("later-revision");
  });
  it("a revision enters only after its exact publication date", () => {
    const original = series();
    const revised = {
      ...original[5],
      id: "revised",
      value: 999,
      publishedOn: "2020-08-01",
    };
    const rows = checkedVintages([...original, revised]);
    expect(
      consecutiveTraining(rows, "2020-07-01").find(r => r.fiscalYear === 2015)
        ?.value
    ).toBe(150);
    expect(
      consecutiveTraining(rows, "2021-07-01").find(r => r.fiscalYear === 2015)
        ?.value
    ).toBe(999);
  });
  it("selects a linear model only after three available prior errors", () => {
    const observations = series();
    const early = forecastQuality({ observations, origin: "2015-07-01" })
      .forecasts[0];
    expect(early.selectedModel).toBe("naive");
    expect(early.selectionErrors).toBe(2);
    const next = forecastQuality({ observations, origin: "2016-07-01" })
      .forecasts[0];
    expect(next.selectedModel).toBe("drift");
    expect(next.prediction).toBeCloseTo(160);
    expect(next.selectionErrors).toBe(3);
    // A later horizon cannot borrow the one-year model's available labels.
    expect(
      forecastQuality({ observations, origin: "2016-07-01" }).forecasts[4]
        .selectedModel
    ).toBe("naive");
  });
  it("does not supply an interval until five prior errors exist, and exposes constant-series zero width", () => {
    const observations = series(Array(13).fill(100));
    expect(
      forecastQuality({ observations, origin: "2017-07-01" }).forecasts[0]
        .interval
    ).toBeNull();
    const f = forecastQuality({ observations, origin: "2018-07-01" })
      .forecasts[0];
    expect(f.calibrationErrors).toBe(5);
    expect(f.interval).toEqual({ lower: 100, upper: 100, nominalPercent: 80 });
    expect(f.selectedModel).toBe("naive");
  });
  it("stops at missing, nonpositive, mixed-currency and changed-definition history rather than zero filling", () => {
    for (const change of [
      { value: 0 },
      { currency: "USD" as const },
      { definition: "net sales after reorganization" },
    ]) {
      const observations = series().map(r =>
        r.fiscalYear === 2020 ? { ...r, ...change } : r
      );
      const result = forecastQuality({ observations, origin: "2022-07-01" });
      expect(result.status).toBe("unavailable");
      expect(result.forecasts).toEqual([]);
    }
    expect(
      forecastQuality({
        observations: series().filter(r => r.fiscalYear !== 2021),
        origin: "2022-07-01",
      }).status
    ).toBe("unavailable");
  });
  it("rejects ambiguous vintages and unsupported calendars without touching source URLs", () => {
    const observations = series();
    expect(() =>
      checkedVintages([...observations, { ...observations[0], id: "same-day" }])
    ).toThrow(/Ambiguous/);
    expect(() =>
      forecastQuality({ observations, origin: "2020-08-01" })
    ).toThrow(/July 1/);
    expect(() =>
      forecastQuality({
        observations: observations.map(r => ({
          ...r,
          periodEnd: `${r.fiscalYear}-09-30`,
        })),
        origin: "2020-07-01",
      })
    ).toThrow();
    expect(() =>
      forecastQuality({
        observations: observations.map(r => ({
          ...r,
          sourceUrl: "https://example.org/?api_key=secret",
        })),
        origin: "2020-07-01",
      })
    ).toThrow();
  });
  it("abstains on invalid forecasts and calculates the ensemble independently", () => {
    expect(candidateForecast([100, 50, 1], "drift", 5)).toBeNull();
    expect(candidateForecast([100, 50, 1], "median_ensemble", 5)).toBeNull();
    expect(candidateForecast([100, 110, 120], "median_ensemble", 1)).toBe(130);
    expect(candidateForecast([100, 0, 120], "naive", 1)).toBeNull();
  });
});
