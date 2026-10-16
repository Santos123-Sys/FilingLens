import { mkdirSync, writeFileSync } from "node:fs";
import reference from "../src/data/forecast-reference.json";
import { evaluateForecasts } from "../contracts/forecast-evaluation";
const reports = ["Apple", "Microsoft"].map(issuer =>
  evaluateForecasts({
    observations: reference.observations.filter(o => o.issuer === issuer),
  })
);
mkdirSync("docs/evaluations", { recursive: true });
writeFileSync(
  "docs/evaluations/forecast-reference-2026-10-16.json",
  JSON.stringify({ retrievedOn: reference.retrievedOn, reports }, null, 2) +
    "\n"
);
console.log(
  JSON.stringify(
    reports.map(r => ({
      issuer: r.issuer,
      scores: r.scores.filter(s => s.horizon === 1),
    })),
    null,
    2
  )
);
