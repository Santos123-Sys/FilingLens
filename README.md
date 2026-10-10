# FilingLens

FilingLens converts US SEC and Brazilian CVM filing PDFs into a structured analysis and an interactive, bilingual dashboard. Version 2.0 classifies the regulator and filing type at intake, runs a metadata pre-stage, then coordinates six focused GPT-5.6-Terra analysis modules through jurisdiction-specific retrieval, validation and presentation contracts.

## Dashboard features

- Shared fiscal-period filters and a segment selector for the time-series and segment charts.
- Headline KPI visibility controls. KPI strings/deltas are for the latest reported period and are **not** recalculated when a historical chart period is selected.
- Financial metric explorer with line, column and area views; segment revenue/earnings, geographic revenue, margins, cash flow, and debt/cash charts where source data exists.
- Risk category filtering; searchable and sortable event table.
- CSV export for available financial series, browser print / save-to-PDF, and a professional bilingual `.pptx` company-analysis deck generated from the validated analysis contract.
- Filing context, units and data caveats, with explicit empty states when the filing does not support a visualization.
- Source-section references on material claims and figures, claim-level confidence notes, and a missing-data inventory.
- Filing-first competitor analysis with a bounded web-search fallback when the filing names no peers. External names are shown only when the provider returns a matching citation URL, remain labelled separately from filing disclosures, and flow into the presentation with their provenance preserved.
- CVM/SEC filing-type completeness rules, balance-sheet identity checks, OCR anomaly flags and disclosed forward-guidance extraction.
- English and Brazilian Portuguese interface labels.

Financial values are extracted from the uploaded document and should be checked against the source filing before consequential use. The product is informational, not investment advice. The dashboard is a point-in-time analysis, not a live regulatory-data feed.

## Analyst decision and audit workflow (Phases 3–6)

After analyzing a filing, you can compare a prior FilingLens JSON analysis (Phase 3), examine source-gated DCF materiality and the research queue (Phase 4), write an analyst-authored thesis/counter-case with a source register (Phase 5), and export a portable analysis-assurance audit bundle (Phase 6). These are conservative **review tools**, not authenticated SEC restatement findings, live market-price recommendations or regulator-certified source data. The Phase 6 review-readiness label evaluates internal consistency only.

Audit bundle verification (Node.js required):

```bash
npx --yes tsx ops/verify-phase6-audit.ts ./filinglens-audit-us-issuer.json
```

The SHA-256 checksum protects against accidental modification, **not** adversarial editing or source spoofing. See [Phase 5](docs/phase5-analyst-decision-dossier.md), [Phase 6](docs/phase6-release-assurance.md) and [open SEC source acceptance blocker #52](https://github.com/Santos123-Sys/FilingLens/issues/52).

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

The application includes a Hono API for PDF extraction, deterministic jurisdiction classification, the metadata pre-stage and the six analysis agents. Each expensive model/tool operation is limited to one HTTP request; transient retries are started by the browser as new requests. Citation-backed peer research runs through the separate optional `/api/market-research` stage. See `.env.example` for required server configuration before running the full filing-analysis flow.

## Shared portfolio intelligence

The Railway service publishes an authenticated, read-only `filinglens-public-finance-v1` contract for Global Portfolio Intelligence and Portfolio Risk & Return. It contains canonical SEC/CVM issuer identity, annual public-regulator facts, deterministic revenue-growth screening, SHA-256 integrity, and source provenance. Private uploads and valuation commands are never exposed. See [the shared-intelligence integration guide](docs/shared-intelligence-integration.md).

## Dashboard data contract

The shared schemas live in `contracts/analysis.ts`; model instructions live in `api/engines.ts`. The UI lives in `src/components/Dashboard.tsx`. Keep financial arrays aligned to `financials.years` in oldest-to-newest order, use `null` / empty arrays for unavailable data rather than zeroes, and only include a filing accession / CVM document reference when the source explicitly provides it. See `prompts/filing-to-dashboard-prompt.md` for the full extraction and interpretation rules.

## Sites deployment

The React UI and stateless Hono API deploy as a Cloudflare Worker with static assets. Configure `OPENAI_API_KEY` as a server-side Sites secret. Filing analysis uses `gpt-5.6-terra`. Without the secret, the UI displays a setup notice and disables analysis. Files are processed within the current session; there is no saved filing history.

`npm run build` generates `dist/server/index.js` and `dist/client`. PDFs must be text-based, at most 20 MB. The browser owns bounded retries per stage, while the Agent Manager owns ordering, source slicing and validation. A server request performs at most one expensive model/tool call. If no filing-cited competitor survives validation, the browser may start one separate bounded `/api/market-research` stage. PowerPoint creation is local to the browser and never triggers a second company analysis.


### Privacy-first issuer financial verification (Phase 2)

For peer research when SEC CompanyFacts egress is unavailable, FilingLens supports a distinctly labeled **issuer-published financial-statement corroboration** path. The first supported issuer is Apple FY2025, matching annual net sales, gross margin, operating income and net income directly to Apple's public **unaudited** consolidated statement. Live SEC peer API requests are opt-in (`SEC_LIVE_LOOKUP_ENABLED=true`); otherwise source verification uses issuer publications or pre-imported official facts where available. No private analysis data is sent with the fixed public issuer PDF GET.

See [privacy and source boundaries](docs/phase2-issuer-primary-private-proof.md) and [verified real-data acceptance](docs/phase2-issuer-primary-acceptance-record.md). **Issuer-verified ≠ SEC CompanyFacts-verified.**
