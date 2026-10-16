import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildDevelopmentCalibration,
  fiveYearPlan,
} from "../contracts/five-year-forecast";
import {
  availableYear,
  checkedVintages,
  forecastQuality,
  candidateForecast,
} from "../contracts/forecast-qualification";
import type { RevenueVintage } from "../contracts/forecast-qualification";

type Cohort = {
  protocolCommit: string;
  acquiredOn: string;
  cohort: { code: string; name: string; sector: string }[];
  observations: RevenueVintage[];
};
const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Cohort;
const dev = read("public/evaluations/forecast-cohort-cvm.json"),
  test = read("public/evaluations/five-year-cohort-cvm-v3.json");
const devCodes = dev.cohort.map(i => i.code);
const outcomeCutoff = new Date(Date.parse(test.acquiredOn) + 86400000)
  .toISOString()
  .slice(0, 10);
if (test.cohort.some(i => devCodes.includes(i.code)))
  throw Error("Held-out cohort overlaps development");
const pool = buildDevelopmentCalibration(dev.observations, devCodes);
const cases: {
  issuer: string;
  name: string;
  sector: string;
  horizon: number;
  targetYear: number;
  origin: string;
  status: string;
  reason: string | null;
  trainingIds?: string[];
  targetId?: string;
  base?: number;
  actual?: number;
  predictions?: Record<string, number | null>;
  interval?: { lower: number; upper: number; nominalPercent: 80 } | null;
  calibrationPool?: string;
  boundsApplied?: boolean;
}[] = [];
const calibrationPools: Record<
  string,
  { ids: string[]; count: number; issuers: number; cutoff: string }
> = {};
for (const issuer of test.cohort) {
  const observations = checkedVintages(
    test.observations.filter(o => o.issuer === issuer.code)
  );
  const plans = new Map<string, ReturnType<typeof fiveYearPlan>>(),
    v2s = new Map<string, ReturnType<typeof forecastQuality>>();
  for (let horizon = 1; horizon <= 5; horizon++)
    for (let targetYear = 2023; targetYear <= 2025; targetYear++) {
      const origin = `${targetYear - horizon + 1}-07-01`;
      if (!plans.has(origin))
        plans.set(origin, fiveYearPlan({ observations, origin }, pool));
      const plan = plans.get(origin)!;
      const attempt = {
        issuer: issuer.code,
        name: issuer.name,
        sector: issuer.sector,
        horizon,
        targetYear,
        origin,
        status: "excluded",
        reason: plan.reason,
      };
      const f = plan.rows[horizon - 1];
      if (!f) {
        cases.push(attempt);
        continue;
      }
      const actual = availableYear(observations, targetYear, outcomeCutoff);
      if (!actual) {
        cases.push({ ...attempt, reason: "missing_retained_target" });
        continue;
      }
      const training = plan.trainingIds.map(id =>
        observations.find(o => o.id === id)!
      );
      const base = training.at(-1)!;
      if (
        actual.currency !== base.currency ||
        actual.definition !== base.definition
      ) {
        cases.push({
          ...attempt,
          reason: "changed_target_currency_or_definition",
        });
        continue;
      }
      if (!v2s.has(origin))
        v2s.set(origin, forecastQuality({ observations, origin }));
      const v2 = v2s.get(origin)!.forecasts.find(r => r.horizon === horizon);
      cases.push({
        ...attempt,
        status: "scored",
        reason: null,
        trainingIds: plan.trainingIds,
        targetId: actual.id,
        base: base.value,
        actual: actual.value,
        predictions: {
          bounded_v3: f.revenue,
          naive: base.value,
          legacy: candidateForecast(
            training.map(t => t.value),
            "filinglens_growth_v1",
            horizon
          ),
          adaptive_v2: v2?.prediction ?? null,
        },
        interval: f.band.interval,
        calibrationPool: f.band.calibrationPool,
        boundsApplied: plan.boundsApplied,
      });
      calibrationPools[f.band.calibrationPool] = {
        ids: f.band.calibrationIds,
        count: f.band.calibrationCount,
        issuers: f.band.calibrationIssuers,
        cutoff: origin,
      };
    }
}
type Row = (typeof cases)[number];
const mean = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b),
    m = Math.floor(a.length / 2);
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null;
};
const error = (r: Row, model: string) =>
  Math.abs(r.predictions![model]! - r.actual!) / r.base!;
