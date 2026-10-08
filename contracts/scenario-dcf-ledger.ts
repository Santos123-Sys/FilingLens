import type {ValuationAssumption} from "./analysis";
import type {DriverScenario} from "./valuation-driver-bridge";
/**
 * Builds independent copies of the approved DCF ledger for controlled scenario
 * reruns. Never modifies the user's accepted base case in place.
 */
export function scenarioDcfLedger(rows:ValuationAssumption[],s:DriverScenario):ValuationAssumption[] {
 if(!rows.length||rows.some(x=>x.method!=="dcf"||(x.status!=="accepted"&&x.status!=="edited"&&x.status!=="rejected")))
  throw new Error("dcf_assumptions_not_approved");
 const seen=new Set<string>();
 const mapped=rows.map(row=>{
  const isGrowth=/^dcf\.revenue_growth_y[1-5]$/.test(row.id);
  const isMargin=/^dcf\.ebit_margin_y[1-5]$/.test(row.id);
  const isCapex=row.id==="dcf.capex_pct_revenue";
  if(!isGrowth&&!isMargin&&!isCapex)return {...row};
  if(row.status==="rejected")throw new Error("required_driver_rejected");
  seen.add(row.id);
  const value=isGrowth?s.revenueGrowthPercent:isMargin?s.ebitMarginPercent:s.capexPercentRevenue;
  if(!Number.isFinite(value))throw new Error("invalid_scenario_value");
  return {...row,status:"edited" as const,final_value:value,
   rationale:`${row.rationale} Analyst-approved ${s.name} scenario override; base ledger unchanged.`};
 });
 const expected=["dcf.capex_pct_revenue",
  ...Array.from({length:5},(_,i)=>`dcf.revenue_growth_y${i+1}`),
  ...Array.from({length:5},(_,i)=>`dcf.ebit_margin_y${i+1}`)];
 if(expected.some(id=>!seen.has(id)))throw new Error("dcf_driver_missing");
 return mapped;
}
