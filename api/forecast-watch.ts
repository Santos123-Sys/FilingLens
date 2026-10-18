import { createHash } from "node:crypto";
import { z } from "zod";
import { isoDate } from "../contracts/forecast-evaluation";
import {
  checkedVintages,
  vintageSchema,
} from "../contracts/forecast-qualification";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const row = z
  .object({
    horizon: z.number().int().min(1).max(5),
    targetYear: z.number().int().min(2000).max(2099),
    prediction: z.number().finite().positive().max(1e14),
    interval: z
      .object({
        lower: z.number().finite().min(0),
        upper: z.number().finite().positive(),
      })
      .nullable(),
  })
  .strict();
const attempt = z
  .object({
    issuer: z.string().min(1).max(100),
    currency: vintageSchema.shape.currency,
    definition: z.string().min(1).max(150),
    base: z.number().finite().positive().max(1e12),
    trainingIds: z.array(z.string().min(1).max(100)).min(5).max(100),
    rows: z.array(row).length(5),
  })
  .strict();
const payloadSchema = z
  .object({
    schemaVersion: z.literal("forecast-watch.v1"),
    issuedAt: z.string().datetime(),
    sourceCutoff: isoDate,
    modelVersion: z.literal("bounded-median-damped.v3"),
    sourceDatasetSha256: hash,
    predictorSha256: hash,
    reliabilityPolicy: z.literal("forecast-reliability.v1"),
    cohort: z.array(z.string().min(1).max(100)).min(1).max(500),
    exclusions: z
      .array(
        z
          .object({ issuer: z.string().max(100), reason: z.string().max(200) })
          .strict()
      )
      .max(500),
    forecasts: z.array(attempt).max(500),
  })
  .strict();
export type WatchPayload = z.infer<typeof payloadSchema>;
const verifiedReceipts = new WeakSet<object>();
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)])
        )
      : v;
export const watchDigest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function freezeForecastWatch(raw: unknown) {
  const payload = payloadSchema.parse(raw),
    cutoff = payload.issuedAt.slice(0, 10);
  if (payload.sourceCutoff > cutoff || !payload.sourceCutoff.endsWith("-07-01"))
    throw Error("invalid_watch_source_cutoff");
  const all = [
    ...payload.forecasts.map(r => r.issuer),
    ...payload.exclusions.map(r => r.issuer),
  ];
  if (
    new Set(all).size !== all.length ||
    new Set(payload.cohort).size !== payload.cohort.length ||
    [...all].sort().join() !== [...payload.cohort].sort().join()
  )
    throw Error("fixed_cohort_and_exclusion_denominator_required");
  for (const forecast of payload.forecasts)
    for (let i = 0; i < 5; i++) {
      const r = forecast.rows[i];
      if (
        r.horizon !== i + 1 ||
        r.targetYear !== Number(payload.sourceCutoff.slice(0, 4)) + i ||
        `${r.targetYear}-12-31` < cutoff
      )
        throw Error("cannot_register_elapsed_or_incoherent_targets");
      if (r.interval && r.interval.lower > r.interval.upper)
        throw Error("invalid_watch_band");
      if (i >= 2 && r.interval)
        throw Error("failed_horizon_band_cannot_be_registered_as_qualified");
    }
  return { payload, digest: watchDigest(payload) };
}
export function checkedForecastWatch(raw: unknown) {
  const parsed = z
    .object({ payload: payloadSchema, digest: hash })
    .strict()
    .parse(raw);
  const checked = freezeForecastWatch(parsed.payload);
  if (checked.digest !== parsed.digest)
    throw Error("forecast_watch_integrity_mismatch");
  return checked;
}
/** A caller-supplied timestamp is NOT accepted as independent prospective proof.
 * Only this verifier reads GitHub's public API and exact committed file bytes. */
