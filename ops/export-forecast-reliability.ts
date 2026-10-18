import { readFileSync, writeFileSync } from "node:fs";
const report = JSON.parse(
  readFileSync("src/data/five-year-qualification-summary.json", "utf8")
);
const { acquiredOn, datasetSha256, engineSha256 } = report;
writeFileSync(
  "src/data/forecast-reliability-policy.json",
  JSON.stringify(
    {
      acquiredOn,
      datasetSha256,
      engineSha256,
      summaries: report.summaries.map(
        (s: (typeof report.summaries)[number]) => ({
          horizon: s.horizon,
          gates: s.gates,
          scores: s.scores.filter(
            (r: { model: string }) => r.model === "bounded_v3"
          ),
          intervalUsefulness: s.intervalUsefulness,
          intervalCoveragePercent: s.intervalCoveragePercent,
          medianIntervalWidthPercent: s.medianIntervalWidthPercent,
        })
      ),
    },
    null,
    2
  ) + "\n"
);
