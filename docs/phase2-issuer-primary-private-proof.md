# Privacy-first issuer-primary financial corroboration (Phase 2 alternative)

## Decision
FilingLens does not need to contact SEC staff, disclose its repository, or use unapproved proxies to perform *issuer-issued financial-statement checks*. The SEC CompanyFacts API and nightly bulk endpoints were HTTP 403 from Railway and the official GitHub source-check run. The official SEC accession-linked acceptance [issue #52](https://github.com/Santos123-Sys/FilingLens/issues/52) is **not redefined as successful**. Instead, this is a distinct proof tier with independently available financial data.

## Implemented real primary source

Apple publishes a condensed consolidated FY2025 statement directly at:

https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf

The first page of that **unaudited** statement clearly identifies Apple Inc., shows the twelve months ended September 27, 2025, identifies currency USD and scale millions, and contains the following actual annual columns:
- Net sales **416,161 million USD**.
- Gross margin **195,201 million USD**.
- Operating income **133,050 million USD**.
- Net income **112,010 million USD**.

These numbers are not fabricated or inferred from SEC CompanyFacts. The source is Apple's own investor disclosure; this is an issuer-primary observation, but **not SEC regulator authentication or audited-filing confirmation**. The dashboard distinguishes the two tiers.

## Privacy and trust boundaries

- Exactly one fixed issuer-owned HTTPS URL is eligible for the initial FY2025 Apple proof. No user-controlled URL is fetched; this is not an open proxy or SSRF feature.
- The PDF is fetched using a public GET with no user filings, prompts, investor thesis, credentials, authenticated session, or private research sent. The remote website observes ordinary request metadata such as cloud egress IP and HTTP headers. No claim of total anonymity.
- The fetch is bounded to 12 MB, exact final URL, expected PDF MIME, %PDF signature and 3–8 parsed pages, with 12-second timeout and no redirects. SHA-256 records the actual response bytes; in-process cache TTL one day, failed-fetch backoff one hour.
- The numeric matcher enforces issuer, **original cited 2025 SEC accession identifier**, FY2025, 2025-09-27 year end, consolidated US GAAP, original PDF statement title/annual USD million scale, and four named source-table amounts. The cited accession matches publicly documented filing identity, but no SEC HTTP request was made, so this does **not** establish SEC XBRL CompanyFacts provenance.
- Peer figures are accepted only if they match the exact issuer table value. Disagreement with a genuine SEC verification result cannot be silently overridden by issuer evidence. Only SEC/CVM evidence is labeled as regulatory proof. The issuer tier is recorded as `issuer_published_unaudited_pdf` and has its own URL and PDF hash.
- Server-side live SEC requests are **disabled by default**; they require explicit `SEC_LIVE_LOOKUP_ENABLED=true`. Previously imported authentic official CompanyFacts remains available via the operator-attested MySQL reader even when direct SEC egress is off.

## Reproduce and acceptance

Run tests and the real issuer-primary acceptance on a host with Node, network access to apple.com and repo dependencies:

```bash
npm ci
npm run check
npm test
npx --yes tsx ops/verify-issuer-public-statement.ts
```

The independent acceptance command retrieves the actual issuer PDF and verifies four exact annual amounts plus four executed negative controls: wrong amount, unrelated issuer, wrong year, and wrong accession. On success prints `verified:true` with issuer source URL, PDF SHA, fetch timestamp, four amounts, source tier, and `secCompanyFactsVerified:false`. Nonzero exit on failure or inaccessible Apple source.

The one-time automatically run on merge is in `.github/workflows/issuer-primary-acceptance.yml`; subsequently it may be invoked manually. No SEC, Gmail, or private repository data is sent.

## Operational limitations

- The auto-correlated issuer reference catalog currently covers **Apple FY2025 only**. It is designed as a verifiable pattern to extend by explicit issuer-publication URLs, dates, parsing templates and tests, not a general-purpose arbitrary financial feed.
- Apple’s FY2025 earnings-release statements are **unaudited**. They cannot independently confirm a restated SEC 10-K or satisfy original-source SEC CompanyFacts issue #52.
- Parsed PDF text extraction may differ by publisher; a newly added issuer must have its own tested table parser and release acceptance.
- SEC-based multi-issuer official historical series remain unavailable without official data. The issuer source path should nevertheless make issuer/peer numerical corroboration functional in the supported cohort and make gaps visible rather than fabricating them.
