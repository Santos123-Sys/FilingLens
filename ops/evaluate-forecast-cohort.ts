import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  checkedVintages,
  forecastQuality,
  scoredModels,
} from "../contracts/forecast-qualification";
import type {
  RevenueVintage,
  ScoredModel,
} from "../contracts/forecast-qualification";

const path = "public/evaluations/forecast-cohort-cvm.json";
const bytes = readFileSync(path);
const data = JSON.parse(bytes.toString()) as {
  protocolCommit: string;
  acquiredOn: string;
  eligible2018Count: number;
  cohort: {
    code: string;
    name: string;
    sector: string;
    registryStatus: string;
  }[];
  observations: RevenueVintage[];
};
type Case = {
  issuer: string;
  sector: string;
  origin: string;
  horizon: number;
  targetYear: number;
  split: string;
  status: string;
  reason: string | null;
  trainingIds?: string[];
  targetId?: string;
  scale?: number;
  actual?: number;
  predictions?: Record<ScoredModel, number | null>;
  selectedModel?: string;
  selectionErrors?: number;
  calibrationErrors?: number;
  interval?: { lower: number; upper: number; nominalPercent: 80 } | null;
};
const cases: Case[] = [];
for (const issuer of data.cohort) {
  const observations = checkedVintages(
    data.observations.filter(r => r.issuer === issuer.code)
  );
  for (let year = 2013; year <= 2025; year++) {
    const origin = `${year}-07-01`,
      proposal = forecastQuality({ observations, origin });
    for (
      let horizon = 1;
      horizon <= 5 && year + horizon - 1 <= 2025;
      horizon++
    ) {
      const targetYear = year + horizon - 1;
      const row: Case = {
        issuer: issuer.code,
        sector: issuer.sector,
        origin,
        horizon,
        targetYear,
        split:
          targetYear <= 2021
            ? "development"
            : targetYear === 2022
              ? "validation"
              : "locked_test",
        status: "excluded",
        reason: proposal.reason,
      };
      const f = proposal.forecasts.find(p => p.horizon === horizon);
      const target = observations
        .filter(
          o => o.fiscalYear === targetYear && o.publishedOn <= data.acquiredOn
        )
        .at(-1);
      if (!f) {
        cases.push(row);
        continue;
      }
      row.trainingIds = proposal.trainingIds;
      if (!target) {
        row.reason = "missing_retained_target_vintage";
        cases.push(row);
        continue;
      }
      const last = observations.find(
        o => o.id === proposal.trainingIds.at(-1)
      )!;
      if (
        target.currency !== last.currency ||
        target.definition !== last.definition
      ) {
        row.reason = "target_currency_or_definition_change";
        cases.push(row);
        continue;
      }
      Object.assign(row, {
        status: "scored",
        reason: null,
        targetId: target.id,
        actual: target.value,
        scale: last.value,
        predictions: { ...f.predictions, adaptive_v2: f.prediction },
        selectedModel: f.selectedModel,
        selectionErrors: f.selectionErrors,
        calibrationErrors: f.calibrationErrors,
        interval: f.interval,
      });
      cases.push(row);
    }
  }
}
const mean = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y),
    m = Math.floor(b.length / 2);
  return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : null;
};
const error = (r: Case, m: ScoredModel) =>
  Math.abs(r.predictions![m]! - r.actual!) / r.scale!;
const macro = (rows: Case[], model: ScoredModel) =>
  mean(
    [...new Set(rows.map(r => r.issuer))]
      .map(code =>
        mean(
          rows
            .filter(r => r.issuer === code && r.predictions?.[model] != null)
            .map(r => error(r, model))
        )
      )
      .filter((v): v is number => v !== null)
  );
