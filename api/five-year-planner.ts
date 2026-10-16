import development from "../public/evaluations/forecast-cohort-cvm.json";
import heldOut from "../public/evaluations/five-year-cohort-cvm-v3.json";
import {
  buildDevelopmentCalibration,
  fiveYearPlan,
  planningInputSchema,
} from "../contracts/five-year-forecast";
import { checkedVintages } from "../contracts/forecast-qualification";
const developmentRows = development.cohort.flatMap(i =>
  checkedVintages(development.observations.filter(o => o.issuer === i.code))
);
const pool = buildDevelopmentCalibration(
  developmentRows,
  development.cohort.map(i => i.code)
);
const canonical = new Map<string, string>();
for (const data of [development, heldOut])
  for (const issuer of data.cohort)
    canonical.set(
      issuer.code,
      JSON.stringify(
        checkedVintages(data.observations.filter(o => o.issuer === issuer.code))
      )
    );

export function prepareFiveYearForecast(raw: unknown) {
  const input = planningInputSchema.parse(raw),
    observations = checkedVintages(input.observations);
  const eligible =
    canonical.get(observations[0].issuer) === JSON.stringify(observations);
  const plan = fiveYearPlan(input, eligible ? pool : []);
  return {
    ...plan,
    calibrationEligibility: eligible
      ? "canonical_cvm_replay"
      : "analyst_supplied_not_canonical",
    rows: plan.rows.map(row => ({
      ...row,
      band: eligible
        ? row.band
        : { ...row.band, status: "unverified_history_no_calibration" },
    })),
  };
}
export type PreparedFiveYearForecast = ReturnType<
  typeof prepareFiveYearForecast
>;
