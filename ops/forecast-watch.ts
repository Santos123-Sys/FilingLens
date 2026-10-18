import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import source from "../public/evaluations/five-year-cohort-cvm-v3.json";
import { prepareFiveYearForecast } from "../api/five-year-planner";
import {
  checkedForecastWatch,
  freezeForecastWatch,
  scoreForecastWatch,
  verifyWatchTimestamp,
  watchDigest,
} from "../api/forecast-watch";
const path = "public/evaluations/forecast-watch-v1.json",
  scorePath = "public/evaluations/forecast-watch-score-v1.json";
const sha = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
const mode = process.argv[2] ?? "verify";
if (!["register", "verify", "score"].includes(mode))
  throw Error("Use register, verify or score");
const expectedForecast = (
  issuer: string,
  plan: ReturnType<typeof prepareFiveYearForecast>,
  observations: typeof source.observations
) => ({
  issuer,
  currency: plan.currency!,
  definition: observations.find(r => r.id === plan.trainingIds[0])!.definition,
  base: plan.baseRevenue!,
  trainingIds: plan.trainingIds,
  rows: plan.rows.map(r => ({
    horizon: r.horizon,
    targetYear: r.targetYear,
    prediction: r.revenue,
    interval: r.band.interval
      ? { lower: r.band.interval.lower, upper: r.band.interval.upper }
      : null,
  })),
});
if (mode === "register") {
  const forecasts = [],
    exclusions = [];
  for (const issuer of source.cohort) {
    const observations = source.observations.filter(
        o => o.issuer === issuer.code
      ),
      plan = prepareFiveYearForecast({ observations, origin: "2026-07-01" });
    if (plan.status === "unavailable") {
      exclusions.push({ issuer: issuer.code, reason: plan.reason! });
      continue;
    }
    forecasts.push(expectedForecast(issuer.code, plan, observations));
  }
  const record = freezeForecastWatch({
    schemaVersion: "forecast-watch.v1",
    issuedAt: new Date().toISOString(),
    sourceCutoff: "2026-07-01",
    modelVersion: "bounded-median-damped.v3",
    sourceDatasetSha256: sha("public/evaluations/five-year-cohort-cvm-v3.json"),
    predictorSha256: sha("contracts/five-year-forecast.ts"),
    reliabilityPolicy: "forecast-reliability.v1",
    cohort: source.cohort.map(i => i.code),
    exclusions,
    forecasts,
  });
  // Never overwrite the frozen forecast to improve an eventual score.
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({
      registeredAt: record.payload.issuedAt,
      digest: record.digest,
      cohort: 120,
      forecasts: forecasts.length,
      exclusions: exclusions.length,
      independentTimestamp: "required_before_prospective_scoring",
    })
  );
} else {
  const record = checkedForecastWatch(JSON.parse(readFileSync(path, "utf8")));
  if (
    record.payload.sourceDatasetSha256 !==
      sha("public/evaluations/five-year-cohort-cvm-v3.json") ||
    record.payload.predictorSha256 !== sha("contracts/five-year-forecast.ts")
  )
    throw Error("frozen_source_or_predictor_drift");
  if (record.payload.cohort.join() !== source.cohort.map(r => r.code).join())
    throw Error("frozen_cohort_changed");
  for (const issuer of record.payload.cohort) {
    const observations = source.observations.filter(o => o.issuer === issuer),
      plan = prepareFiveYearForecast({
        observations,
        origin: record.payload.sourceCutoff,
      });
    const registered = record.payload.forecasts.find(f => f.issuer === issuer);
    if (plan.status === "unavailable") {
      if (
        registered ||
        !record.payload.exclusions.some(
          e => e.issuer === issuer && e.reason === plan.reason
        )
      )
        throw Error("frozen_exclusion_changed");
    } else if (
      !registered ||
      watchDigest(registered) !==
        watchDigest(expectedForecast(issuer, plan, observations))
    )
      throw Error("frozen_forecast_or_input_changed");
  }
  const savedScore = JSON.parse(readFileSync(scorePath, "utf8"));
  const targetFile = process.env.FORECAST_WATCH_OUTCOMES;
  const outcomes = targetFile
    ? JSON.parse(readFileSync(targetFile, "utf8")).observations
    : source.observations;
  const runId =
    process.env.FORECAST_WATCH_ANCHOR_RUN_ID ?? savedScore.anchor?.runId;
  const anchor = runId
    ? await verifyWatchTimestamp(record, Number(runId))
    : undefined;
  const result = scoreForecastWatch(
    record,
    outcomes,
    mode === "verify" ? savedScore.asOf : new Date().toISOString().slice(0, 10),
    anchor
  );
  const summary = {
    issuedAt: result.issuedAt,
    asOf: result.asOf,
    digest: result.digest,
    sourceCutoff: record.payload.sourceCutoff,
    cohortSize: result.cohortSize,
    forecastIssuers: record.payload.forecasts.length,
    excluded: record.payload.exclusions.length,
    timestampStatus: result.timestampStatus,
    summaries: result.summaries,
  };
  if (mode === "verify") {
    if (
      watchDigest(result) !== watchDigest(savedScore) ||
      watchDigest(summary) !==
        watchDigest(
          JSON.parse(
            readFileSync("src/data/forecast-watch-summary.json", "utf8")
          )
        )
    )
      throw Error("watch_score_or_summary_drift");
  } else {
    writeFileSync(scorePath, JSON.stringify(result, null, 2) + "\n");
    writeFileSync(
      "src/data/forecast-watch-summary.json",
      JSON.stringify(summary, null, 2) + "\n"
    );
  }
  console.log(
    JSON.stringify({
      digest: record.digest,
      timestampStatus: result.timestampStatus,
      futureAccuracyProven: false,
      summaries: result.summaries,
    })
  );
}
