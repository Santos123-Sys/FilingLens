# Issuer-primary FY2025 numerical acceptance — production record

**Date:** 2026-10-09 (UTC).
**Result:** PASS for the **Apple FY2025 issuer-published unaudited PDF** proof tier. This record does **not** imply SEC CompanyFacts acceptance.

## Source and observed bytes

- Issuer: Apple Inc. (issuer-owned publication).
- Document: `https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf`.
- Annual reporting period ended 2025-09-27, USD millions, consolidated. The document explicitly states **Unaudited**.
- Retrieved on GitHub Actions at 2026-10-09T09:29:42.339Z.
- PDF SHA-256: `43e7f0730b3cce0fc37301a2f43c29712bbde6ab299d97c6df345fd0c754508a`.
- **Real-source acceptance run:** https://github.com/Santos123-Sys/FilingLens/actions/runs/37911591266 (completed SUCCESS; job 113757784426).
- **Code release:** PR #71 merged `e3f08ba1f0c31a0c0ab2bf0a119b511a2284b493`. Prior feature PRs #68, #69, #70 passed CI.

## Observed numerical outcomes

| Issuer metric | FY2025 reported amount (USD millions) | Deterministic comparison |
| --- | ---: | --- |
| Net sales | 416,161 | verified |
| Operating income | 133,050 | verified |
| Net income | 112,010 | verified |
| Gross margin (gross profit) | 195,201 | verified |

Four **executed**, fail-closed controls:
- Mutated revenue +1 USD million: `amount_mismatch`.
- Different issuer: `source_mismatch`.
- FY2024 instead of FY2025: `source_mismatch`.
- Wrong SEC 10-K accession URL in candidate claim: `source_mismatch`.

The SEC accession URL is a matching **citation identity constraint**, not evidence that CompanyFacts was fetched. The PDF is issuer-owned and **unaudited**. `secCompanyFactsVerified=false` is explicitly recorded.

## Railway confirmation

Production Railway services `FilingLens`, `filinglens-data-tools` and `filinglens-sec-oidc-importer` reported online, final deployments SUCCESS, zero active warnings or critical issues, and no outstanding work as of final verification on 2026-10-09.

A one-off Railway production-region Function fetched the same issuer PDF from the exact Apple URL and served **HTTP 200** only when its source bytes matched the GitHub-accepted SHA-256. The authenticated Railway test endpoint returned HTTP 200. This proved Railway network access to the issuer source and byte parity; the function was then **deleted**, leaving zero attached volumes and no permanent test service.

GitHub CI covers issuer numeric matching, negative controls, peer API annotation with SEC unavailable, and peer benchmark inclusion and labeling. An interactive end-to-end browser test with a user-supplied 10-K was **not** performed in this acceptance record.

## Security and privacy

- No contact with SEC staff, SEC source URLs, or GitHub-hosted SEC bulk datasets was necessary for the accepted issuer-source tier.
- No private filing PDF, portfolio holdings, model inputs, financial analysis, user credential or personal contact was sent with the public Apple PDF GET. An issuer's CDN can still observe the cloud egress IP and normal HTTP request metadata.
- SEC live API calls are disabled by default in `api/peer-sec-crosscheck.ts` unless `SEC_LIVE_LOOKUP_ENABLED=true`. Operator-attested genuine official cache remains a distinct, optional evidence source.
- Evidence displayed as `issuer_published_unaudited_pdf` is explicitly **not** `sec_api` or `operator_attested_sec_json`, and the peer benchmark UI displays the publisher's direct PDF URL.
- The supported automatic issuer-primary catalog currently includes Apple FY2025; other issuers require explicit published reference sources and new tested templates.

## Status of SEC CompanyFacts access issue

Original [issue #52](https://github.com/Santos123-Sys/FilingLens/issues/52) was about **SEC CompanyFacts official production validation** and remains a separate provenance concern. That exact SEC test returned HTTP 403 on the real run https://github.com/Santos123-Sys/FilingLens/actions/runs/37906474661. This record is a **functional issuer-first alternative**, not a retroactive pass of blocked SEC source access. The original regulatory-only requirement may be considered *superseded for the privacy-first Apple FY2025 use case*, never *passed*. Do not re-label the issuer PDF as regulator-authenticated data.