function score(rows: Case[]) {
  const scored = rows.filter(r => r.status === "scored");
  return scoredModels.map(model => {
    const eligible = scored.filter(r => r.predictions?.[model] != null);
    const positive = eligible.filter(r => r.actual! > 0);
    const intervals =
      model === "adaptive_v2"
        ? eligible.filter(r => r.interval !== null && r.interval !== undefined)
        : [];
    return {
      model,
      count: eligible.length,
      abstentions: scored.length - eligible.length,
      issuerCount: new Set(eligible.map(r => r.issuer)).size,
      macroScaledAbsoluteErrorPercent: eligible.length
        ? macro(eligible, model)! * 100
        : null,
      meanScaledAbsoluteErrorPercent: eligible.length
        ? mean(eligible.map(r => error(r, model)))! * 100
        : null,
      medianScaledAbsoluteErrorPercent: median(
        eligible.map(r => error(r, model) * 100)
      ),
      mapePercent: mean(
        positive.map(
          r => (Math.abs(r.predictions![model]! - r.actual!) / r.actual!) * 100
        )
      ),
      mapeCount: positive.length,
      intervalCount: intervals.length,
      intervalCoveragePercent:
        mean(
          intervals.map(
            r =>
              +(
                r.actual! >= r.interval!.lower && r.actual! <= r.interval!.upper
              )
          )
        ) === null
          ? null
          : mean(
              intervals.map(
                r =>
                  +(
                    r.actual! >= r.interval!.lower &&
                    r.actual! <= r.interval!.upper
                  )
              )
            )! * 100,
      meanIntervalWidthPercentOfBase: mean(
        intervals.map(
          r => ((r.interval!.upper - r.interval!.lower) / r.scale!) * 100
        )
      ),
    };
  });
}
const summaries = ["development", "validation", "locked_test"].flatMap(split =>
  [1, 2, 3, 4, 5].map(horizon => {
    const subset = cases.filter(
      r => r.split === split && r.horizon === horizon
    );
    const reasons = Object.fromEntries(
      [
        ...new Set(
          subset.filter(r => r.status === "excluded").map(r => r.reason!)
        ),
      ]
        .sort()
        .map(reason => [reason, subset.filter(r => r.reason === reason).length])
    );
    return {
      split,
      horizon,
      attempted: subset.length,
      excluded: subset.filter(r => r.status === "excluded").length,
      reasons,
      scores: score(subset),
    };
  })
);
const test = cases.filter(
  r => r.split === "locked_test" && r.horizon === 1 && r.status === "scored"
);
const paired = test.filter(
  r =>
    r.predictions!.adaptive_v2 !== null &&
    r.predictions!.filinglens_growth_v1 !== null &&
    r.predictions!.naive !== null
);
const sectors = [...new Set(data.cohort.map(r => r.sector))]
  .sort()
  .map(sector => {
    const rows = test.filter(r => r.sector === sector),
      n = new Set(rows.map(r => r.issuer)).size;
    return {
      sector,
      cohortIssuers: data.cohort.filter(r => r.sector === sector).length,
      testIssuers: n,
      evidence: n >= 3 ? "measured_sample" : "insufficient_issuers",
      scores: score(rows),
    };
  });
const legacy = macro(paired, "filinglens_growth_v1"),
  adaptive = macro(paired, "adaptive_v2"),
  naive = macro(paired, "naive");
const gates = [
  {
    name: "At least 30 paired test issuers",
    pass: new Set(paired.map(r => r.issuer)).size >= 30,
  },
  {
    name: "At least 100 paired one-year test cases",
    pass: paired.length >= 100,
  },
  {
    name: "Six sectors with at least three test issuers",
    pass: sectors.filter(r => r.testIssuers >= 3).length >= 6,
  },
  {
    name: "Macro error at least 5% below legacy",
    pass: adaptive !== null && legacy !== null && adaptive <= legacy * 0.95,
  },
  {
    name: "Macro error no more than 5% above naive",
    pass: adaptive !== null && naive !== null && adaptive <= naive * 1.05,
  },
];
const byIssuer = data.cohort.map(i => {
  const rows = test.filter(r => r.issuer === i.code);
  return { ...i, testCases: rows.length, scores: score(rows) };
});
const worstCases = [...test]
  .sort((a, b) => error(b, "adaptive_v2") - error(a, "adaptive_v2"))
  .slice(0, 12);
