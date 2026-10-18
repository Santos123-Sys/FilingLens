import evidence from "../src/data/forecast-reliability-policy.json";
import type { FiveYearPlan } from "./five-year-forecast";

export const FORECAST_RELIABILITY_POLICY = "forecast-reliability.v1" as const;
/** Deployment policy, not a retuned predictor or a guarantee about an individual issuer. */
export function horizonReliability(horizon: number, canonical: boolean) {
  const row = evidence.summaries.find(r => r.horizon === horizon);
  const pointPass = !!row && row.gates.every(g => g.pass);
  const precisionPass =
    !!row && row.intervalUsefulness === "passes_project_precision_gate";
  return {
    policyVersion: FORECAST_RELIABILITY_POLICY,
    status: !canonical
      ? "unverified_input_scenario_only"
      : pointPass && precisionPass
        ? "historical_cohort_precision_only"
        : "planning_only_precision_gate_failed",
    pointComparisonPassed: pointPass,
    historicalPrecisionPassed: precisionPass,
    activeBandAllowed: canonical && pointPass && precisionPass,
    futureAccuracyProven: false as const,
    issuerSpecificAccuracyProven: false as const,
    automaticForecastPublicationAllowed: false as const,
    evidenceAssessedOn: evidence.acquiredOn,
    evidenceTargets:
      "FY2023–2025; retrospective issuer-held-out, not prospective",
    macroScaledErrorPercent:
      row?.scores.find(s => s.model === "bounded_v3")
        ?.macroScaledAbsoluteErrorPercent ?? null,
    observedBandCoveragePercent: row?.intervalCoveragePercent ?? null,
    medianBandWidthPercent: row?.medianIntervalWidthPercent ?? null,
    nextAction: !canonical
      ? "Verify publication vintages; keep this as an analyst scenario."
      : precisionPass
        ? "Review issuer drivers; cohort precision does not establish future accuracy."
        : "Use documented analyst scenarios for this year; no qualified empirical band. New accuracy claims require untouched or prospectively frozen evidence.",
  };
}

/** Preserve frozen research reports; withhold failed bands at the serving boundary. */
export function applyForecastReliability(
  plan: FiveYearPlan,
  canonical: boolean
) {
  return {
    ...plan,
    reliabilityPolicy: FORECAST_RELIABILITY_POLICY,
    rows: plan.rows.map(row => {
      const reliability = horizonReliability(row.horizon, canonical);
      return {
        ...row,
        reliability,
        band: reliability.activeBandAllowed
          ? row.band
          : {
              ...row.band,
              interval: null,
              status: canonical
                ? "withheld_failed_horizon_precision_gate"
                : "unverified_history_no_calibration",
            },
      };
    }),
  };
}

/** Defensive presentation/export gate also handles older model responses. */
export function usablePlanningBand(
  plan: FiveYearPlan | undefined,
  index: number,
  edited: boolean
) {
  if (!plan || edited || !horizonReliability(index + 1, true).activeBandAllowed)
    return null;
  return plan.rows[index]?.band.interval ?? null;
}
