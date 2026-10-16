import { describe, expect, it } from "vitest";
import app from "./boot";
import reference from "../src/data/forecast-reference.json";
import type { SectorValuationResult } from "../contracts/sector-valuation";
import type { ForecastEvaluation } from "../contracts/forecast-evaluation";
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const model = () => ({
  method: "reit_nav",
  sector: "equity_reit",
  issuer: "Synthetic",
  currency: "USD",
  valuationDate: "2026-10-16",
  inputAsOf: "2026-10-16",
  dilutedShares: 10,
  reviewed: true,
  sample: true,
  evidence: {},
  properties: [
    {
      name: "Synthetic",
      annualForwardNoi: 12,
      capRatePercent: 6,
      ownershipPercent: 100,
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
describe("bounded stateless validation APIs", () => {
  it("calculates public synthetic inputs and marks responses no-store", async () => {
    const response = await post("/api/valuation/sector", model());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = (await response.json()) as { result: SectorValuationResult };
    expect(data.result.valuePerShare).toBeCloseTo(16, 10);
    expect(data.result.publicationStatus).toBe("review_export_only");
  });
  it("requires explicit reviewed inputs, rejects invalid JSON and bounds bytes", async () => {
    expect(
      (await post("/api/valuation/sector", { ...model(), reviewed: false }))
        .status
    ).toBe(422);
    expect(
      (
        await app.request("/api/valuation/sector", {
          method: "POST",
          body: "{",
        })
      ).status
    ).toBe(400);
    expect(
      (
        await app.request("/api/valuation/sector", {
          method: "POST",
          body: "a".repeat(100001),
        })
      ).status
    ).toBe(413);
  });
  it("returns all forecast folds with source references without reaching a provider", async () => {
    const response = await post("/api/forecast/evaluate", {
      observations: reference.observations.filter(
        o => o.issuer === "Microsoft"
      ),
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { result: ForecastEvaluation };
    expect(data.result.rows).toHaveLength(60);
    expect(data.result.evaluationType).toBe(
      "retrospective_original_disclosure_replay"
    );
  });
});
