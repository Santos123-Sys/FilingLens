import { describe, expect, it, vi } from "vitest";
import {
  checkedForecastWatch,
  checkedWatchAttestation,
  freezeForecastWatch,
  scoreForecastWatch,
  verifyWatchTimestamp,
} from "./forecast-watch";
const payload = () => ({
  schemaVersion: "forecast-watch.v1",
  issuedAt: "2026-10-17T12:00:00.000Z",
  sourceCutoff: "2026-07-01",
  modelVersion: "bounded-median-damped.v3",
  sourceDatasetSha256: "a".repeat(64),
  predictorSha256: "b".repeat(64),
  reliabilityPolicy: "forecast-reliability.v1",
  cohort: ["1", "2"],
  exclusions: [{ issuer: "2", reason: "missing history" }],
  forecasts: [
    {
      issuer: "1",
      currency: "BRL",
      definition: "consolidated revenue",
      base: 100,
      trainingIds: ["a", "b", "c", "d", "e"],
      rows: Array.from({ length: 5 }, (_, i) => ({
        horizon: i + 1,
        targetYear: 2026 + i,
        prediction: 110 + i,
        interval: i < 2 ? { lower: 90, upper: 130 } : null,
      })),
    },
  ],
});
const actual = (patch = {}) => ({
  id: "outcome",
  issuer: "1",
  fiscalYear: 2026,
  periodEnd: "2026-12-31",
  publishedOn: "2027-03-01",
  value: 120,
  currency: "BRL",
  unit: "millions",
  definition: "consolidated revenue",
  sourceUrl: "https://example.org/filing",
  sourceSha256: "c".repeat(64),
  ...patch,
});
const receiptFetcher = (snapshot: unknown, patch = {}) =>
  vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    if (String(url).endsWith("/actions/runs/42"))
      return Response.json({
        id: 42,
        head_sha: "d".repeat(40),
        path: ".github/workflows/ci.yml",
        status: "completed",
        conclusion: "success",
        run_started_at: "2026-10-18T12:00:00Z",
        repository: { full_name: "Santos123-Sys/FilingLens" },
        ...patch,
      });
    if (
      String(url) ===
      "https://api.github.com/repos/Santos123-Sys/FilingLens/contents/public/evaluations/forecast-watch-v1.json?ref=" +
        "d".repeat(40)
    )
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(snapshot)).toString("base64"),
      });
    throw Error("Unexpected receipt endpoint");
  });
