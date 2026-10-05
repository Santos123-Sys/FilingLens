# Filing-based dashboard indicator selection

Reviewed 2026-10-02. FilingLens explains SEC/CVM uploads; it is not a quote terminal. The same statement-based arithmetic works for Brazilian and US nonfinancial companies when currency units, scope and reporting duration align. IFRS/US GAAP cash-flow classification differences limit cross-company comparisons.

## Comparison and selection

| Reference project | Relevant features observed | FilingLens decision |
| --- | --- | --- |
| [Stock Analysis](https://stockanalysis.com/stocks/aapl/financials/ratios/) | Historical liquidity, leverage, asset efficiency and return ratios alongside market multiples | Add filing-only liquidity/leverage and asset turnover; omit price-dependent multiples |
| [ROIC.ai](https://www.roic.ai/api) | Separate profitability, credit/debt, liquidity and working-capital groups | Group complementary indicators by profitability/efficiency, cash and liquidity/debt |
| [AlphaSpread](https://www.alphaspread.com/security/nasdaq/aapl/profitability) | Margins, capital returns and free cash flow | Surface gross/EBIT/FCF margins; avoid unsupported sector-independent scores |

## New metrics

- Net working capital: current assets less current liabilities. Balance-sheet measure, not operating working capital.
- Cash/current-liability coverage: unrestricted cash and equivalents divided by current liabilities. Excludes separately disclosed investments; this narrower measure is not the CFA cash ratio or quick ratio.
- Debt/equity: interest-bearing debt divided by positive equity.
- Debt/assets: interest-bearing debt divided by positive assets, percentage.
- Short-term debt share: short-term debt divided by positive total debt, percentage. Reject negative or greater-than-total short-term debt.
- Asset turnover: annual revenue divided by average opening/closing assets. Requires consecutive explicit fiscal-year labels; quarterly/YTD series are not annualized.
- Operating cash flow margin: OCF divided by positive revenue, percentage.
- Earnings cash conversion: OCF divided by positive net income. Not meaningful for losses or zero earnings.
- CAPEX intensity: absolute cash capital expenditure divided by positive revenue, percentage.

Already calculated metrics now surfaced: gross margin, EBIT margin, FCF margin, FCF/EBITDA and gross debt/EBITDA. FCF here is reported FCF or OCF minus cash CAPEX, not necessarily FCFF/FCFE. EBITDA-based ratios use disclosed period EBITDA, not adjusted EBITDA or inferred TTM values.

## Evidence and missing data

Use aligned inputs only. No substitution of zero for missing data. Dashboard cards show the final disclosed period explicitly; prior-period values remain in the historical table. CSV includes complementary metrics and units. The pure shared calculator recomputes metrics from raw data in saved reports and in the analysis pipeline. Reanalysis is needed when original extracted components are absent.

Corporate complementary indicators are suppressed for financial institutions, using the existing industry classifier. ROE/ROA and disclosed regulatory metrics remain the appropriate starting point. The classifier depends on the extracted industry text; it is not a regulatory classification.

Market multiples, dividend yield and valuation require dated market data. Quick ratio and cash conversion cycle require separately sourced investments, receivables, inventory, costs and payable balances. Do not invent them. Dividend payout needs attributable ordinary earnings and common dividends; raw paid distributions are not substituted.

## Methodological sources

- [CFA Institute financial ratio list](https://www.cfainstitute.org/sites/default/files/-/media/documents/support/programs/cfa/cfa_program_level_ii_financial_ratio_list.pdf): liquidity, average-asset turnover, debt definitions and solvency ratios. Definitions can differ in practice; the cash-only measure is explicitly labelled as a variant.
- [CFI: Cash Flow vs Net Income](https://corporatefinanceinstitute.com/resources/accounting/cash-flow-vs-net-income/): cash/accrual distinction and operating cash-flow/net-income comparison.

Validation includes reconciled annual fixtures, missing and mismatched series, zero/negative denominators, debt-scope inconsistencies, legitimate zero debt, nonconsecutive periods, quarterly/YTD exclusion and the complete enriched schema (over 24 metrics, including ROIC's six inputs). These tests verify arithmetic and safeguards; extraction quality still depends on the uploaded document and evidence supplied by the agents.