export async function verifyWatchTimestamp(
  raw: unknown,
  runId: number,
  fetcher: typeof fetch = fetch
) {
  const record = checkedForecastWatch(raw);
  if (!Number.isSafeInteger(runId) || runId <= 0)
    throw Error("invalid_anchor_run");
  const get = async (path: string, maxBytes: number) => {
    const r = await fetcher(
      "https://api.github.com/repos/Santos123-Sys/FilingLens/" + path,
      {
        headers: { accept: "application/vnd.github+json" },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!r.ok) throw Error("timestamp_receipt_unavailable");
    const reader = r.body?.getReader();
    if (!reader) throw Error("timestamp_receipt_unavailable");
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        bytes += p.value.byteLength;
        if (bytes > maxBytes) throw Error("oversized_timestamp_receipt");
        parts.push(p.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  };
  const run = z
    .object({
      id: z.literal(runId),
      head_sha: z.string().regex(/^[a-f0-9]{40}$/),
      path: z.literal(".github/workflows/ci.yml"),
      status: z.literal("completed"),
      conclusion: z.literal("success"),
      run_started_at: z.string().datetime(),
      repository: z.object({
        full_name: z.literal("Santos123-Sys/FilingLens"),
      }),
    })
    .parse(await get("actions/runs/" + runId, 100000));
  if (Date.parse(run.run_started_at) < Date.parse(record.payload.issuedAt))
    throw Error("timestamp_precedes_local_freeze");
  const blob = z
    .object({
      type: z.literal("file"),
      encoding: z.literal("base64"),
      content: z.string().max(3000000),
    })
    .parse(
      await get(
        "contents/public/evaluations/forecast-watch-v1.json?ref=" +
          run.head_sha,
        4000000
      )
    );
  const committed = checkedForecastWatch(
    JSON.parse(Buffer.from(blob.content, "base64").toString("utf8"))
  );
  if (committed.digest !== record.digest)
    throw Error("timestamp_does_not_anchor_this_snapshot");
  const receipt = {
    provider: "github-actions" as const,
    runId: run.id,
    headSha: run.head_sha,
    observedAt: run.run_started_at,
    digest: record.digest,
    url: `https://github.com/Santos123-Sys/FilingLens/actions/runs/${run.id}`,
  };
  Object.freeze(receipt);
  verifiedReceipts.add(receipt);
  return receipt;
}
type VerifiedTimestamp = Awaited<ReturnType<typeof verifyWatchTimestamp>>;
/** All fixed cases remain visible. Missing outcomes never become zeros or successes. */
export function scoreForecastWatch(
  raw: unknown,
  rawObservations: unknown,
  asOf: string,
  anchor?: VerifiedTimestamp
) {
  const record = checkedForecastWatch(raw),
    date = isoDate.parse(asOf),
    issued = record.payload.issuedAt.slice(0, 10);
  if (date < issued) throw Error("scoring_date_precedes_registration");
  if (
    anchor &&
    (!verifiedReceipts.has(anchor) ||
      anchor.digest !== record.digest ||
      Date.parse(anchor.observedAt) < Date.parse(record.payload.issuedAt) ||
      anchor.observedAt.slice(0, 10) > date)
  )
    throw Error("invalid_watch_anchor");
  const observations = vintageSchema.array().max(50000).parse(rawObservations);
  const groups = new Map<string, ReturnType<typeof checkedVintages>>();
  for (const issuer of new Set(observations.map(r => r.issuer)))
    groups.set(
      issuer,
      checkedVintages(observations.filter(r => r.issuer === issuer))
    );
  const cases = record.payload.forecasts.flatMap(f =>
    f.rows.map(r => {
      // Freeze the first retained target disclosure; revisions cannot improve a score retroactively.
      const actual = groups
        .get(f.issuer)
        ?.filter(o => o.fiscalYear === r.targetYear && o.publishedOn < date)
        .sort((a, b) => a.publishedOn.localeCompare(b.publishedOn))[0];
      const common = {
        issuer: f.issuer,
        horizon: r.horizon,
        targetYear: r.targetYear,
        prediction: r.prediction,
      };
      if (!actual)
        return {
          ...common,
          status: "pending_outcome" as const,
          reason: "target_disclosure_not_available",
          scaledAbsoluteError: null,
          covered: null,
        };
      if (
        actual.publishedOn <= issued ||
        (anchor && actual.publishedOn <= anchor.observedAt.slice(0, 10))
      )
        return {
          ...common,
          status: "ineligible" as const,
          reason: "outcome_known_before_registration_or_anchor",
          scaledAbsoluteError: null,
          covered: null,
        };
      if (actual.currency !== f.currency || actual.definition !== f.definition)
        return {
          ...common,
          status: "ineligible" as const,
          reason: "changed_currency_or_definition",
          scaledAbsoluteError: null,
          covered: null,
        };
      return {
        ...common,
        status: anchor
          ? ("scored_prospective" as const)
          : ("scored_unanchored" as const),
        reason: anchor ? null : "independent_timestamp_required",
        actual: actual.value,
        targetId: actual.id,
        publishedOn: actual.publishedOn,
        scaledAbsoluteError: Math.abs(r.prediction - actual.value) / f.base,
        covered: r.interval
          ? actual.value >= r.interval.lower && actual.value <= r.interval.upper
          : null,
      };
    })
  );
  return {
    schemaVersion: "forecast-watch-score.v1",
    digest: record.digest,
    issuedAt: record.payload.issuedAt,
    asOf: date,
    timestampStatus: anchor
      ? "independently_observed_github_snapshot"
      : "unanchored_no_prospective_claim",
    anchor: anchor ?? null,
    cohortSize: record.payload.cohort.length,
    excludedAtRegistration: record.payload.exclusions,
    futureAccuracyProven: false as const,
    cases,
    summaries: Array.from({ length: 5 }, (_, i) => {
      const rows = cases.filter(r => r.horizon === i + 1),
        scored = rows.filter(r => r.scaledAbsoluteError !== null);
      const mean = scored.length
        ? scored.reduce((s, r) => s + r.scaledAbsoluteError!, 0) / scored.length
        : null;
      const bands = scored.filter(r => r.covered !== null);
      return {
        horizon: i + 1,
        fixedAttempts: record.payload.cohort.length,
        scored: scored.length,
        pending: rows.filter(r => r.status === "pending_outcome").length,
        ineligible: rows.filter(r => r.status === "ineligible").length,
        macroScaledAbsoluteErrorPercent: mean === null ? null : mean * 100,
        bandCases: bands.length,
        bandCoveragePercent: bands.length
          ? (bands.filter(r => r.covered).length / bands.length) * 100
          : null,
        qualification:
          "not_established_requires_separate_predeclared_validation" as const,
      };
    }),
  };
}
