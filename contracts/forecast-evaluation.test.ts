import { describe, expect, it } from "vitest";
import { evaluateForecasts, revenueForecast } from "./forecast-evaluation";
import reference from "../src/data/forecast-reference.json";
import { prepareDcf } from "../api/valuation/dcf";
import { valuationFixture } from "../api/fixtures/valuation-case";

const observations = reference.observations.filter(o => o.issuer === "Apple");
describe("point-in-time forecast replay", () => {
  it("keeps targets and post-origin facts outside training for every horizon", () => {
    const r = evaluateForecasts({ observations });
    expect(
      r.rows.filter(x => x.model === "filinglens_growth_v1" && x.horizon === 1)
    ).toHaveLength(5);
    expect(r.rows).toHaveLength(60);
    for (const row of r.rows) {
      expect(row.trainingIds).not.toContain(row.targetId);
      for (const id of row.trainingIds) {
        const item = observations.find(o => o.id === id)!;
        expect(item.publishedOn < row.origin).toBe(true);
        expect(item.fiscalYear < row.targetYear).toBe(true);
      }
    }
  });
  it("does not alter an earlier forecast when later outcomes change", () => {
    const before = evaluateForecasts({ observations });
    const after = evaluateForecasts({
      observations: observations.map(o =>
        o.fiscalYear > 2020 ? { ...o, value: o.value * 1.9 } : o
      ),
    });
    expect(after.rows[0].prediction).toBe(before.rows[0].prediction);
    expect(after.rows[0].actual).not.toBe(before.rows[0].actual);
  });
  it("reproduces current DCF proposals rather than a substitute forecast model", () => {
    const a = valuationFixture();
    a.financials.revenue = [100, 120];
    const growth = prepareDcf(a).assumptions.filter(r =>
      r.id.startsWith("dcf.revenue_growth_y")
    );
    expect(growth).toHaveLength(5);
    expect(growth.map(r => r.proposed_value)).toEqual([20, 17, 14, 11, 8]);
    // Independent small sequence: latest growth 20%, tapered to 17% in Y2.
    expect(
      revenueForecast([100, 100, 120], "filinglens_growth_v1", 2)
    ).toBeCloseTo(168.48, 8);
    growth.forEach(r => expect(r.confidence).toBe("low"));
  });
  it("calculates error signs and exposes undefined MASE for constant training", () => {
    const r = evaluateForecasts({
      observations: observations
        .slice(0, 4)
        .map((o, i) => ({ ...o, value: i < 3 ? 100 : 110 })),
    });
    const naive = r.scores.find(s => s.model === "naive")!;
    expect(naive.mae).toBe(10);
    expect(naive.rmse).toBe(10);
    expect(naive.bias).toBe(-10);
    expect(naive.mase).toBeNull();
    expect(naive.maseCount).toBe(0);
  });
  it.each(["issuer", "currency", "definition"])(
    "rejects a mixed %s basis",
    field => {
      const data = structuredClone(observations) as Record<string, unknown>[];
      data[1][field] = field === "currency" ? "BRL" : "Other";
      expect(() => evaluateForecasts({ observations: data })).toThrow(
        /mismatch/
      );
    }
  );
  it("rejects duplicates, missing years, post-target publication and empty holdouts", () => {
    expect(() =>
      evaluateForecasts({ observations: [...observations, observations[0]] })
    ).toThrow(/Duplicate/);
    expect(() =>
      evaluateForecasts({
        observations: observations.filter(o => o.fiscalYear !== 2020),
      })
    ).toThrow(/Consecutive/);
    expect(() =>
      evaluateForecasts({
        observations: observations.map(o =>
          o.fiscalYear === 2020 ? { ...o, publishedOn: "2021-10-01" } : o
        ),
      })
    ).toThrow(/overlaps/);
    expect(() => evaluateForecasts({ observations, minTraining: 8 })).toThrow(
      /holdout/
    );
  });
  it("rejects invalid dates, quarter/negative data and credentialed source URLs", () => {
    for (const patch of [
      { periodEnd: "2020-02-31" },
      { value: 0 },
      { unit: "thousands" },
      { sourceUrl: "https://x.example/?token=secret" },
    ])
      expect(() =>
        evaluateForecasts({
          observations: observations.map((o, i) =>
            i === 0 ? { ...o, ...patch } : o
          ),
        })
      ).toThrow();
  });
  it("frozen excerpts carry the annual current-year revenue, including distinct quarter columns", () => {
    for (const o of reference.observations) {
      expect(o.sourceQuote).toContain(o.value.toLocaleString("en-US"));
      expect(o.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      const numbers = [...o.sourceQuote.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(
        m => Number(m[0].replaceAll(",", ""))
      );
      expect(numbers.slice(-4)[2]).toBe(o.value);
    }
  });
});
