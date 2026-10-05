# FilingLens Project Documentation

Version 17 · 5 October 2026

## 1. Purpose and scope

FilingLens converts a text-based SEC or CVM filing PDF into a structured, bilingual analysis dashboard. It classifies the document, extracts regulator metadata, runs six specialist analyses, validates evidence and calculations, and maps the result into a fixed React dashboard. The product is designed for document-supported analysis: missing information remains missing unless a separately identified, citation-checked research path is available.

The deployed product supports US 10-K and 10-Q filings and Brazilian FRE, DFP and ITR documents. It is informational and is not an investment recommendation, audit opinion, or substitute for checking the source filing.

## 2. System architecture

```text
Browser React application
  |-- PDF upload and jurisdiction confirmation
  |-- Sequential stage orchestration and progress state
  |-- FilingAnalysis assembly
  `-- Interactive ECharts dashboard
          |
          v
Hono API on a Cloudflare-compatible Site Worker
  |-- PDF text extraction and corpus selection
  |-- deterministic filing classification
  |-- metadata pre-stage
  |-- Agent Manager
  |     |-- profiler
  |     |-- market -> citation-checked web fallback when peers are absent
  |     |-- risks
  |     |-- financials -> deterministic calculations and screens
  |     |-- historian -> deterministic dated-event fallback
  |     `-- synthesizer
  |-- Zod schema validation and provenance validation
  `-- prebuilt dashboard mapping
          |
          v
