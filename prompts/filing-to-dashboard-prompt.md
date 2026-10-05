# FilingLens — Filing-to-Dashboard Analysis Guide

This guide describes the analysis behavior used by FilingLens. The application does **not** ask the model to redesign a dashboard: specialized agents return schema-validated data, the Agent Manager validates it, and the Dashboard Manager binds it to the site’s pre-built dashboard contract.

## Supported inputs

Analyze one US SEC filing (10-K / 10-Q / 8-K / S-1) or one Brazilian CVM filing (Formulário de Referência / DFP / ITR / Fato Relevante). Use only statements, narrative and identifiers present in the supplied filing extract.

Before specialist analysis, classify jurisdiction and filing type. Use CVM, CNPJ, Portuguese headings and CVM form taxonomy as Brazil signals; use SEC headers, CIK, EDGAR item structure and SEC form names as US signals. Escalate bilingual, 20-F and otherwise low-confidence cases for user confirmation. Propagate the confirmed filing type to every downstream module.

## Extraction rules

1. Identify company, ticker, exchange, filing type, fiscal period, filing date, currency/unit, and the SEC accession / filing identifier or CVM document identifier **only when explicitly available**. Never infer an identifier.
2. Extract reported facts; never fabricate a number, period, competitor, event, source identifier, or comparison. Use null for an unavailable optional number and an empty array when a section is not supported by the filing.
3. Keep financial series aligned with the `financials.years` array in oldest-to-newest order. Do not fill an unreported period with zero. Use consistent currency and units across comparable series.
4. For annual filings, prefer up to three years of income/cash-flow data; for quarterly filings, clearly distinguish quarter and year-to-date periods where the source supports them. Do not mix periods in a single series.
5. Mark monetary statement values in millions of the filing currency; EPS stays in per-share units and margins stay in percentage points (e.g. 55.3 means 55.3%). Preserve negative values for expenses, losses, debt repayment and capital returns where appropriate.
6. Separate reported data from derived metrics. Compute free cash flow only when operating cash flow and capex are both available and definitions are comparable. Do not manufacture historical growth or margin values from mismatched periods.
7. Risk severity is a prioritization aid based on the filing's stated likelihood/impact, not an independently verified risk assessment. Summaries should preserve the source's wording and qualifiers.
8. Keep free-text output in English for US filings and Brazilian Portuguese for CVM filings. Brazilian users can switch dashboard language; do not translate company names or source identifiers.
9. Attach a source-section reference to every material figure and claim. Use a page only when identifiable in the extract; never guess it.
10. Reconcile Assets = Liabilities + Equity when the three series are available. Flag OCR-suspect magnitudes and implausible period changes for review rather than silently accepting them.

## Dashboard data modules

Return the data required by the app's shared contract and specialized agent schemas:

- **Company profile:** company identity/source reference, filing context, business description and reported headline KPIs with period-comparable deltas.
- **Market:** industry, named competitors, geographic revenue, operating-segment revenue and segment earnings. Include only breakdowns supported by the filing.
- **Risks:** ranked, categorized filing risk factors with severity from 1 (lower) to 5 (higher) and concise summaries.
- **Financials:** reported years/periods, revenue, net income, EPS, margins, operating cash flow, capex, free cash flow, dividends, buybacks, assets, debt and cash where disclosed.
- **History:** dated corporate timeline and material events with impact only when the filing quantifies it.
- **Executive summary:** 5–8 specific, concise takeaways covering performance, drivers, margins, cash/liquidity, material risks and events, plus claim-level confidence notes and an explicit missing-data inventory. Avoid unsupported recommendations.

## Jurisdiction-specific completeness

- **Brazil DFP:** at least two disclosed periods plus revenue or net income.
- **Brazil ITR:** current quarter plus prior-year reference, or one period with an explicit prior-DFP cross-reference.
- **US 10-K:** three income-statement periods and the reported balance-sheet periods.
- **US 10-Q:** current quarter, prior-year quarter and balance sheet.
- **Narrative forms:** Formulário de Referência, Fato Relevante and 8-K are not failed against financial-table thresholds. Mark financials as not applicable and recommend DFP/ITR or 10-K/10-Q as appropriate.

## Dashboard behavior and interpretation

The app presents fiscal period and segment filters, configurable KPI visibility, financial metric/chart selection, interactive charts, event search/sorting, CSV export and print-to-PDF. Period and segment filters affect the visualized series; headline KPI strings represent the latest reported period and must not be interpreted as recalculated for a selected historical range. The footer includes filing context and a reminder to verify material figures against the source.

If a source omits a chart's data, the interface should show an explicit empty state rather than implying a zero value. Keep citations and caveats visible; outputs are informational and are not investment advice.

## Pre-built dashboard population contract

The Dashboard Manager maps the assembled agent JSON to a fixed **featured-map** dashboard. It is a data-binding stage, never a design stage.

1. Preserve the supplied dashboard’s CSS tokens, fonts, HTML block order, section spans and chart-specification functions. Populate only direct text values and the data object consumed by its charts.
2. Map the hero to one material reported figure: prefer latest revenue, then latest net income. Do not substitute a non-financial KPI when neither is available; emit an empty state.
3. Map time series only to aligned reporting periods. Prefer revenue with operating margin; otherwise pair revenue with net income. Do not mix annual and quarterly periods.
4. Map Pareto/composition only to reported operating segments or geographies. Include at most six items, sorted descending by the latest reported value.
5. Map the pivot table to up to six reported financial metrics. Recalculate totals only when the source series reconciles. Every missing block receives a visible "No data for the period" state.
6. Never invent retail, operating, target, comparison, conversion, margin, percentage or period values. Deltas require a reported comparable period and state their comparison explicitly.
7. Apply a jurisdiction presentation contract. Brazil uses BRL, `pt-BR` formatting, narrative risk presentation and Fatos Relevantes prominence. The US uses USD, `en-US` formatting, a structured top-risk list and 8-K-labelled chronology. Values returned by FilingLens financial agents are in millions of the filing currency.
