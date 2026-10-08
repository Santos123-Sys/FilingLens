# Phase 2 — Live production revalidation (2026-10-08)

## Scope and evidence standard
This document supersedes the **outstanding-gates conclusions** in [phase2-acceptance-2026-10-08.md](phase2-acceptance-2026-10-08.md). Earlier incomplete outcomes are kept there for incident history. The revalidation below was executed using the production Railway Node/Hono API over its private network, with the genuine Apple Inc. FY2025 Form 10-K from Apple Investor Relations. All logged values are technical acceptance evidence, not an investment recommendation.

- Filing: Apple Inc., FY2025 Form 10-K, year ended 2025-09-27.
- Public as-filed PDF: https://s2.q4cdn.com/470004039/files/doc_earnings/2025/q4/filing/10K-Q4-2025-as-filed.pdf
- FilingLens production service: Railway project "Filling Lens", service "FilingLens".
- Data handling: downloaded the public PDF, submitted via the actual file-extraction and analysis APIs, kept the data in memory only, did not ingest to MySQL or private user history.
- Acceptance runner: temporary Railway Function test code, subsequently removed from the production schema worker.

## Observed live results

| Gate | Observed response | Assessment |
| --- | --- | --- |
| Genuine PDF upload/extraction | HTTP 200; 1 document; 280,776 extracted characters; classified 10-K | **PASS** |
| Filing metadata | HTTP 200; diagnostic `complete` | **PASS** |
| Financial specialist | HTTP 200; diagnostic `complete`; 3 fiscal years, revenue and capex data | **PASS** |
| Filing-market specialist | HTTP 200; diagnostic `complete` | **PASS** — not itself independent competitor research |
| Separate external competitor research | HTTP 200; diagnostic `complete`; 3 source-bound peer profiles, 4 cited findings and 3 peer evidence entries | **PASS** for source-linked competitor discovery |
| External research source catalog | App logged 3 candidate peers / 3 accepted peers / 55 source references / 2 dropped claims | **PASS** for citation binding |
| Verified peer *numerical* SEC values | 0 matched facts and 0 official-history observations; 2 issuer CompanyFacts lookups attempted | **NOT VERIFIED** |
| Valuation proposal | HTTP 200; 28 DCF assumptions, all initially awaiting approval | **PASS** |
| Unapproved valuation gate | HTTP **409**, `assumptions_require_validation`, 28 pending | **PASS**, correctly fails closed |
| Approved test DCF | HTTP 200; `complete`; five FCFF projections; 5 × 5 WACC/terminal-growth sensitivity grid; finite implied value per share | **PASS** — software execution only |
| Bear/base/bull DCF reruns | All 3 returned HTTP 200, `complete`, five projections and finite per-share figures | **PASS** — software execution only |
| Trading-comps proposal | HTTP 200; 8 assumptions, `awaiting_validation` | **PASS** for proposal only; full sourced-multiple calculation unverified |

**Assumption caveat:** The DCF calculation used the real filing-derived financial analysis but filled **seven missing inputs** using explicitly illustrative test assumptions. These were approved *only by the automated technical test*, not by a real analyst. The output must not be presented as a vetted fair value, price target or stock recommendation. No actual model-derived values were persisted.

## SEC numerical-verification blocker — independently reproduced

The competitive-research service accepted 3 cited peers but verified 0 SEC XBRL numerical facts; the application logged `matched_xbrl_points=0 lookups=2 peer_history=0`.

A separate read-only Railway network probe used the configured SEC User-Agent and made one request each to:

- `https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json` (Apple)
- `https://data.sec.gov/api/xbrl/companyfacts/CIK0000789019.json` (Microsoft)

**Both returned HTTP 403 with `text/html`**, and `configuredAgent=true`. This is evidence of inaccessible SEC data from the current Railway execution context, not of absent competitor financial data. The test did not try to bypass SEC access restrictions, spoof identity, or inject unsupported figures. No verified CompanyFacts observations can be claimed from these responses.

Next corrective step: investigate approved SEC API egress arrangements, request/contact SEC access support as appropriate, and test the official data-tools backend independently. Any compliant alternate regulatory ingestion route must preserve CIK, accession, period, taxonomy, scale, and auditability before allowing numerical peer comparisons.

## Release and closure determination

**Validated now:** genuine-file extraction, source-bound competitive research, financial analysis, DCF gating, five-year DCF and three scenario reruns.

**Not yet accepted:** external primary SEC numerical matching; live CVM/IFRS regulator fact ingestion; cross-company trading multiples from independently cited market capitalizations, debt and synchronized quotation/financial dates; an actual analyst's validation of market assumptions.

Phase 2's core software is implemented and the remaining user-visible competitor-research and DCF execution regressions now pass live production acceptance. Nevertheless, **do not label every Phase 2 evidence/valuation requirement fully verified** until the remaining source-access and trading-comparables gates pass.

## Safety/cleanup

The two temporary test harnesses (one for integrated production acceptance and one for SEC reachability) were removed from Railway's schema migration Function after the runs. No synthetic rows or external PDF bytes were committed to the production database by these tests. The main application was not modified to run the test harness.
