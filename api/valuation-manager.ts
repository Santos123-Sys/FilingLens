import type { CompsValuationResult, DcfValuationResult, FilingAnalysis, ValuationAssumption, ValuationMethod, ValuationReconciliation } from "../contracts/analysis";
import { calculateComps, prepareComps } from "./valuation/comps";
import type {TradingPeerSnapshot} from "../contracts/trading-comps-eligibility";
import { calculateDcf, prepareDcf } from "./valuation/dcf";
export { ValuationGateError, ValuationInputError } from "./valuation/common";

export async function prepareValuation(analysis:FilingAnalysis, method:ValuationMethod, tradingSnapshots?:TradingPeerSnapshot[], options?: { metric?: "EV/EBITDA" | "EV/Revenue" | "P/E"; fiscalToleranceDays?: number; issuerPeriodEnd?: string }) {
  return method === "dcf" ? prepareDcf(analysis) : prepareComps(analysis,tradingSnapshots,options);
}
export function calculateValuation(analysis:FilingAnalysis, method:ValuationMethod, assumptions:ValuationAssumption[]) {
  return method === "dcf" ? calculateDcf(analysis,assumptions) : calculateComps(analysis,assumptions);
}
export function reconcileValuations(dcf:DcfValuationResult|undefined, comps:CompsValuationResult|undefined, thresholdPercent=20):ValuationReconciliation {
  const d=dcf?.figures.implied_per_share.value??null,c=comps?.figures.implied_per_share.value??null;
  if(d===null||c===null||d<=0||c<=0) return {status:"unavailable",dcf_per_share:d,comps_per_share:c,divergence_percent:null,threshold_percent:thresholdPercent,notes:["Both validated DCF and comps per-share values are required before triangulation can be assessed."]};
  const divergence=Math.abs(d-c)/((d+c)/2)*100, divergent=divergence>thresholdPercent;
  return {status:divergent?"divergent":"aligned",dcf_per_share:d,comps_per_share:c,divergence_percent:Number(divergence.toFixed(2)),threshold_percent:thresholdPercent,notes:divergent?[`DCF and comps diverge by ${divergence.toFixed(1)}%, above the ${thresholdPercent}% review threshold.`,`Review WACC, terminal growth and long-run operating margins on the DCF side, then peer selection and selected trading multiple on the comps side.`,`Reconciliation identifies assumptions to revisit; it does not choose a preferred method.`]:[`DCF and comps are within the ${thresholdPercent}% triangulation threshold.`,`Alignment does not validate assumptions independently; accepted ledgers remain the audit trail.`]};
}