describe("prospective forecast evidence, not fabricated future proof", () => {
  it("checks retained receipt lineage but never upgrades a copied attestation into scoring authority", async () => {
    const record = freezeForecastWatch(payload());
    const receipt = await verifyWatchTimestamp(
      record,
      42,
      receiptFetcher(record)
    );
    const retained = checkedWatchAttestation(
      {
        schemaVersion: "forecast-watch-attestation.v1",
        verifiedAt: "2026-10-18T13:00:00Z",
        receipt,
      },
      record
    );
    expect(retained.receipt.digest).toBe(record.digest);
    expect(() =>
      scoreForecastWatch(record, [actual()], "2027-05-01", retained.receipt)
    ).toThrow("invalid_watch_anchor");
    for (const patch of [
      { digest: "f".repeat(64) },
      { url: "https://attacker.example/receipt" },
      { observedAt: "2020-01-01T00:00:00Z" },
    ])
      expect(() =>
        checkedWatchAttestation(
          { ...retained, receipt: { ...retained.receipt, ...patch } },
          record
        )
      ).toThrow();
    expect(() =>
      checkedWatchAttestation(
        { ...retained, verifiedAt: "2026-10-17T00:00:00Z" },
        record
      )
    ).toThrow();
  });
  it("freezes a fixed denominator, detects tampering, and refuses backdated/elapsed targets and failed bands", () => {
    const value = freezeForecastWatch(payload());
    expect(checkedForecastWatch(value)).toEqual(value);
    expect(() =>
      checkedForecastWatch({ ...value, digest: "f".repeat(64) })
    ).toThrow("integrity");
    for (const change of [
      { cohort: ["1"] },
      { cohort: ["1", "1"] },
      { issuedAt: "2027-01-01T00:00:00Z" },
      { sourceCutoff: "2027-07-01" },
    ])
      expect(() => freezeForecastWatch({ ...payload(), ...change })).toThrow();
    const failed = payload();
    failed.forecasts[0].rows[4].interval = { lower: 1, upper: 100 };
    expect(() => freezeForecastWatch(failed)).toThrow("failed_horizon_band");
  });
  it("leaves all unobserved future outcomes pending, without zeros or an accuracy upgrade", () => {
    const r = scoreForecastWatch(
      freezeForecastWatch(payload()),
      [],
      "2026-10-18"
    );
    expect(r.cases).toHaveLength(5);
    expect(r.cases.every(c => c.status === "pending_outcome")).toBe(true);
    expect(
      r.summaries.every(
        s =>
          s.fixedAttempts === 2 &&
          s.scored === 0 &&
          s.macroScaledAbsoluteErrorPercent === null
      )
    ).toBe(true);
    expect(r.excludedAtRegistration).toHaveLength(1);
    expect(r.futureAccuracyProven).toBe(false);
    expect(() =>
      scoreForecastWatch(freezeForecastWatch(payload()), [], "2026-01-01")
    ).toThrow("precedes");
  });
  it("cannot label an unanchored or forged timestamp as prospective; versions do not improve a score later", async () => {
    const record = freezeForecastWatch(payload());
    const target = [
      actual(),
      actual({ id: "revision", publishedOn: "2027-04-01", value: 110 }),
    ];
    const unanchored = scoreForecastWatch(record, target, "2027-05-01");
    expect(unanchored.cases[0].status).toBe("scored_unanchored");
    expect(unanchored.summaries[0].macroScaledAbsoluteErrorPercent).toBe(10);
    const anchor = await verifyWatchTimestamp(
      record,
      42,
      receiptFetcher(record)
    );
    expect(() =>
      scoreForecastWatch(record, target, "2027-05-01", { ...anchor })
    ).toThrow("invalid_watch_anchor");
    expect(
      scoreForecastWatch(record, target, "2027-05-01", anchor).cases[0].status
    ).toBe("scored_prospective");
    expect(
      scoreForecastWatch(record, target, "2027-05-01", anchor)
        .futureAccuracyProven
    ).toBe(false);
  });
  it("denies wrong repository/workflow, unsuccessful CI, a different snapshot, an early clock or oversized receipt", async () => {
    const record = freezeForecastWatch(payload());
    for (const patch of [
      { conclusion: "failure" },
      { path: ".github/workflows/other.yml" },
      { repository: { full_name: "attacker/repo" } },
      { run_started_at: "2020-01-01T00:00:00Z" },
    ])
      await expect(
        verifyWatchTimestamp(record, 42, receiptFetcher(record, patch))
      ).rejects.toThrow();
    const changed = payload();
    changed.forecasts[0].rows[0].prediction = 115;
    await expect(
      verifyWatchTimestamp(
        record,
        42,
        receiptFetcher(freezeForecastWatch(changed))
      )
    ).rejects.toThrow("does_not_anchor");
    await expect(
      verifyWatchTimestamp(
        record,
        42,
        vi.fn(async () => new Response("x".repeat(100001)))
      )
    ).rejects.toThrow("oversized");
  });
  it("retains changed-basis, late-anchor and non-mature cases as ineligible or pending, never as forecast successes", async () => {
    const record = freezeForecastWatch(payload());
    expect(
      scoreForecastWatch(record, [actual({ currency: "USD" })], "2027-05-01")
        .cases[0].status
    ).toBe("ineligible");
    expect(
      scoreForecastWatch(record, [actual()], "2027-03-01").cases[0].status
    ).toBe("pending_outcome");
    const late = await verifyWatchTimestamp(
      record,
      42,
      receiptFetcher(record, { run_started_at: "2027-04-01T12:00:00Z" })
    );
    expect(
      scoreForecastWatch(record, [actual()], "2027-05-01", late).cases[0].reason
    ).toBe("outcome_known_before_registration_or_anchor");
  });
});
