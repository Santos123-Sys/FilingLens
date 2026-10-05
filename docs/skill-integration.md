# FilingLens skill integration

This is a **bounded adaptation** of the PDF guide and five supplied ZIPs to FilingLens. The ZIP archives are source references; their Python scripts and report-generation workflows are not bundled or executed by the deployed Site Worker. FilingLens uses its existing model stages plus TypeScript calculations and validators for the permitted parts of those skills.

| Skill | Managed stage | Runtime use | Source boundary |
|---|---|---|---|
| equity-research | Profiler | Prompt-level Tear Sheet identity/business-description checks only | No external research connector is configured; no external cross-check is performed. Tear Sheet/report generation, valuations, ratings, targets, scenarios and investment narrative are out of scope. |
| market-research-brief | Market | Prompt-level “so what?” discipline, deterministic trends from cited segment/geography series, and a citation-checked competitor fallback | Market retrieval includes SEC Item 1 and MD&A/Item 7 plus Brazilian market and segment heading windows. If the filing names no verified peers, a bounded OpenAI web search can add direct competitors. A name is retained only when its exact HTTPS URL appears in the provider-returned citation set. Market sizing, share, channel and consumer analysis remain out of scope. |
| financial-ratio-toolkit | Financials | TypeScript implementation of selected filing-only ratios | Includes the FilingLens ratios plus period-end ROE/ROA, liquidity and working-capital efficiency measures, and DuPont components. Market-price ratios and ratios with unavailable/negative denominators are excluded. The dashboard table shows at most six supported measures. |
| financial-statement-analyzer | Financials | TypeScript port of the attached comparable-period analysis and 10 screening rules | Generates comparable YoY/QoQ trends without annualizing quarterly data, and warning-level review signals. Thresholds are screens, not audit findings or conclusions. |
| filing-timeline-extractor | Historian | TypeScript dated-excerpt fallback and binding validator for the attached output constraints | If the specialist returns no usable items, the fallback selects only verbatim dated event lines from the filing. Exact quote and section reference required; dates retain explicit granularity; duplicate, invalid and unverifiable external entries are omitted with visible flags. External enrichment is marked skipped. The Python CLI itself is not invoked. |

## Manager and binding behavior

- `GET /api/analysis-plan` lists the skill-to-stage mapping and bounded sub-tools.
- `Agent Manager` runs the in-process TypeScript calculations and validators after each schema-validated agent call. Transient model failures have at most two retries per stage; deterministic validation does not retry or erase other stages.
- The Synthesizer receives the earlier specialist JSON together with its filing excerpt. A valid issuer profile is no longer rejected solely because the filing supplied no headline KPI card. A summary with one supported point is retained rather than marked incomplete for failing an arbitrary bullet count.
- `FilingAnalysis` remains the only dashboard input. The existing React/ECharts components own all design, order, chart behavior and formatting.
- Filing-derived values keep filing evidence. Calculated financial metrics retain their formula, components and component evidence. External competitor evidence is stored separately with publisher, URL and access date; it is never presented as a filing disclosure.
- Skipped enrichments, dropped market data and timeline validation flags are passed into diagnostics and shown in the dashboard.
- The Market module distinguishes four research states: not needed, complete, no citable results, and unavailable. Empty states explain which condition occurred instead of presenting a generic missing-data message.

## Worker compatibility

The Worker cannot spawn the attached Python utilities as child processes. Their compatible deterministic logic is implemented in TypeScript: the financial statement analyzer in `api/financial-skill-analysis.ts`, filing ratios in `contracts/financial-metrics.ts`, market provenance/trend binding in `api/market-validation.ts`, citation verification in `api/market-web-research.ts`, and timeline validation in `api/historian-validation.ts`. The integration is not a byte-for-byte port of the full skills: report-file generation, equity valuation/recommendations, market-data ratios, and unsupported fields are deliberately not run. Tests cover comparable periods, ratio outputs, threshold signals, provenance rejection, citation allow-listing, event date validation and partial output behavior.

The provider remains pinned to `gpt-5.6-terra` for all analysis stages.
