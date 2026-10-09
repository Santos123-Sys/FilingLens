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

## Smaller authorized operator fallback: single-company SEC JSON

**Recommended when the full nightly SEC ZIP is too large or operationally inconvenient.** The SEC officially exposes per-CIK CompanyFacts JSON at `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`. Obtain the **actual unmodified** JSON from that exact SEC API using an authorized operator workstation that can legitimately access the endpoint. The operator must comply with SEC access guidance and provide a real identifying User-Agent. FilingLens neither fetches it from Railway nor tunnels around a 403; if access is denied, stop and contact `webmaster@sec.gov` with the public IP and denial details. Do not supply data from scraped mirrors or AI-generated examples.

As an example **only after successfully obtaining Apple's official file through permitted access**:

```bash
# Run on an authorized workstation; replace with an operator-controlled contact address:
curl --fail --location --retry 0 \
  --user-agent "FilingLens Operator real-contact@your-organization.example" \
  --output /secure/CIK0000320193.json \
  "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"

# Run from the FilingLens repository with an authorized DB writer connection:
DATABASE_URL="<privileged MySQL URL>" npx tsx ops/import-sec-companyfacts-json.ts \
  --file /secure/CIK0000320193.json --cik 0000320193 --retrieved-day 2026-10-09
```

The `--retrieved-day` must be the **actual** date the source file was downloaded. The import validates the exact CIK, issuer name, supported SEC taxonomy, file size (100 B–12 MB), and 14-day retrieval window; preserves both the original JSON-file SHA-256 and normalized payload SHA-256; and commits only the normalized JSON to the existing `sec_companyfacts_snapshots` table. For this file-only path the existing database field `archive_sha256` stores the **original JSON-file checksum**, not a ZIP archive checksum. There is no new database table or external runtime fetch.

At research time the existing bounded crosscheck uses exactly the same CIK, accession, fiscal period, GAAP/IFRS, currency and amount gates as for the original ZIP. It labels accepted matches `operator_attested_sec_json` rather than `sec_api` or `operator_attested_sec_bulk`. The JSON origin is attested by the operator; a checksum proves stored-data consistency but **does not independently establish SEC authenticity**. The UI discloses this limitation.

Run `ops/verify-sec-acceptance.ts` (see below) after the import, using facts from an actual 10-K/20-F and never synthetic amounts. A success in CI or this import alone does not establish a completed real-data valuation comparison.

## Read-only real SEC numerical acceptance after import

After importing an authorized official archive, run the read-only acceptance command on a host with Node, tsx and a restricted MySQL `DATABASE_URL`. Supply the peer's actual filed SEC URL, as-filed annual amount and precise fiscal period; the values here illustrate the command's inputs and must be checked against the relevant filing before execution:

```bash
DATABASE_URL="<restricted MySQL URL>" npx tsx ops/verify-sec-acceptance.ts \
  --cik 0000320193 --peer "Apple Inc." \
  --filing-url "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm" \
  --metric Revenue --fy 2025 --period-end 2025-09-27 \
  --basis "US GAAP" --currency USD --amount-millions 416161
```

The command uses the application's own 14-day freshness and SHA-256-validated MySQL fallback reader and exact SEC accession/CIK/year-long taxonomy amount matcher. It exits nonzero if the sample fails validation or if the official cache is missing/stale. It also verifies that mutated amount, CIK and filing accession are rejected. JSON output records the source mode, retrieval day and payload hash. **This command is not a substitute for obtaining and importing real official SEC records.** Tests of the helper use explicitly synthetic fixtures; only a successful run over a real, authenticated operator import qualifies as numerical production acceptance.

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


## Supplied Apple transformed extracts: offline fixture validation (not SEC production data)

The repository includes the two user-supplied files under `tests/fixtures/sec/`:

- `apple_sec_companyfacts_transformed.json`: a **lossy** transformation with a 505-concept inventory and 40 sample facts.
- `apple_sec_key_financials.json`: eight metrics, five observations per metric. These are **not five unique fiscal years**: there are only three unique fiscal period ends (2023-09-30, 2024-09-28, 2025-09-27). FY2021 and FY2022 are missing. Some observations carry `fy: 2025` but concern an earlier fiscal period end; the validator groups by **period end**, not comparative filing `fy`.

To reconcile the two supplied files without SEC network access or database credentials:

```bash
npx --yes tsx ops/import-sec-companyfacts-json.ts \
  --format transformed --fixture-only \
  --file tests/fixtures/sec/apple_sec_companyfacts_transformed.json \
  --key-financials tests/fixtures/sec/apple_sec_key_financials.json \
  --cik 0000320193
```

This outputs a machine-readable `sec_transformed_validation_fixture` report, including concept and observation counts, cross-file numeric consistency, balance-sheet equation checks, deduplicated fiscal periods, missing years, and a `proofGate.status: "blocked"`. No `DATABASE_URL` is needed; the fixture branch **never opens a MySQL connection or writes** `sec_companyfacts_snapshots`. The validator rejects tampered CIK, source URL claim, taxonomy inventory, samples, comparative amounts and dates.

**Important provenance distinction:** `metadata.source_url` in the attachments is a self-declared URL, not proof that the attachments are an authentic, complete SEC download. They omit accession numbers (`accn`), XBRL fiscal-period fields (`fp`) and annual period start (`start`); these must never be invented or inferred. A transformed fixture is never labeled `sec_api`, `operator_attested_sec_json` or `operator_attested_sec_bulk`. Passing this validation does **not** satisfy the real-data production acceptance gate.

The **official** path above remains unchanged: import the original, unmodified SEC `CIK##########.json` with `--file --cik --retrieved-day` (optionally `--format official`), then run `ops/verify-sec-acceptance.ts` with the actual accession and filing. The official importer rejects both transformed attachments.
