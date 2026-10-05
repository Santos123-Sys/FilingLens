import type { DcfProjection, DcfValuationResult, FilingAnalysis, ValuationAssumption } from "../../contracts/analysis";
import { ValuationInputError, capexPct, costDebt, daPct, ebitMargin, latest, makeAssumption, netDebt, num, nwcPct, revenueGrowth, round, shares, taxRate, text, validatedRows } from "./common";

export function prepareDcf(a: FilingAnalysis) {
  const growth = revenueGrowth(a), margin = ebitMargin(a);
  const assumptions: ValuationAssumption[] = [];
  for (let i = 0; i < 5; i++) {
    assumptions.push(makeAssumption("dcf", `dcf.revenue_growth_y${i + 1}`, "operating_forecast", `Revenue growth — Year ${i + 1}`, growth === null ? null : round(growth * (1 - i * 0.15)), "%", growth === null ? "No filing-derived baseline; enter and validate." : "Mechanical taper from latest filing-derived revenue growth; not management guidance.", growth === null ? "low" : "medium", "high"));
    assumptions.push(makeAssumption("dcf", `dcf.ebit_margin_y${i + 1}`, "operating_forecast", `EBIT margin — Year ${i + 1}`, margin, "%", margin === null ? "No filing-derived baseline; enter and validate." : "Starts from latest filing-derived EBIT margin and remains flat until edited.", margin === null ? "low" : "medium", "high"));
  }
  const derived = [
    ["dcf.tax_rate", "Cash tax rate", taxRate(a), "%", "Latest tax expense divided by pre-tax income."],
    ["dcf.da_pct_revenue", "D&A as % of revenue", daPct(a), "%", "EBITDA less EBIT divided by revenue."],
    ["dcf.capex_pct_revenue", "Capex as % of revenue", capexPct(a), "%", "Latest absolute capex divided by revenue."],
    ["dcf.nwc_pct_revenue", "Operating NWC as % of revenue", nwcPct(a), "%", "(A/R + inventory − A/P) divided by revenue."],
    ["dcf.pre_tax_cost_debt", "Pre-tax cost of debt", costDebt(a), "%", "Interest expense divided by debt."],
    ["dcf.net_debt", "Net debt", netDebt(a), a.financials.unit, "Total debt less cash from the filing."],
    ["dcf.shares_outstanding", "Shares outstanding", shares(a), "shares", "Derived from net income / EPS; validate carefully."],
  ] as const;
  for (const [id, label, value, unit, rationale] of derived) assumptions.push(makeAssumption("dcf", id, id.includes("net_debt") || id.includes("shares") ? "equity_bridge" : "cash_flow", label, value, unit, value === null ? `${rationale} Filing data was insufficient, so user input is required.` : rationale, value === null ? "low" : "medium", id.includes("da_pct") || id.includes("nwc_pct") ? "medium" : "high"));
  assumptions.push(
    makeAssumption("dcf", "dcf.risk_free_rate", "wacc", "Risk-free rate", null, "%", "Market assumption; enter and validate the relevant sovereign risk-free rate.", "low", "high"),
    makeAssumption("dcf", "dcf.beta", "wacc", "Equity beta", null, "x", "Market assumption; enter and validate a beta appropriate for the issuer.", "low", "high"),
    makeAssumption("dcf", "dcf.equity_risk_premium", "wacc", "Equity risk premium", null, "%", "Market assumption; enter and validate ERP.", "low", "high"),
    makeAssumption("dcf", "dcf.debt_weight", "wacc", "Debt weight in capital structure", null, "%", "Capital-structure assumption; enter and validate debt/(debt+equity).", "low", "high"),
    makeAssumption("dcf", "dcf.terminal_method", "terminal", "Terminal method", "perpetuity_growth", null, "Validator currently supports perpetuity-growth terminal value.", "high", "high"),
    makeAssumption("dcf", "dcf.terminal_growth", "terminal", "Terminal growth", null, "%", "Long-run nominal growth must be explicitly validated.", "low", "high"),
    makeAssumption("dcf", "dcf.sbc_treatment", "cash_flow", "SBC treatment", "expense_as_reported", null, "Governance assumption. Current filing contract does not isolate SBC cash-flow effects.", "medium", "medium"),
    makeAssumption("dcf", "dcf.scenario_growth_spread", "scenario", "Bull/Bear growth spread", 2, "pp", "Mechanical scenario spread around validated revenue growth.", "medium", "medium"),
    makeAssumption("dcf", "dcf.scenario_margin_spread", "scenario", "Bull/Bear margin spread", 1, "pp", "Mechanical scenario spread around validated EBIT margin.", "medium", "medium"),
    makeAssumption("dcf", "dcf.scenario_wacc_spread", "scenario", "Bull/Bear WACC spread", 1, "pp", "Mechanical scenario spread around WACC.", "medium", "medium"),
    makeAssumption("dcf", "dcf.scenario_terminal_spread", "scenario", "Bull/Bear terminal growth spread", 0.5, "pp", "Mechanical terminal growth spread.", "medium", "medium"),
  );
  return { method: "dcf" as const, status: "awaiting_validation" as const, assumptions, notes: ["No DCF value is produced until every required assumption is accepted or edited.", "Five-year FCFF, WACC × g sensitivity and Bull/Base/Bear are calculated only after validation."] };
}

