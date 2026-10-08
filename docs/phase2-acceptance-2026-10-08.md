# Phase 2 production acceptance record — 2026-10-08

## Reference filing

- Issuer: Apple Inc.
- Original filing: FY2025 Form 10-K, year ended September 27, 2025.
- SEC accession: 0000320193-25-000079, filed October 31, 2025.
- Original SEC filing: https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm
- Public as-filed PDF distributed by Apple Investor Relations: https://s2.q4cdn.com/470004039/files/doc_earnings/2025/q4/filing/10K-Q4-2025-as-filed.pdf

## Live Railway application results

A one-time private-network acceptance harness uploaded the genuine 80-page annual-report PDF to the production /api/extract route and sent the extracted text through the normal metadata, financials, market and competitor-research endpoints. No uploaded private user documents or financial database rows were used.

| Check | Observed outcome | Gate |
| --- | --- | --- |
| Apple PDF fetch | HTTP 200, application/pdf | PASS |
| Upload and extraction | HTTP 200; one PDF; 280,784 characters; 10-K classification | PASS |
| Filing metadata | HTTP 200; diagnostic complete | PASS |
| Financial specialist, *first truncated run* | HTTP 200; diagnostic incomplete (sec_10k_financials_incomplete) | FAIL / recovered |
| Filing-market specialist, *first truncated run* | HTTP 200; diagnostic incomplete (market_detail_not_found) | FAIL / recovered |
| Financial specialist, full source text | HTTP 200; diagnostic complete | PASS |
| Filing-market specialist, full source text | HTTP 200; diagnostic complete | PASS |
| External competitor research | HTTP 200, reported complete but returned **zero peer profiles** | FAIL — audit bug |

### Findings

1. The acceptance harness originally truncated the real filing to 130,000 of 280,784 extracted characters. This omitted sufficient content to degrade the financial and market specialists. Repeating those stages with the complete extracted corpus passed both.
2. External competitor research returning zero source-linked peers while being marked complete was an incorrect success signal. The completion condition has been tightened to require externally cited competitor or research-findings coverage. The outcome must now be marked incomplete, not converted into unsupported competitor data.
3. Apple’s original SEC HTML is blocked from direct Railway retrieval (HTTP 403), so the production test used Apple’s own publicly hosted as-filed PDF instead.
4. No independently verified end-to-end market research **with actual SEC-corroborated competitor peer facts** was observed. This cannot be inferred from successful endpoint responses alone.
5. No live CVM/IFRS end-to-end successful peer-validation response, and no dated multi-company trading-multiple reconciliation, was demonstrated as part of this test. Those remain separate verification requirements.

## Phase 2 closure policy

Application deployments, mocked unit tests, deterministic financial calculations, and live upload/metadata checks are distinct forms of evidence. Phase 2 must **not** be labelled fully accepted until a source-backed external competitor profile is produced, live SEC/IFRS/CVM cross-checks are exercised against actual records, and the gated DCF and trading-comps calculation endpoints pass real-filing integration checks. Unsupported or mismatched peer sources must remain explicitly excluded.

### Reliability and provenance constraints

- Do not fetch market prices from uncited model output.
- Do not silently map Brazilian DFP line items to IASB IFRS or US GAAP labels.
- Keep historical and market quotation dates explicit when evaluating a trading multiple.
- Do not infer currency scale or exchange rates; preserve native currencies unless timestamped FX is available.
- Do not claim end-to-end full financial/market research acceptance merely because the API returned HTTP 200.
