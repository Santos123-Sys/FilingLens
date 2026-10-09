# Phase 2: compliant SEC bulk import and component-backed trading comps

## Why this exists

Production Railway egress returned HTTP 403 from `data.sec.gov` for multiple CIKs even with a declared User-Agent. This is an upstream access restriction. Do not rotate IPs, use stealth proxies, forge identities, or retry denied requests in a loop. SEC says to contact `webmaster@sec.gov` with the denial and public IP address. SEC offers a nightly official `companyfacts.zip` archive as an alternate distribution channel.

## SEC-facts fallback

1. On an **authorized, SEC-compliant operator workstation**, obtain `https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip` from the SEC and record the retrieval date. This step is outside Railway; it must be done through permitted official access.
2. Create the `sec_companyfacts_snapshots` database table with `ops/phase2-sec-companyfacts-cache.sql` via the privileged schema-migration DB connection. The restricted FilingLens app user requires only SELECT.
3. On that same operator machine with Node and `unzip`, run, using a privileged DB credential with INSERT/UPDATE privileges:

```bash
DATABASE_URL="<secure admin MySQL URL>" npx --yes tsx ops/import-sec-companyfacts.ts --archive /secure/companyfacts.zip --cik 0000320193 --retrieved-day 2026-10-08
```

4. For an explicit peer cohort, a single bounded atomic import is also supported (1–12 unique, exactly ten-digit CIKs):

```bash
DATABASE_URL="<secure admin MySQL URL>" npx --yes tsx ops/import-sec-companyfacts.ts --archive /secure/companyfacts.zip --ciks 0000320193,0000789019 --retrieved-day 2026-10-09
```

The operator must supply the actual date of retrieval, not the example date. All requested ZIP members are validated before any SQL write. The writes occur inside one transaction; a failed member extraction or SQL operation does not partially update the selected cohort. The script does not download the SEC archive and does not bypass an HTTP 403.

5. Repeat only for specific competitor CIKs needed, at most once for each updated SEC bulk archive. The importer extracts `CIK##########.json` **directly from the ZIP**, checks exact CIK and supported taxonomy, hashes the entire ZIP and member, and saves the JSON (not a company PDF) with retrieval-day provenance. No archive data is fetched by FilingLens from a non-SEC mirror.
6. If direct data.sec.gov retrieval is unavailable, the server accepts a stored import **only when** the archive source is the official URL, payload SHA-256 matches, issuer CIK agrees, and the retrieval date is within 14 days. The original accession, fiscal date, reporting basis and amount must **still** match the candidate peer number before it is eligible for calculation.
7. The UI explicitly distinguishes `operator_attested_sec_bulk` from live `sec_api`. This is **operator-attested official-file provenance**, not an independent live SEC HTTP verification. If no archive was loaded, the numerical proof remains unavailable, not guessed.

## Trading-comps evidence

The proposal endpoint accepts optional `tradingSnapshots` containing 3–12 raw company-specific dated quotation/debt/income-statement components **only when** `analystAttested:true` was explicitly provided. Each snapshot contains:

`name, currency, basis, consolidated, quotation_date, financial_period_end, debt_as_of, market_cap_millions, net_debt_millions, ebitda_millions, revenue_millions, net_income_millions, quotation_source_url, financial_source_url`.

Rules:
- One issuer identity per peer, at least three distinct peers, one synchronized equity quotation date no more than seven days old, the same annual financial end, unit/currency, accounting framework and consolidated reporting.
- `EV = market capitalization + net debt`; `EV/EBITDA`, `EV/Revenue` and `P/E` are **recomputed from their component values** rather than trusted as quoted multiples.
- Approval of the financial and quotation documents by a human analyst is required for manual components, and the source URLs must be HTTPS.
- FilingLens only calculates comparables after the user accepts the full assumption ledger. Tampering with a peer multiple, absent component, stale price date or mismatched sources blocks the result.
- A cited URL and analyst attestation alone **do not establish that the numerical contents were independently verified** against the web page. Full machine-reconciled trading feeds remain a separate provider integration requiring a licensed source. This workflow supports documented analyst-reviewed comps, not a fabricated "independently audited" result.

## Acceptance limitations

CI covers schema typing, SEC ZIP member identity validation, fallback source-mode labels, and the raw-components valuation gate. A successful test does not establish that the Railway SEC network restriction has lifted, that an SEC ZIP has been imported to production, or that three real public peers' live price and debt datasets have been independently reconciled. Report these as operational acceptance requirements, not as completed until verified.