const qualification = {
  status: gates.every(g => g.pass)
    ? "qualified_in_declared_cohort"
    : "failed_replacement_gate",
  qualifiedHorizons: gates.every(g => g.pass) ? [1] : [],
  scope:
    "Historical annual consolidated revenue in this fixed CVM cohort, July 1 origins; one-year only. No automatic transfer to another issuer, calendar, driver or edited scenario.",
  gates,
  pairedCases: paired.length,
  pairedIssuers: new Set(paired.map(r => r.issuer)).size,
  legacyMacroErrorPercent: legacy === null ? null : legacy * 100,
  adaptiveMacroErrorPercent: adaptive === null ? null : adaptive * 100,
  naiveMacroErrorPercent: naive === null ? null : naive * 100,
  relativeImprovementVsLegacyPercent:
    legacy && adaptive !== null ? (1 - adaptive / legacy) * 100 : null,
  pairedWinsTiesLossesVsLegacy: {
    wins: paired.filter(
      r => error(r, "adaptive_v2") < error(r, "filinglens_growth_v1") - 1e-10
    ).length,
    ties: paired.filter(
      r =>
        Math.abs(error(r, "adaptive_v2") - error(r, "filinglens_growth_v1")) <=
        1e-10
    ).length,
    losses: paired.filter(
      r => error(r, "adaptive_v2") > error(r, "filinglens_growth_v1") + 1e-10
    ).length,
  },
};
const summary = {
  schemaVersion: "forecast-cohort-evaluation.v2",
  acquiredOn: data.acquiredOn,
  protocolCommit: data.protocolCommit,
  protocolSha256: createHash("sha256")
    .update(readFileSync("docs/forecast-qualification-protocol.md"))
    .digest("hex"),
  engineSha256: createHash("sha256")
    .update(readFileSync("contracts/forecast-qualification.ts"))
    .digest("hex"),
  datasetSha256: createHash("sha256").update(bytes).digest("hex"),
  eligible2018Count: data.eligible2018Count,
  cohortSize: data.cohort.length,
  observationCount: data.observations.length,
  qualification,
  summaries,
  sectors,
  byIssuer,
  worstCases,
  limitations: [
    "Fixed historical Brazilian CVM reporting cohort; not a representative global universe.",
    "Retained regulatory vintages may be revised. Exact receipt cutoffs prevent known future revisions from entering training; missing original vintages reduce coverage.",
    "2018 eligibility restricts the universe to companies reporting in that year. No future completeness or current listing filter was used.",
    "The 2018 cohort is reconstructed from rows retained today; loss of original versions and amendment attrition may bias eligibility. This is not a contemporaneously archived universe.",
    "Locked targets FY2023–2025; July 1 origins; overlapping multi-year errors are dependent. No significance claim.",
    "Revenue only. No evidence for margins, earnings, cash flow, valuation, stock returns, arbitrary fiscal calendars or edited drivers.",
    "Empirical 80% bands are not probability guarantees; coverage and missing intervals must be read separately.",
    "Current sector classifications are descriptive and may differ from historical classifications.",
  ],
  attribution:
    "CVM DFP and issuer register; derivative database ODbL 1.0, see data/LICENSE-CVM.md.",
};
mkdirSync("src/data", { recursive: true });
mkdirSync("public/evaluations", { recursive: true });
writeFileSync(
  "src/data/forecast-qualification-summary.json",
  JSON.stringify(summary, null, 2) + "\n"
);
writeFileSync(
  "public/evaluations/forecast-qualification-v2.json",
  JSON.stringify({ ...summary, cases }, null, 2) + "\n"
);
console.log(
  JSON.stringify(
    {
      qualification,
      oneYear: summaries.filter(s => s.horizon === 1),
      sectors: sectors.map(s => ({
        sector: s.sector,
        testIssuers: s.testIssuers,
      })),
    },
    null,
    2
  )
);
