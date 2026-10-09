import { annualBasis, moneyBasis } from "./basis";
import { discountCashFlows } from "../../vendor/financetoolkit/valuation";
import type { DcfProjection, DcfValuationResult, FilingAnalysis, ValuationAssumption } from "../../contracts/analysis";
import { ValuationInputError, capexPct, costDebt, daPct, ebitMargin, makeAssumption, netDebt, num, nwcPct, revenueGrowth, range, round, shares, taxRate, text, validatedRows } from "./common";

export function prepareDcf(a: FilingAnalysis) {
  const growth = revenueGrowth(a), margin = ebitMargin(a);
  const basis = annualBasis(a);
  const currency = moneyBasis(a.financials.unit)?.currency ?? null;
  const unit = `${currency ?? "Currency"} millions`;
  const assumptions: ValuationAssumption[] = [
    makeAssumption("dcf", "dcf.currency", "baseline", "Reporting currency", currency, null, "All amounts are in millions of this currency. No FX is inferred.", currency ? "high" : "low", "high"),
    makeAssumption("dcf", "dcf.base_period", "baseline", "Annual forecast base period", basis?.period ?? null, null, "Confirm an annual FY period. Quarter and YTD values must not seed annual forecasts.", basis ? "high" : "low", "high"),
    makeAssumption("dcf", "dcf.base_revenue", "baseline", "Annual base revenue", basis?.value("revenue") ?? null, unit, "Annual filing revenue normalized to millions; enter a documented annual base if unavailable.", basis ? "high" : "low", "high"),
    makeAssumption("dcf", "dcf.equity_adjustment", "equity_bridge", "Other equity bridge adjustments", null, unit, "Enter nonoperating assets minus preferred equity/minority interest; explicitly enter 0 if none. Exclude cash already in net debt.", "low", "high"),
  ];
  for (let i = 0; i < 5; i++) {
    assumptions.push(makeAssumption("dcf", `dcf.revenue_growth_y${i + 1}`, "operating_forecast", `Revenue growth — Year ${i + 1}`, growth === null ? null : round(growth * (1 - i * 0.15)), "%", growth === null ? "No filing-derived baseline; enter and validate." : "Mechanical taper from latest filing-derived revenue growth; not management guidance.", growth === null ? "low" : "medium", "high"));
    assumptions.push(makeAssumption("dcf", `dcf.ebit_margin_y${i + 1}`, "operating_forecast", `EBIT margin — Year ${i + 1}`, margin, "%", margin === null ? "No filing-derived baseline; enter and validate." : "Starts from latest filing-derived EBIT margin and remains flat until edited.", margin === null ? "low" : "medium", "high"));
  }
  const derived = [
    ["dcf.tax_rate", "Cash tax rate", taxRate(a), "%", "Annual income-tax expense / annual pre-tax income is an effective-tax proxy; review a forward cash-tax rate."],
    ["dcf.da_pct_revenue", "D&A as % of revenue", daPct(a), "%", "EBITDA less EBIT divided by revenue."],
    ["dcf.capex_pct_revenue", "Capex as % of revenue", capexPct(a), "%", "Latest absolute capex divided by revenue."],
    ["dcf.nwc_pct_revenue", "Operating NWC as % of revenue", nwcPct(a), "%", "(A/R + inventory − A/P) divided by revenue."],
    ["dcf.pre_tax_cost_debt", "Pre-tax cost of debt", costDebt(a), "%", "Interest expense divided by debt."],
    ["dcf.net_debt", "Net debt", netDebt(a), unit, "Annual balance sheet debt less unrestricted cash, normalized to millions."],
    ["dcf.shares_outstanding", "Shares outstanding", shares(a), "million shares", "Annual net income / diluted EPS estimates weighted-average diluted shares in millions. Replace with valuation-date diluted shares and review option dilution."],
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
  for (const row of assumptions) {
    const metric = row.id.includes("revenue") ? "revenue" : row.id.includes("ebit_margin") ? "ebit" : row.id.includes("capex") ? "capex" : row.id.includes("net_debt") ? "totalDebt" : null;
    if (metric && row.proposed_value !== null) row.source = a.financials.evidence?.find(e => e.metric === metric)?.source;
  }
  return { method: "dcf" as const, status: "awaiting_validation" as const, assumptions, notes: ["No DCF value is produced until every required assumption is accepted or edited. Amounts use millions; shares use millions.", "Annual FY inputs only; market forecasts are proposals rather than issuer guidance. Review the normalized base, discount rate and equity bridge before calculating."] };
}

type Inputs = { start: number; growth: number[]; margins: number[]; tax: number; da: number; capex: number; nwc: number; wacc: number; g: number };
function project(x: Inputs) {
  x.growth.forEach(value => range(value, "scenario_growth", -0.99, 3));
  x.margins.forEach(value => range(value, "scenario_margin", -1, 1));
  const start = x.start;
  if (start <= 0) throw new ValuationInputError("annual_revenue_must_be_positive");
  let revenue = start, previousNwc = start * x.nwc;
  const rows: DcfProjection[] = [];
  for (let i = 0; i < 5; i++) {
    revenue *= 1 + x.growth[i]; const ebit = revenue * x.margins[i]; const nopat = ebit * (1 - x.tax);
    const dAndA = revenue * x.da, capex = revenue * x.capex, nwc = revenue * x.nwc, changeNwc = nwc - previousNwc;
    const fcff = nopat + dAndA - capex - changeNwc; previousNwc = nwc;
    rows.push({ year: `Y${i + 1}`, revenue, ebit_margin: x.margins[i] * 100, ebit, nopat, d_and_a: dAndA, capex, change_nwc: changeNwc, fcff });
  }
  if (x.wacc <= x.g) throw new ValuationInputError("wacc_must_exceed_terminal_growth");
  const discounted = discountCashFlows(rows.map(row => row.fcff), x.wacc, x.g);
  return { rows, tv: discounted.terminalValue, pvTv: discounted.presentTerminalValue, ev: discounted.enterpriseValue };

}

export function calculateDcf(a: FilingAnalysis, assumptions: ValuationAssumption[]): DcfValuationResult {
  const r = validatedRows("dcf", assumptions);
  if (text(r, "dcf.terminal_method") !== "perpetuity_growth") throw new ValuationInputError("unsupported_terminal_method");
  if (text(r, "dcf.sbc_treatment") !== "expense_as_reported") throw new ValuationInputError("unsupported_sbc_treatment");
  const currency = text(r, "dcf.currency");
  if (!["USD", "BRL", "EUR", "GBP", "CHF"].includes(currency)) throw new ValuationInputError("unsupported_valuation_currency");
  if (!/^(?:FY\s*)?20\d{2}$/.test(text(r, "dcf.base_period"))) throw new ValuationInputError("annual_base_period_required");
  const start = num(r, "dcf.base_revenue");
  range(start, "annual_revenue", 0.000001, 1e10);
  const growth = Array.from({ length: 5 }, (_, i) => range(num(r, `dcf.revenue_growth_y${i + 1}`), "revenue_growth", -99, 300) / 100);
  const margins = Array.from({ length: 5 }, (_, i) => range(num(r, `dcf.ebit_margin_y${i + 1}`), "ebit_margin", -100, 100) / 100);
  const tax = num(r, "dcf.tax_rate") / 100, da = num(r, "dcf.da_pct_revenue") / 100, capex = num(r, "dcf.capex_pct_revenue") / 100, nwc = num(r, "dcf.nwc_pct_revenue") / 100;
  const rf = num(r, "dcf.risk_free_rate") / 100, beta = num(r, "dcf.beta"), erp = num(r, "dcf.equity_risk_premium") / 100, cod = num(r, "dcf.pre_tax_cost_debt") / 100, dw = num(r, "dcf.debt_weight") / 100;
  const wacc = (1 - dw) * (rf + beta * erp) + dw * cod * (1 - tax), g = num(r, "dcf.terminal_growth") / 100;
  range(tax, "tax", 0, 1); range(da, "da", 0, 1); range(capex, "capex", 0, 1); range(nwc, "nwc", -1, 2);
  range(rf, "risk_free_rate", 0, 0.5); range(beta, "beta", 0, 5); range(erp, "erp", 0, 0.3); range(cod, "cost_debt", 0, 0.5); range(dw, "debt_weight", 0, 1);
  range(wacc, "wacc", 0.0001, 1); range(g, "terminal_growth", -0.05, 0.1);
  const adjustment = num(r, "dcf.equity_adjustment");
  const debt = num(r, "dcf.net_debt"), sh = num(r, "dcf.shares_outstanding"); if (sh <= 0) throw new ValuationInputError("shares_must_be_positive");
  const core = project({ start, growth, margins, tax, da, capex, nwc, wacc, g }); const equity = core.ev - debt + adjustment; const perShare = equity / sh;
  const wGrid = [-2,-1,0,1,2].map(d => wacc + d * 0.005), gGrid = [-2,-1,0,1,2].map(d => g + d * 0.0025);
  const sensitivity = wGrid.map(w => gGrid.map(tg => { try { return round((project({start,growth,margins,tax,da,capex,nwc,wacc:w,g:tg}).ev - debt + adjustment) / sh, 2); } catch { return null; } }));
  const gs = num(r,"dcf.scenario_growth_spread")/100, ms = num(r,"dcf.scenario_margin_spread")/100, ws = num(r,"dcf.scenario_wacc_spread")/100, ts = num(r,"dcf.scenario_terminal_spread")/100;
  const scenario = (sign: number) => { try { const c = project({start,growth:growth.map(v=>v+sign*gs),margins:margins.map(v=>v+sign*ms),tax,da,capex,nwc,wacc:wacc-sign*ws,g:g+sign*ts}); return round((c.ev-debt+adjustment)/sh,2);} catch {return null;} };
    [gs, ms, ws, ts].forEach((spread, i) => range(spread, `scenario_spread_${i}`, 0, 0.1));
  const ids = assumptions.filter(x => x.status !== "rejected").map(x => x.id); const unit = `${currency}/share`;
  const moneyUnit = `${currency} millions`;
  return { method:"dcf", status:"complete", projections:core.rows.map(x=>({...x,revenue:round(x.revenue),ebit_margin:round(x.ebit_margin),ebit:round(x.ebit),nopat:round(x.nopat),d_and_a:round(x.d_and_a),capex:round(x.capex),change_nwc:round(x.change_nwc),fcff:round(x.fcff)})), figures:{ wacc:{value:round(wacc*100),unit:"%",assumption_ids:["dcf.risk_free_rate","dcf.beta","dcf.equity_risk_premium","dcf.pre_tax_cost_debt","dcf.debt_weight","dcf.tax_rate"]}, terminal_growth:{value:round(g*100),unit:"%",assumption_ids:["dcf.terminal_growth"]}, terminal_value:{value:round(core.tv),unit:moneyUnit,assumption_ids:ids}, enterprise_value:{value:round(core.ev),unit:moneyUnit,assumption_ids:ids}, equity_value:{value:round(equity),unit:moneyUnit,assumption_ids:ids}, implied_per_share:{value:round(perShare),unit,assumption_ids:ids}}, sensitivity:{wacc:wGrid.map(v=>round(v*100)),terminal_growth:gGrid.map(v=>round(v*100)),values:sensitivity}, scenarios:{bull:{value:scenario(1),unit,assumption_ids:ids},base:{value:round(perShare),unit,assumption_ids:ids},bear:{value:scenario(-1),unit,assumption_ids:ids}}, notes:[`Annual base ${text(r, "dcf.base_period")}: ${start} ${moneyUnit}; diluted shares ${sh} million.`, "FCFF = NOPAT + D&A − capex − change in operating NWC.", `Discounted terminal value represents ${core.ev > 0 ? round(core.pvTv / core.ev * 100) : "unavailable"}% of enterprise value; review terminal assumptions and sustainable reinvestment.`, "Equity = enterprise value − net debt + other bridge adjustments. Negative equity is retained, not floored.","WACC uses validated CAPM and debt-cost inputs.","SBC treatment remains an explicit governance assumption; no separate numerical SBC adjustment is made unless filing data isolates it."] };
}
