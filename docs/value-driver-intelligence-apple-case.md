# Value Driver Intelligence — Apple SEC real-data acceptance case

## Status and scope
This feature adds a deterministic, analyst-controlled, 10-year FCFF valuation engine, a one-at-a-time value-driver materiality ranking, joint bear/base/bull scenarios and a reverse DCF. Access via **Value drivers** in a FilingLens filing dashboard and the standalone **/value-drivers/apple** demonstration route.

**Boundaries:** This is a *reproducible historical-data-backed simulation*, not independent analyst consensus, not a buy/sell recommendation, and not a live market-price terminal. The model reads financials that the existing extraction contract supplies; the UI does not silently perform an unsourced price lookup. An authenticated SEC download is not necessary for the Apple fixture, because the fixture's published sources are pinned.

## Provenance and source separation
All financial amounts below are USD billions converted from the filed USD millions.

| Category | Observed value | Period | Primary source |
|---|---:|---|---|
| Revenue | 416.161 | FY ended 2025-09-27 | [Apple 2025 SEC 10-K, statements of operations](https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm) |
| Operating income | 133.050 | FY2025 | Same 10-K |
| Operating cash flow | 111.482 | FY2025 | Same 10-K, statements of cash flows |
| Cash capex | 12.715 | FY2025 | Same 10-K, PP&E cash payments |
| Mechanical operating cash flow minus cash capex | 98.767 | FY2025 | Calculated from same 10-K; not automatically equal to model FCFF |
| iPhone sales / Services sales | 209.586 / 109.158 | FY2025 | Same 10-K, disaggregated net sales |
| Q3 revenue / iPhone sales / Services sales | 109.417 / 54.252 / 30.739 | Quarter ended 2026-06-27 | [Apple 2026 SEC 10-Q](https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm) |
| Q3 gross margin / tariff refund contribution | 50.1% / approx. 2 percentage points | Q3 FY2026 | Same 10-Q and [issuer results](https://www.apple.com/newsroom/2026/07/apple-reports-third-quarter-results/) |
| YTD revenue / YTD OCF / YTD capex | 364.357 / 116.996 / 6.799 | 9 months to 2026-06-27 | Same 10-Q; never treated as full fiscal year |
| Commercial paper / current term debt / long-term term debt | 1.997 / 11.007 / 71.340 | 2026-06-27 | Same 10-Q, balance sheets |
| Cash / short-term securities / noncurrent securities | 39.544 / 22.855 / 84.118 | 2026-06-27 | Same 10-Q, balance sheets |
| Close | $336.64 | 2026-10-09 | [AAPL price history](https://stockanalysis.com/stocks/aapl/history/) |
| Shares | 14.59418038 billion (vendor) | 2026-10-09 snapshot | [AAPL share statistics](https://stockanalysis.com/stocks/aapl/statistics/) |
| Derived equity market value | 4,912.984883 billion | 2026-10-09 | Closing price × snapshot shares |
| Derived net debt (negative = net cash/securities) | -62.173 | 2026-06-27 | Debt − cash − current/noncurrent marketable securities |
| Mixed-date market enterprise value | 4,850.811883 | 2026-10-09 price + 2026-06-27 balance | Equity market cap + historical net debt; **not same-day EV** |

The October market quote and June balance-sheet values are not as-of-date matched; their difference is disclosed. Live updated shares and debt, minority interests, and non-operating bridge items require a fresh validated source.

## Explicit analyst assumptions, NOT facts
- Starting revenue: FY2025 SEC-reported $416.161B.
- Annual revenue growth: 10% for years 1–5, linearly fading to 3% by year 10.
- EBIT margin: 33% (FY2025 reported EBIT margin ~31.97%).
- Cash tax: 18%; forecast net reinvestment: 17% of modeled NOPAT.
- Discount rate (WACC): 8%. Terminal growth: 3%. Terminal return on new invested capital: 25%.
- Explicit projection: 10 years. Terminal FCFF = terminal NOPAT × (1 − g / terminal ROIC).
- A stock-price estimate is not computed on an uploaded filing without sourced share count and debt bridge. At present market quotes for arbitrary companies are entered manually and require a date and an HTTPS source.

## Equations and independent numerical check
- Year-t forecast revenue = prior-year revenue × (1 + phased growth rate).
- NOPAT = revenue × modeled EBIT margin × (1 − modeled cash tax rate).
- FCFF = NOPAT × (1 − modeled reinvestment rate), for explicit forecast years.
- Enterprise value = sum[FCFF / (1 + WACC)^t] + [terminal FCFF / (WACC − g)] / (1 + WACC)^N.
- Equity value = enterprise value − net debt; value/share = equity / shares.
- Reverse DCF bisects initial growth from -20% to 45%, keeping other assumptions unchanged; reports no solution when outside the bracket.

Reference calculation:
- Present value of forecast FCFF: **$988.591394B**.
- Present value of terminal value: **$2,017.032685B**.
- Modeled EV: **$3,005.624079B**.
- Modeled equity value: **$3,067.797079B**, modeled price **$210.21**.
- Model-implied initial growth at $4,850.811883B market EV: **18.498569%**, not a market-consensus expectation.

## Guardrails, calculation limitations and next steps
1. Never convert single-quarter/YTD figures to annual numbers unless a disclosed comparable annual history is supplied. For uploaded analyses the adapter only reads verified annualHistory or annual forms with clear million-based units.
2. Do not treat capex as total investing cash flow. Annual operating cash flow less cash capex is a *cash flow diagnostic*; it is not identical to modeled FCFF.
3. Preserve exact source URLs and dates. Mark assumptions, market price, and uploaded data separately.
4. Reject nonfinite data, WACC <= perpetual growth, impossible terminal ROIC, unsupported sectors (banks, insurers, REITs) and negative/implausible input ranges.
5. Do not silently clamp invalid sensitivity shocks: show missing sensitivities instead.
6. Sensitivity is NOT a probability-weighted loss distribution. Research priority must also reflect forecast uncertainty, causal mechanism, and whether more research would resolve uncertainty. Each driver supports an explicitly manual uncertainty rating.
7. Apple's 2026 Q3 tariff refund contribution is nonrecurring until demonstrated otherwise. The case warns analysts not to extrapolate the full 50.1% quarterly gross margin.
8. Cost of capital and terminal duration often dominate: the interface exposes terminal value as a proportion of EV to indicate model risk.
9. Model assumptions are editable; the company-level source adapter is intentionally read-only. No LLM can write valuations directly.
10. Known limitations: no native automated live market-price ingestion, no research queue persisted to a database, no probabilistic uncertainties, no cross-driver heatmap, no canonical consensus forecast retrieval, and no sector-specific bank DCF. These are future enhancements, not accomplished deliverables.

## How to verify
```bash
npm ci
npm run check
npm run lint
npm test
npm run build
```
Run the new `contracts/value-driver-intelligence.test.ts` regression suite. It validates source figures, capital bridge, the deterministic DCF, reverse DCF, monotonic economics, and rejection of invalid inputs.

The separate Apple case route can be used before uploading any filing. In a completed filing dashboard, the **Value drivers** tab uses the same core engine when annual revenue + EBIT and financial units are available, while the user enters dated stock quote, shares, and net debt.

## New-filing change signals (event driven)
On each newly completed filing dashboard, the feature compares **annual** series when at least two comparable periods exist. It calculates:

- Reported annual revenue growth (screening threshold: absolute YoY change >= 10%).
- EBIT margin change (absolute change >= 1.5 percentage points).
- Operating cash flow minus cash capex growth (absolute YoY change >= 20%; NOT modeled FCFF).
- Cash capex/revenue change (absolute change >= 1 percentage point).

Every signal is explicitly a **filing observation**, never an attributed cause. Displayed research prompts explain what analysts should investigate. Missing figures do not become zeros. Quarterly or YTD series are excluded unless a distinct historical annual series is provided. These signals refresh when a new filing is analyzed; this is **not** an autonomous scheduler, webhook, price-feed watcher or notification system.

## Actual sell-side aggregate expectations, as published 2026-10-09
External forecast snapshots are deliberately separate from the **source of audited historical results**:
- [Stock Analysis, using S&P Global Market Intelligence / TipRanks](https://stockanalysis.com/stocks/aapl/forecast/): FY2026 revenue forecast **$477.85B** (+14.82% vs historical FY2025), FY2027 **$528.21B** (+10.54% vs FY2026), FY2026 forecast EPS **$8.83**. Its update date was Oct 9, 2026.
- [Yahoo Finance independent consensus display](https://finance.yahoo.com/quote/AAPL/analysis/): approximately 40 analyst estimates for FY2026/FY2027 revenue. Different vendor constituents and timestamps can produce different observations.
- Market-implied DCF growth **18.50%** is calculated from the dated share quote/bridge and 10-year model, not an analyst poll. It refers to the *initial part of the multi-year model* and is **not directly comparable** to an annual FY2026/FY2027 estimate.
- The scenario's 10% growth baseline remains **explicitly analyst-selected**, not relabelled as empirical consensus; the panel provides genuine external forecasts for disciplined comparison. Future implementation can ingest a licensed, date-aligned multi-year forecast curve. A two-year revenue consensus does not identify WACC, long-run reinvestment, terminal ROIC or terminal growth.
