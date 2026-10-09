/**
 * Scalar TypeScript adaptation of FinanceToolkit (MIT, Jeroen Bouma).
 * Pinned upstream: a232ddf84d4bb2da17e5385b7862873b6943c2a8.
 * models/intrinsic_model.py:get_intrinsic_value and
 * ratios/valuation_model.py:get_enterprise_value. See LICENSE.txt and README.md.
 * FilingLens supplies reviewed, nonconstant FCFF forecasts instead of projecting
 * a single growth rate; discount timing and the equity bridge are unchanged.
 */
export function discountCashFlows(flows: number[], wacc: number, growth: number) {
  if (!flows.length || flows.some(v => !Number.isFinite(v)) || !Number.isFinite(wacc) ||
      !Number.isFinite(growth) || wacc <= 0 || growth <= -1 || wacc <= growth) throw new Error("invalid_discount_inputs");
  const terminalValue = flows.at(-1)! * (1 + growth) / (wacc - growth);
  const presentValues = flows.map((flow, i) => flow / (1 + wacc) ** (i + 1));
  const presentTerminalValue = terminalValue / (1 + wacc) ** flows.length;
  const enterpriseValue = presentValues.reduce((sum, pv) => sum + pv, 0) + presentTerminalValue;
  if (![terminalValue, presentTerminalValue, enterpriseValue, ...presentValues].every(Number.isFinite)) throw new Error("nonfinite_valuation");
  return { terminalValue, presentValues, presentTerminalValue, enterpriseValue };
}
export function enterpriseValue(marketCap: number, netDebt: number, minorityInterest = 0, preferredEquity = 0) {
  return marketCap + netDebt + minorityInterest + preferredEquity;
}
