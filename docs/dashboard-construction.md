# Dashboard construction rules

This is the FilingLens-specific adaptation of the attached `build-dashboard` skill. It governs the dashboard data-binding step for every SEC/CVM filing analysis.

## Mapping to the FilingLens application

- The validated `FilingAnalysis` JSON is the dashboard's data object (the equivalent of `DATA`/`DADOS`). It is assembled from the six specialist agents and completeness checks.
- The existing React `Dashboard` component and ECharts option builders are the rendering specification (the equivalent of `SPECS`). They own layout, chart behavior, filtering, colors, typography and responsive styling.
- The dashboard manager maps the analysis into the existing Featured Map blocks, in order: hero, KPIs, performance combo, composition/Pareto and financial pivot. A filing upload supplies values; it never supplies a new layout or styling.
- The implementation uses its existing React/ECharts app shell rather than exporting a disconnected, single-file HTML document. This preserves upload flow, analysis state, source evidence, bilingual UI and the existing charts.

## Binding rules

1. Treat the extracted JSON as the sole source of filing-specific values. Never generate sample figures, infer undisclosed values, or substitute zero for missing data.
2. Keep every financial time series aligned with its period labels. Ignore mismatched series; accept only disclosed comparable periods, up to the schema limit of five. Do not annualize quarterly or YTD values without explicit support.
3. Use a single decision-useful headline metric, preferring revenue when available and net income only as a fallback. Show up to four disclosed KPIs. Put time series in the existing performance chart and use segment/geography values only for the composition chart.
4. Financial pivot rows are capped at six and include only supported metrics. Currency, percent and multiple values use the existing jurisdiction-aware formatters and units. Do not calculate a grand total across heterogeneous measures such as revenue, cash, debt and profit. Show totals only when the displayed rows are genuinely additive and reconcile.
5. Empty or incomplete blocks retain their explicit empty state. Preserve the existing component order, chart options, CSS, typography and interactions. Data updates must not change the design.
6. A metric with an ambiguous definition or missing components is omitted or explicitly marked incomplete. The automated analysis cannot ask a follow-up mid-run; its safe result is a visible data-quality state with missing inputs and sources, rather than a guessed mapping.
7. Keep extracted, adjusted and calculated values distinct. Recompute any displayed composition shares from the represented source rows; verify any additive totals against those rows before rendering.
8. Keep the dashboard bilingual (Brazilian Portuguese and US English), use the filing locale for number formatting, and retain period labels and source references so users can audit values.

These rules adapt the generic skill's controls, chart/table conventions, locale formatting, empty states, and reconciliation checks to FilingLens's fixed design and filing-grounded analysis. The skill's request to fabricate sample data when no source exists is intentionally inapplicable: real filing analysis must not display illustrative numbers as issuer disclosures.