const macro = (rows: Row[], model: string) =>
  mean(
    [...new Set(rows.map(r => r.issuer))].map(id =>
      mean(rows.filter(r => r.issuer === id).map(r => error(r, model)))!
    )
  );
const summaries = Array.from({ length: 5 }, (_, i) => {
  const horizon = i + 1,
    attempts = cases.filter(r => r.horizon === horizon),
    scored = attempts.filter(r => r.status === "scored");
  const paired = scored.filter(r =>
    Object.values(r.predictions!).every(p => p !== null)
  );
  const issuers = new Set(paired.map(r => r.issuer)).size;
  const scores = ["bounded_v3", "naive", "legacy", "adaptive_v2"].map(
    model => ({
      model,
      count: paired.length,
      issuerCount: issuers,
      macroScaledAbsoluteErrorPercent: paired.length
        ? macro(paired, model)! * 100
        : null,
      meanScaledAbsoluteErrorPercent: mean(
        paired.map(r => error(r, model) * 100)
      ),
      medianScaledAbsoluteErrorPercent: median(
        paired.map(r => error(r, model) * 100)
      ),
      mapePercent: mean(
        paired
          .filter(r => r.actual! > 0)
          .map(
            r =>
              (Math.abs(r.predictions![model]! - r.actual!) / r.actual!) * 100
          )
      ),
    })
  );
  const sectors = [...new Set(test.cohort.map(i => i.sector))]
    .sort()
    .map(sector => {
      const rows = paired.filter(r => r.sector === sector),
        n = new Set(rows.map(r => r.issuer)).size;
      return {
        sector,
        testIssuers: n,
        cases: rows.length,
        evidence: n >= 3 ? "measured_sample" : "sparse",
        macroErrorPercent: rows.length
          ? macro(rows, "bounded_v3")! * 100
          : null,
      };
    });
  const v3 = macro(paired, "bounded_v3"),
    legacy = macro(paired, "legacy"),
    naive = macro(paired, "naive");
  const gates = [
    { name: "30 paired issuers", pass: issuers >= 30 },
    { name: "100 paired cases", pass: paired.length >= 100 },
    {
      name: "60% scored coverage",
      pass: scored.length / attempts.length >= 0.6,
    },
    {
      name: "Six sectors with three issuers",
      pass: sectors.filter(s => s.testIssuers >= 3).length >= 6,
    },
    {
      name: "5% lower macro error than legacy",
      pass: v3 !== null && legacy !== null && v3 <= legacy * 0.95,
    },
    {
      name: "No more than 5% worse than naive",
      pass: v3 !== null && naive !== null && v3 <= naive * 1.05,
    },
  ];
  const bands = scored.filter(r => r.interval),
    coverage = mean(
      bands.map(
        r => +(r.actual! >= r.interval!.lower && r.actual! <= r.interval!.upper)
      )
    );
  const widths = bands.map(
      r => ((r.interval!.upper - r.interval!.lower) / r.base!) * 100
    ),
    medianWidth = median(widths);
  return {
    horizon,
    attempted: attempts.length,
    scored: scored.length,
    excluded: attempts.length - scored.length,
    pairedCases: paired.length,
    pairedIssuers: issuers,
    exclusions: Object.fromEntries(
      [...new Set(attempts.filter(r => r.reason).map(r => r.reason!))]
        .sort()
        .map(reason => [
          reason,
          attempts.filter(r => r.reason === reason).length,
        ])
    ),
    status: gates.every(g => g.pass)
      ? "qualified_in_fresh_issuer_cohort"
      : "conditional_planning_only",
    gates,
    scores,
    sectors,
    intervalCount: bands.length,
    intervalCoveragePercent: coverage === null ? null : coverage * 100,
    medianIntervalWidthPercent: medianWidth,
    meanIntervalWidthPercent: mean(widths),
    intervalUsefulness:
      bands.length >= 50 &&
      coverage !== null &&
      coverage >= 0.75 &&
      medianWidth !== null &&
      medianWidth <= 200
        ? "passes_project_precision_gate"
        : "not_established",
    winsTiesLossesVsV2: {
      wins: paired.filter(
        r => error(r, "bounded_v3") < error(r, "adaptive_v2") - 1e-10
      ).length,
      ties: paired.filter(
        r => Math.abs(error(r, "bounded_v3") - error(r, "adaptive_v2")) <= 1e-10
      ).length,
      losses: paired.filter(
        r => error(r, "bounded_v3") > error(r, "adaptive_v2") + 1e-10
      ).length,
    },
    worstCases: [...scored]
      .sort((a, b) => error(b, "bounded_v3") - error(a, "bounded_v3"))
      .slice(0, 5),
    byIssuer: test.cohort.map(i => {
      const rows = paired.filter(r => r.issuer === i.code);
      return {
        issuer: i.code,
        cases: rows.length,
        macroErrorPercent: rows.length
          ? macro(rows, "bounded_v3")! * 100
          : null,
      };
    }),
  };
});
const fingerprint = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const summary = {
  schemaVersion: "five-year-evaluation.v3",
  protocolCommit: "1d83c38",
  predictorFreezeCommit: "b3f3f60",
  acquiredOn: test.acquiredOn,
  protocolSha256: fingerprint("docs/five-year-forecast-protocol-v3.md"),
  engineSha256: fingerprint("contracts/five-year-forecast.ts"),
  datasetSha256: fingerprint("public/evaluations/five-year-cohort-cvm-v3.json"),
  developmentDatasetSha256: fingerprint(
    "public/evaluations/forecast-cohort-cvm.json"
  ),
  developmentIssuers: dev.cohort.length,
  heldOutIssuers: test.cohort.length,
  heldOutObservations: test.observations.length,
  qualifiedHorizons: summaries
    .filter(s => s.status === "qualified_in_fresh_issuer_cohort")
    .map(s => s.horizon),
  summaries,
  cohort: test.cohort,
  limitations: [
    "Retrospective issuer-held-out Brazilian CVM cohort, not prospective/global accuracy proof.",
    "All years are available for conditional planning; qualification is assessed separately per horizon.",
    "V2's original 60 issuers are development/calibration only. New test outcomes never calibrate bands.",
    "Retained-vintage gaps and reconstructed 2018 eligibility can bias coverage; overlapping years share macro regimes.",
    "Damping and growth bounds are fixed project controls, not financial laws. Edited plans lose empirical calibration.",
    "Revenue evidence does not validate margins, FCFF, terminal value, WACC or stock returns.",
  ],
  attribution:
    "CVM DFP and issuer register; derivative database ODbL 1.0, see data/LICENSE-CVM.md.",
};
writeFileSync(
  "src/data/five-year-qualification-summary.json",
  JSON.stringify(summary, null, 2) + "\n"
);
writeFileSync(
  "public/evaluations/five-year-evaluation-v3.json",
  JSON.stringify({ ...summary, calibrationPools, cases }, null, 2) + "\n"
);
console.log(
  JSON.stringify(
    {
      qualifiedHorizons: summary.qualifiedHorizons,
      summaries: summaries.map(s => ({
        ...s,
        sectors: undefined,
        worstCases: undefined,
        byIssuer: undefined,
      })),
    },
    null,
    2
  )
);
