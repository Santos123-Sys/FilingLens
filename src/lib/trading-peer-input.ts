import type { TradingPeerSnapshot } from "@contracts/trading-comps-eligibility";

export function emptyTradingPeer(name = ""): TradingPeerSnapshot {
  return { name, currency: "USD", basis: "us_gaap", consolidated: false, quotation_date: "",
    financial_period_start: "", financial_period_end: "", financial_period_kind: "FY", debt_as_of: "",
    market_cap_millions: null, net_debt_millions: null, minority_interest_millions: null, preferred_equity_millions: null,
    ebitda_millions: null, revenue_millions: null, net_income_millions: null,
    quotation_source_url: "", financial_source_url: "" };
}
