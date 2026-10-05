# FilingLens

FilingLens converts US SEC and Brazilian CVM filing PDFs into a structured, evidence-aware company analysis. The browser orchestrates a stateless Hono API, renders a bilingual dashboard, and can export the completed analysis as a professional PowerPoint presentation.

## What the application does

- Detects SEC vs. CVM filings at intake and runs a metadata pre-stage before specialist analysis.
- Runs six focused modules for company profile, market, risks, financials, timeline/events, and synthesis.
- Applies filing-type completeness checks, financial-statement validation, calculated ratios, anomaly screens, and source-provenance validation.
- Keeps filing evidence and external web evidence distinct. Filing-named peers are preferred; if no validated peers are found, a separate cited-web research request can add direct competitors only when a matching citation URL is returned.
- Shows an observable stage-by-stage workflow in the UI, with partial/failed modules degrading gracefully instead of blocking the entire dashboard.
- Supports both the Brazilian CVM and U.S. SEC analysis flows from the same validated data contract.
- Exports a 10-slide `.pptx` company deck from the same `FilingAnalysis` object used by the dashboard. The deck includes executive summary, company snapshot, financial performance, liquidity/leverage, market/competitors, operating mix, risks, events, and sources/gaps/methodology.
- Preserves filing-vs-web provenance in the dashboard and PowerPoint output.

Financial values are extracted from the uploaded filing and should be checked against the source document before consequential use. FilingLens is informational and is not investment advice.

## Reliability model

The hosted runtime is stateless. Every server request performs at most one expensive model invocation. Retries are owned by the browser and are bounded per stage; agent calls are staggered rather than launched in parallel. The optional web peer-research step is isolated in `/api/market-research`, so a search call cannot silently extend the core market-agent request beyond its request budget.

High-level flow:

```text
PDF
  -> extract + deterministic jurisdiction classification
  -> metadata
  -> profile
  -> market from filing
  -> optional cited-web peer research
  -> risks
  -> financials + validation
  -> timeline/events + validation
  -> synthesis
  -> validated FilingAnalysis
       -> dashboard
       -> PowerPoint export
```

## Development

Requires Node.js 22+.

```bash
npm ci
npm run dev
```

Validation commands:

```bash
npm run check
npm run lint
npm test
npm run build
```

The shared schemas live in `contracts/analysis.ts`, financial calculations in `contracts/financial-metrics.ts`, model instructions in `api/engines.ts`, and the browser workflow in `src/pages/Home.tsx`. The dashboard is in `src/components/Dashboard.tsx`; PowerPoint generation is in `src/lib/powerpoint.ts`.

## Deployment

The React UI and Hono API can deploy as a Cloudflare Worker/Sites-style application. Configure `OPENAI_API_KEY` as a server-side secret. Without it, the UI reports the missing configuration and disables analysis. Uploaded filings are processed for the active session; this source package does not implement persistent filing history.

`npm run build` generates `dist/server/index.js` and `dist/client`. PDFs must be text-based and at most 20 MB.
