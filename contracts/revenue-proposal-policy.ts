import type { ValuationAssumption } from "./analysis";

export const REVENUE_PROPOSAL_LIMITATION =
  "Forecast qualification v2: no automatic proposal. This analysis does not retain the exact per-year publication vintages required for issuer-specific selection and calibration. Source cutoff and error band unavailable. The CVM cohort qualifies only a one-year historical revenue comparison; it does not validate this issuer, longer horizons or edited drivers. Enter a documented scenario and review it; analyst acceptance does not prove predictive accuracy.";

/** Old, unreviewed saved proposals must not evade the current evidence gate. */
export function reviewableDcfAssumptions(rows: ValuationAssumption[]) {
  return rows.map(row =>
    /^dcf\.revenue_growth_y[1-5]$/.test(row.id) && row.status === "proposed"
      ? {
          ...row,
          proposed_value: null,
          final_value: undefined,
          confidence: "low" as const,
          rationale: REVENUE_PROPOSAL_LIMITATION,
        }
      : row
  );
}