type Inputs = { growth: number[]; margins: number[]; tax: number; da: number; capex: number; nwc: number; wacc: number; g: number };
function project(a: FilingAnalysis, x: Inputs) {
  const start = latest(a.financials.revenue);
  if (start === null) throw new ValuationInputError("revenue_required_for_dcf");
  let revenue = start, previousNwc = start * x.nwc;
  const rows: DcfProjection[] = [];
  for (let i = 0; i < 5; i++) {
    revenue *= 1 + x.growth[i]; const ebit = revenue * x.margins[i]; const nopat = ebit * (1 - x.tax);
    const dAndA = revenue * x.da, capex = revenue * x.capex, nwc = revenue * x.nwc, changeNwc = nwc - previousNwc;
    const fcff = nopat + dAndA - capex - changeNwc; previousNwc = nwc;
    rows.push({ year: `Y${i + 1}`, revenue, ebit_margin: x.margins[i] * 100, ebit, nopat, d_and_a: dAndA, capex, change_nwc: changeNwc, fcff });
  }
  if (x.wacc <= x.g) throw new ValuationInputError("wacc_must_exceed_terminal_growth");
  const pv = rows.reduce((s, r, i) => s + r.fcff / Math.pow(1 + x.wacc, i + 1), 0);
  const tv = rows[4].fcff * (1 + x.g) / (x.wacc - x.g); const pvTv = tv / Math.pow(1 + x.wacc, 5);
  return { rows, tv, ev: pv + pvTv };
}

export function calculateDcf(a: FilingAnalysis, assumptions: ValuationAssumption[]): DcfValuationResult {
  const r = validatedRows("dcf", assumptions);
  if (text(r, "dcf.terminal_method") !== "perpetuity_growth") throw new ValuationInputError("unsupported_terminal_method");
  const growth = Array.from({ length: 5 }, (_, i) => num(r, `dcf.revenue_growth_y${i + 1}`) / 100);
  const margins = Array.from({ length: 5 }, (_, i) => num(r, `dcf.ebit_margin_y${i + 1}`) / 100);
  const tax = num(r, "dcf.tax_rate") / 100, da = num(r, "dcf.da_pct_revenue") / 100, capex = num(r, "dcf.capex_pct_revenue") / 100, nwc = num(r, "dcf.nwc_pct_revenue") / 100;
  const rf = num(r, "dcf.risk_free_rate") / 100, beta = num(r, "dcf.beta"), erp = num(r, "dcf.equity_risk_premium") / 100, cod = num(r, "dcf.pre_tax_cost_debt") / 100, dw = num(r, "dcf.debt_weight") / 100;
  const wacc = (1 - dw) * (rf + beta * erp) + dw * cod * (1 - tax), g = num(r, "dcf.terminal_growth") / 100;
  const debt = num(r, "dcf.net_debt"), sh = num(r, "dcf.shares_outstanding"); if (sh <= 0) throw new ValuationInputError("shares_must_be_positive");
  const core = project(a, { growth, margins, tax, da, capex, nwc, wacc, g }); const equity = core.ev - debt; const perShare = equity / sh;
  const wGrid = [-2,-1,0,1,2].map(d => wacc + d * 0.005), gGrid = [-2,-1,0,1,2].map(d => g + d * 0.0025);
  const sensitivity = wGrid.map(w => gGrid.map(tg => { try { return round((project(a,{growth,margins,tax,da,capex,nwc,wacc:w,g:tg}).ev - debt) / sh, 2); } catch { return null; } }));
  const gs = num(r,"dcf.scenario_growth_spread")/100, ms = num(r,"dcf.scenario_margin_spread")/100, ws = num(r,"dcf.scenario_wacc_spread")/100, ts = num(r,"dcf.scenario_terminal_spread")/100;
  const scenario = (sign: number) => { try { const c = project(a,{growth:growth.map(v=>v+sign*gs),margins:margins.map(v=>v+sign*ms),tax,da,capex,nwc,wacc:wacc-sign*ws,g:g+sign*ts}); return round((c.ev-debt)/sh,2);} catch {return null;} };
  const ids = assumptions.filter(x => x.status !== "rejected").map(x => x.id); const unit = `${a.jurisdiction === "br" ? "BRL" : "USD"}/share`;
  return { method:"dcf", status:"complete", projections:core.rows.map(x=>({...x,revenue:round(x.revenue),ebit_margin:round(x.ebit_margin),ebit:round(x.ebit),nopat:round(x.nopat),d_and_a:round(x.d_and_a),capex:round(x.capex),change_nwc:round(x.change_nwc),fcff:round(x.fcff)})), figures:{ wacc:{value:round(wacc*100),unit:"%",assumption_ids:["dcf.risk_free_rate","dcf.beta","dcf.equity_risk_premium","dcf.pre_tax_cost_debt","dcf.debt_weight","dcf.tax_rate"]}, terminal_growth:{value:round(g*100),unit:"%",assumption_ids:["dcf.terminal_growth"]}, terminal_value:{value:round(core.tv),unit:a.financials.unit,assumption_ids:ids}, enterprise_value:{value:round(core.ev),unit:a.financials.unit,assumption_ids:ids}, equity_value:{value:round(equity),unit:a.financials.unit,assumption_ids:ids}, implied_per_share:{value:round(perShare),unit,assumption_ids:ids}}, sensitivity:{wacc:wGrid.map(v=>round(v*100)),terminal_growth:gGrid.map(v=>round(v*100)),values:sensitivity}, scenarios:{bull:{value:scenario(1),unit,assumption_ids:ids},base:{value:round(perShare),unit,assumption_ids:ids},bear:{value:scenario(-1),unit,assumption_ids:ids}}, notes:["FCFF = NOPAT + D&A − capex − change in operating NWC.","WACC uses validated CAPM and debt-cost inputs.","SBC treatment remains an explicit governance assumption; no separate numerical SBC adjustment is made unless filing data isolates it."] };
}