OpenAI model and built-in web search
```

The browser deliberately coordinates bounded HTTP stages instead of requesting one long background analysis. The Worker is stateless: filing text and partial results are sent for the current analysis and are not saved as filing history.

## 3. Analysis workflow

1. The user selects an SEC or CVM mode and uploads a PDF of at most 20 MB.
2. `POST /api/extract` parses the PDF, rejects unreadable or text-poor documents, creates a bounded analysis corpus, and classifies jurisdiction and filing type.
3. If confidence is insufficient, the interface asks the user to confirm SEC or CVM jurisdiction.
4. `POST /api/metadata` extracts filing type, reporting period, filing date and available regulator identifiers.
5. The browser calls `POST /api/agent` once for each managed stage. The Agent Manager chooses the focused excerpt, schema, retry boundary, validator and deterministic sub-tools.
6. The synthesizer receives the supported outputs of the earlier specialists and returns a concise summary, confidence notes and a missing-data inventory.
7. `POST /api/dashboard-data` maps the assembled `FilingAnalysis` object into the fixed dashboard contract.
8. The UI renders available modules and explicit incomplete, unavailable or not-applicable states for the rest.

## 4. Specialist responsibilities

| Stage | Primary responsibility | Main evidence boundary |
|---|---|---|
| Metadata | Filing identity, period, date and regulator identifiers | Cover and header text only; identifiers are never inferred |
| Profiler | Issuer identity, business description and latest-period KPIs | Filing evidence only |
| Market | Industry, named peers, geographic revenue and operating segments | Filing evidence first; cited web research only for peers absent from the filing |
| Risks | Ranked and categorized material risk factors | Filing risk section only |
| Financials | Comparable financial statements, cash flow, leverage, returns and validation | Filing values plus deterministic calculations based on cited inputs |
| Historian | Corporate milestones and dated events | Filing excerpts only; explicit date granularity retained |
| Synthesizer | Supported executive summary and missing-data inventory | Validated specialist outputs and filing excerpt |

## 5. ZIP skill implementation

The supplied ZIP skills were adapted to the Site runtime rather than executed as Python programs. A deployed Worker cannot rely on spawning those utilities, so applicable rules were ported into TypeScript and bound to the existing analysis stages.

| Supplied skill | Implemented behavior | Deliberate exclusions |
|---|---|---|
| equity-research | Tear-sheet identity and business-description consistency method | Ratings, price targets, valuation and unsupported investment narrative |
| market-research-brief | Filing-supported “so what” analysis, comparable segment and geography trends, citation-checked competitor fallback | TAM, market share, consumer/channel estimates and unsourced market claims |
| financial-ratio-toolkit | Filing-only ratios with formula, components, period and evidence | Price-based multiples and ratios without usable denominators |
| financial-statement-analyzer | Comparable-period trends and ten review screens | Audit conclusions and annualization of incomparable periods |
| filing-timeline-extractor | Dated-excerpt fallback, deduplication, date-granularity and provenance validation | External event invention and unsupported dates |

## 6. Parallel market research fallback

The market specialist first returns filing-derived competitors and evidence. `api/market-validation.ts` removes any peer that lacks a filing section and exact quote. If no peer remains, the Agent Manager calls `researchMarketPeers` in `api/market-web-research.ts`.

The research call is intentionally narrow: it seeks direct competitors only, excludes financial figures and recommendations, and returns at most eight candidates. Each candidate URL is canonicalized and checked against the URL sources returned by the provider's web-search tool. A candidate is discarded when the URL is absent from that citation set, uses a non-HTTPS scheme, is duplicated, or is malformed. Accepted evidence records the publisher, URL, access date and `sourceType: external`.

The dashboard labels external results as Web research or Pesquisa web and links to the source. Filing-derived peers remain labelled Filing disclosure or Divulgação no documento. Research status is explicit: `not_needed`, `complete`, `no_citable_results`, or `unavailable`.

## 7. Financial logic and validation

Financial arrays are limited to the five most recent comparable periods and remain aligned to `financials.years`, oldest first. Annual, quarterly and year-to-date periods must not be mixed without an explicit label. Missing values use `null` or an empty array, never zero.

Deterministic calculations include relevant growth, margins, free cash flow, net debt, leverage, return, liquidity and working-capital measures when their components exist. Each calculated measure retains its formula, components, periods, confidence and component evidence. Debt ratios use interest-bearing debt rather than total liabilities, and cash refers to unrestricted cash and equivalents.

Validation includes balance-sheet reconciliation, OCR anomaly detection, period-alignment checks, jump warnings and relationship screens. These are automated review signals, not findings of misstatement or misconduct.

## 8. Data contracts and provenance

`contracts/analysis.ts` is the shared contract between server and browser. Zod schemas validate each model response before it reaches the dashboard. `FilingAnalysis` is the assembled dashboard input and includes metadata, company profile, KPIs, market data, risks, financials, timeline, events, summary, confidence notes, missing data and module diagnostics.

Material filing claims use an `EvidenceReference` with section and, where available, an exact quote, page, item or source form. External peer research uses citation evidence with URL, publisher and access date. The design keeps source types separate so externally researched information cannot be mistaken for a disclosure in the uploaded filing.

## 9. User interface

The React interface is bilingual in English and Brazilian Portuguese. It provides document upload, jurisdiction confirmation, stage progress, graceful module failures and a multi-tab dashboard. The dashboard includes period and segment filters, KPI visibility controls, ECharts financial and operating charts, risk filtering, searchable and sortable events, financial CSV export, and browser print or PDF output.

Empty states are part of the product contract. They distinguish unavailable filing data, unsupported document types, failed modules, absent cited web results and temporarily unavailable research rather than filling the dashboard with estimates.

## 10. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, ECharts |
| API | Hono with REST endpoints |
| AI | AI SDK, OpenAI provider, `gpt-5.6-terra` stage pins |
| Validation | Zod schemas and deterministic TypeScript validators |
| PDF parsing | `pdf-parse` |
| Testing | Vitest and TypeScript project checks |
| Build | Vite client build plus esbuild Worker bundle |
| Hosting | ChatGPT Sites with Cloudflare-compatible Worker output |

## 11. Repository map

| Path | Purpose |
|---|---|
| `src/pages/Home.tsx` | Upload flow, browser orchestration and final analysis assembly |
| `src/components/Dashboard.tsx` | Dashboard UI, charts, filters, citations and empty states |
| `api/boot.ts` | Hono endpoints and request error handling |
| `api/analyze.ts` | PDF extraction, corpus selection, excerpt routing and model calls |
| `api/agent-manager.ts` | Stage order, retries, validators and skill bindings |
| `api/engines.ts` | Bilingual specialist prompts and output rules |
| `api/market-web-research.ts` | Bounded peer search and citation allow-list verification |
| `api/financial-validation.ts` | Financial validation and computed indicator binding |
| `api/historian-validation.ts` | Timeline evidence and date validation |
| `contracts/analysis.ts` | Shared schemas and TypeScript contracts |
| `contracts/financial-metrics.ts` | Deterministic financial calculations |
| `scripts/build.mjs` | Client and Worker production build |
| `.openai/hosting.json` | Existing Sites project identifier |

## 12. Local setup

Prerequisites are Node.js 22 or later and an OpenAI API key.

```bash
npm ci
cp .env.example .env
# Set OPENAI_API_KEY in .env for local server use.
npm run dev
```

The API key is server-side only and must never be placed in frontend code. The included `.env.example` contains the required variable name without a credential.

## 13. Quality checks

Run the following before publishing a change:

```bash
npm run check
npm test
npm run build
```

The v17 release passed the TypeScript check, 33 Vitest tests across five test files, and the production build. Coverage includes analysis contracts, dashboard mapping, financial indicators, segment alignment, skill integrations, comparable-period trends, validation signals, filing provenance, timeline date handling and external citation allow-listing.

## 14. Production build and deployment

`npm run build` produces `dist/server/index.js` and `dist/client`. The Worker exports a callable `fetch` handler, routes `/api/*` to Hono, serves compiled assets for other paths, and falls back to the SPA entry point for browser routes.

For Sites deployment, configure `OPENAI_API_KEY` as a production secret, build from the intended commit, package the Worker output with `.openai/hosting.json`, save a version and deploy it. Version 17 is published at `https://filinglens.memiuo.chatgpt.site`.

## 15. Security and operational boundaries

- Uploaded PDFs must be text-based and no larger than 20 MB.
- The API key remains server-side.
- The Worker is stateless and does not provide saved filing history.
- External research is limited to the peer fallback and is visibly separated from filing evidence.
- A transient stage failure is retried within the Agent Manager boundary; terminal configuration, quota or content errors stop the flow.
- A failed specialist does not fabricate replacement data. Other completed modules remain usable.
- Users should verify consequential figures and claims against the filing and cited external sources.

## 16. Known limitations and extension priorities

The current system depends on extractable PDF text and does not provide OCR for scanned filings. It does not persist analyses, authenticate multiple users, retrieve full filing histories, or calculate market-price-dependent valuation metrics. The web-research fallback currently enriches only direct competitors; segments, geographies, market size and timeline remain filing-bound.

Reasonable future extensions are OCR with page-level traceability, durable analysis history, filing-version comparison, source-level citation previews, background job persistence for longer analyses, observability dashboards, and explicit user controls for external research scope. Each extension should preserve the existing provenance boundary between filing facts, deterministic calculations and external evidence.
