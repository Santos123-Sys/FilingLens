import type { ValuationAssumption } from "./analysis";

export const REVENUE_PROPOSAL_LIMITATION =
  "Forecast planning v3: no automatic proposal. This analysis does not retain the exact per-year publication vintages required for issuer-specific calibration. Source cutoff and error band unavailable. Use the five-year planning workspace to build and explicitly review a documented scenario. Fresh CVM comparison gates are assessed separately for years 1–5; they do not validate this issuer or edited drivers. Analyst acceptance does not prove future accuracy.";

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
