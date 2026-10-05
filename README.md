# FilingLens

FilingLens converts US SEC and Brazilian CVM filing PDFs into a structured analysis and an interactive, bilingual dashboard. Version 2.0 classifies the regulator and filing type at intake, runs a metadata pre-stage, then coordinates six focused GPT-5.6-Terra analysis modules through jurisdiction-specific retrieval, validation and presentation contracts.

## Dashboard features

- Shared fiscal-period filters and a segment selector for the time-series and segment charts.
- Headline KPI visibility controls. KPI strings/deltas are for the latest reported period and are **not** recalculated when a historical chart period is selected.
- Financial metric explorer with line, column and area views; segment revenue/earnings, geographic revenue, margins, cash flow, and debt/cash charts where source data exists.
- Risk category filtering; searchable and sortable event table.
- CSV export for available financial series and browser print / save-to-PDF.
- Filing context, units and data caveats, with explicit empty states when the filing does not support a visualization.
- Source-section references on material claims and figures, claim-level confidence notes, and a missing-data inventory.
- Filing-first competitor analysis with a bounded web-search fallback when the filing names no peers. External names are shown only when the provider returns a matching citation URL, and they remain labelled separately from filing disclosures.
- CVM/SEC filing-type completeness rules, balance-sheet identity checks, OCR anomaly flags and disclosed forward-guidance extraction.
- English and Brazilian Portuguese interface labels.

Financial values are extracted from the uploaded document and should be checked against the source filing before consequential use. The product is informational, not investment advice. The dashboard is a point-in-time analysis, not a live regulatory-data feed.

## Development

Requires Node.js 22+.

```bash
npm ci
npm run dev
```

Useful validation commands:

```bash
npm run check
npm run lint
npm test
npm run build
```

The application includes a Hono API for PDF extraction, deterministic jurisdiction classification, the metadata pre-stage and the six analysis agents. See `.env.example` for required server configuration before running the full filing-analysis flow.

## Dashboard data contract

The shared schemas live in `contracts/analysis.ts`; model instructions live in `api/engines.ts`. The UI lives in `src/components/Dashboard.tsx`. Keep financial arrays aligned to `financials.years` in oldest-to-newest order, use `null` / empty arrays for unavailable data rather than zeroes, and only include a filing accession / CVM document reference when the source explicitly provides it. See `prompts/filing-to-dashboard-prompt.md` for the full extraction and interpretation rules.

## Sites deployment

The React UI and stateless Hono API deploy as a Cloudflare Worker with static assets. Configure `OPENAI_API_KEY` as a server-side Sites secret. Filing analysis uses `gpt-5.6-terra`. Without the secret, the UI displays a setup notice and disables analysis. Files are processed within the current session; there is no saved filing history.

`npm run build` generates `dist/server/index.js` and `dist/client`. PDFs must be text-based, at most 20 MB. Retry boundaries are owned by the Agent Manager and applied per stage only to transient provider failures. The market stage may make one additional bounded web-search call only when no filing-cited competitor survives validation.
