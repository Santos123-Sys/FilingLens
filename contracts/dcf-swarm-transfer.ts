import type { DebateResult, AssumptionEntry } from "./dcf-swarm";
import type { ValuationAssumption } from "./analysis";
const mapping: Record<AssumptionEntry["key"], string[]> = {
  revenue_growth_path: Array.from(
    { length: 5 },
    (_, i) => `dcf.revenue_growth_y${i + 1}`
  ),
  operating_margin: Array.from(
    { length: 5 },
    (_, i) => `dcf.ebit_margin_y${i + 1}`
  ),
  capex_ratio: ["dcf.capex_pct_revenue"],
  nwc_ratio: ["dcf.nwc_pct_revenue"],
  tax_rate: ["dcf.tax_rate"],
  wacc_risk_free: ["dcf.risk_free_rate"],
  wacc_beta: ["dcf.beta"],
  wacc_erp: ["dcf.equity_risk_premium"],
  terminal_method: ["dcf.terminal_method"],
  terminal_growth: ["dcf.terminal_growth"],
};
/** User-selected transfer only. Every affected row requires a fresh acceptance. */
export function transferDebate(
  rows: ValuationAssumption[],
  run: DebateResult,
  key: AssumptionEntry["key"],
  issuerId: string
) {
  if (run.issuerId !== issuerId || run.status !== "needs_human_review")
    throw Error("debate_scope_invalid");
  const proposal = run.consensus?.rows.find(r => r.key === key)?.proposal;
  if (!proposal) throw Error("proposal_missing");
  return rows.map(row =>
    !mapping[key].includes(row.id)
      ? row
      : {
          ...row,
          proposed_value:
            key === "terminal_method" ? "perpetuity_growth" : proposal.value,
          final_value: null,
          status: "proposed" as const,
          rationale: `AI ${proposal.basis}; debate ${run.runId}; source snapshot ${run.snapshotId}. ${proposal.rationale} ${key === "revenue_growth_path" || key === "operating_margin" ? "Flat proposal across all five forecast years; edit each year as needed. " : ""}Human review required; dissent remains in the debate record.`,
        }
  );
}
