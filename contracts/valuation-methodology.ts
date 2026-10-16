import type { FilingAnalysis } from "./analysis";

/** Suitability guidance, not an automatic claim that sector membership validates a model. */
export function fcffSuitability(a: FilingAnalysis) {
  const industry = a.market?.industry ?? "";
  const sic = Number(a.metadata?.sicCode);
  const specialized =
    /\bbank(?:ing|s)?\b|insurance|insurer|\bREIT\b|real estate investment trust|broker.dealer|financial services|credit institution|segurador|banc[aá]ri/i.test(
      industry
    ) ||
    (sic >= 6000 && sic < 6500) ||
    sic === 6798;
  return {
    supported: !specialized,
    industry:
      industry || "Unclassified operating company — analyst review required",
    method: specialized
      ? "Equity cash flow, dividends, residual income, or NAV — specialized workflow required"
      : "Five-year nominal FCFF / WACC, end-year discounting",
    limitations: specialized
      ? [
          "Industrial FCFF is blocked. Debt, regulatory capital, or property-level cash flows require a specialized model.",
        ]
      : [
          "Confirm operating-company suitability; sector classification alone is insufficient.",
          "No integrated balance-sheet forecast, tax-loss schedule, lease recast, or R&D capitalization is modeled.",
          "Energy, commodities, utilities and early-stage firms require cycle, reserve, regulatory or financing schedules outside this workflow.",
        ],
  };
}
