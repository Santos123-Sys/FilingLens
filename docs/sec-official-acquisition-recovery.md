# SEC official-data acquisition recovery — 2026-10-09

## Why we are not bypassing the 403

Railway egress to `https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json` returned HTTP 403, even with a declared SEC User-Agent; the SEC nightly ZIP route was also denied. **No host/IP rotation, stealth proxy, alternate-domain laundering or retries on denied responses are permitted.** The SEC asks blocked users to contact `webmaster@sec.gov`, providing the denial text and public egress IP.

**Official source:** https://www.sec.gov/search-filings/edgar-application-programming-interfaces
**Denial guidance:** https://www.sec.gov/files/about/webmaster-faq.htm

## Implemented recovery: separately authorized official acquisition

There are **two** compliant source-acquisition environments to choose from:

1. A workstation which has *legitimate SEC access*. Run `ops/acquire-sec-companyfacts.ts` directly there.
2. The `Official SEC CompanyFacts acquisition (operator)` GitHub Actions **manual** workflow, using the real `SEC_CONTACT_EMAIL` GitHub Actions repository secret, configured by the owner in GitHub Settings. GitHub-hosted runner egress **may also be blocked**; success is only established by an actual HTTP 200 from the exact `data.sec.gov` URL and validated full JSON payload. Do not use the workflow as a surrogate for bypassing a blocked/denied provider network.

The acquisition makes **one bounded request**, disallows redirects, requires the exact official URL and JSON content type, verifies the issuer CIK/SEC taxonomy, preserves the untouched response bytes and creates a SHA-256 receipt with actual UTC retrieval day. 403/429 are terminal. The repository never stores live CompanyFacts as a committed fixture, and the existing user-supplied Apple transformed extracts remain fixture-only.

### A. Authorized workstation

Install Node.js dependencies (`npm ci`), then supply a **real contact email that belongs to the operator**, never an invented/anonymous identity:

```bash
export SEC_CONTACT_EMAIL="real-contact@YOUR-DOMAIN"
npx --yes tsx ops/acquire-sec-companyfacts.ts \
  --cik 0000320193 --output /secure/CIK0000320193.json
```

Creates:

- `/secure/CIK0000320193.json` — **original SEC bytes**.
- `/secure/CIK0000320193.json.sec-receipt.json` — official requested URL, issuer, acquisition timestamp, source SHA-256, normalized SHA-256, size.

This receipt records **operator-observed provenance**, not an SEC cryptographic signature. An attacker with authority to rewrite the response and receipt could spoof them; only the authenticated official SEC HTTP transaction supports the source claim.

### B. Official GitHub Actions acquisition

1. In repository **Settings → Secrets and variables → Actions**, add repository **secret** `SEC_CONTACT_EMAIL` containing a real operator-controlled email address. This is not an API key. No fake contact or default email is supplied.
2. Open **Actions → Official SEC CompanyFacts acquisition (operator) → Run workflow**, select `main`, and enter exact 10-digit CIK `0000320193` for Apple. This is a **manual** workflow and intentionally never runs on unsolicited PRs.
3. If the GitHub runner receives SEC HTTP 403, stop; follow the SEC webmaster route rather than trying a different proxy, identity or IP to evade the denial.
4. On success the workflow validates the original response. For Apple FY2025 it also runs an **exact-accession numerical check** against FY2025 revenue USD 416,161 million using the actual SEC CompanyFacts payload and three fail-closed negative controls.
5. Retrieve the short-lived artifact `official-sec-companyfacts-0000320193-<run_id>` (three-day retention). Download to the authorized operator machine; preserve both original JSON and matching receipt unchanged. The workflow does **not** upload real data into the public Git repository or disclose your contact email in script output.

### C. Offline verification before production import

From the authorized workstation:

```bash
npx --yes tsx ops/verify-sec-json-acceptance.ts \
  --file /secure/CIK0000320193.json \
  --receipt /secure/CIK0000320193.json.sec-receipt.json \
  --cik 0000320193 --peer "Apple Inc." \
  --filing-url "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm" \
  --metric Revenue --fy 2025 --period-end 2025-09-27 \
  --basis "US GAAP" --currency USD --amount-millions 416161
```

This confirms the exact accession, full FY period, SEC issuer name, taxonomy, currency, numeric value and three required negative controls **against the genuine payload** before connecting to any database. The as-filed revenue and URL are Apple FY2025 reference inputs; successful verification still needs an authentic SEC JSON response.

### D. Import into production MySQL

The existing operator-only JSON importer now also supports optional receipt binding:

```bash
DATABASE_URL="<privileged operator MySQL URL>" \
 npx --yes tsx ops/import-sec-companyfacts-json.ts \
 --file /secure/CIK0000320193.json \
 --receipt /secure/CIK0000320193.json.sec-receipt.json \
 --cik 0000320193 --retrieved-day <ACTUAL_DATE_FROM_RECEIPT>
```

Obtain the privileged database URL through approved Railway access, **not** from application frontend or public code. The CLI checks that raw JSON, SHA-256 receipt, CIK, source URL and day all match **before** any database write. The restricted production app retains read-only access to the cache.

Finally run the existing **read-only production** acceptance CLI from a host with a working authorized DB connection:

```bash
DATABASE_URL="<restricted read-only MySQL URL>" \
 npx --yes tsx ops/verify-sec-acceptance.ts \
 --cik 0000320193 --peer "Apple Inc." \
 --filing-url "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm" \
 --metric Revenue --fy 2025 --period-end 2025-09-27 \
 --basis "US GAAP" --currency USD --amount-millions 416161
```

**Only** close [#52](https://github.com/Santos123-Sys/FilingLens/issues/52) when a genuine official payload has actually been acquired, verified, imported, re-read from Railway MySQL and passed all positive and negative numerical acceptance controls, with accepted sourceMode accurately labeled (operator-attested JSON, not direct Railway SEC API). CI, transformed fixtures, a green deployment, or a successful acquisition without production DB import **do not** close that issue.
