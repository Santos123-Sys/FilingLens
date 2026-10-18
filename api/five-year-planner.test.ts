import { describe, expect, it } from "vitest";
import app from "./boot";
import source from "../public/evaluations/five-year-cohort-cvm-v3.json";
import { fiveYearPlan } from "../contracts/five-year-forecast";
import type { PreparedFiveYearForecast } from "./five-year-planner";
const observations = source.cohort
  .map(i => source.observations.filter(o => o.issuer === i.code))
  .find(
    observations =>
      fiveYearPlan({ observations, origin: "2026-07-01" }).status ===
      "conditional_five_year_plan"
  )!;
const post = (body: unknown) =>
  app.request("/api/forecast/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("bounded stateless five-year planning API", () => {
  it("returns five source-dated rows, with development-only calibration for exact canonical inputs", async () => {
    const response = await post({ observations, origin: "2026-07-01" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      result: PreparedFiveYearForecast;
    };
    expect(body.result.rows).toHaveLength(5);
    expect(body.result.calibrationEligibility).toBe("canonical_cvm_replay");
    expect(body.result.rows[0].band.interval).not.toBeNull();
    expect(
      body.result.rows
        .slice(2)
        .every(
          r =>
            r.band.interval === null &&
            r.band.status === "withheld_failed_horizon_precision_gate"
        )
    ).toBe(true);
    expect(
      body.result.rows.every(r => r.reliability.futureAccuracyProven === false)
    ).toBe(true);
    const heldOut = new Set(source.cohort.map(i => i.code));
    for (const row of body.result.rows)
      expect(
        row.band.calibrationIds.some(id => heldOut.has(id.split(":")[0]))
      ).toBe(false);
  });
  it("does not attach empirical bands to manipulated or arbitrary analyst histories", async () => {
    const response = await post({
      observations: observations.map((o, i) =>
        i === 0 ? { ...o, value: o.value + 0.01 } : o
      ),
      origin: "2026-07-01",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: PreparedFiveYearForecast;
    };
    expect(body.result.calibrationEligibility).toBe(
      "analyst_supplied_not_canonical"
    );
    expect(
      body.result.rows.every(
        r =>
          r.band.interval === null &&
          r.band.status === "unverified_history_no_calibration"
      )
    ).toBe(true);
  });
  it("rejects unsupported calendars, invalid JSON and oversized requests", async () => {
    expect((await post({ observations, origin: "2026-08-01" })).status).toBe(
      422
    );
    expect(
      (await app.request("/api/forecast/plan", { method: "POST", body: "{" }))
        .status
    ).toBe(400);
    expect(
      (
        await app.request("/api/forecast/plan", {
          method: "POST",
          body: "x".repeat(100001),
        })
      ).status
    ).toBe(413);
  });
});
