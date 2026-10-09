# GitHub Actions → Railway secure SEC JSON import

## Purpose
PR #61 introduced official CompanyFacts acquisition from an authorized operator network and read-only accession matching, but transferring a verified file into Railway MySQL still required an external privileged database connection. This increment removes that *operator database-transport* dependency using a single-purpose Railway Function with **signed GitHub Actions OpenID Connect (OIDC)** authorization.

This does **not** change the SEC 403 response in Railway or claim an SEC exemption. The acquisition workflow still must obtain a real 200/JSON response from the official SEC API through permitted access. A source denial ends the workflow; do not evade the denial using IP rotation, stealth or unauthorized proxies.

## Security model
- The dedicated Function requires a properly signed GitHub `RS256` JWT validated against the official GitHub OIDC JWKS at `https://token.actions.githubusercontent.com/.well-known/jwks`.
- Exact audience `filinglens-sec-json-import-v1`; issuer `https://token.actions.githubusercontent.com`; repository `Santos123-Sys/FilingLens`; immutable repository ID `1405671411`; branch `refs/heads/main`; GitHub event `workflow_dispatch`; and precise acquisition workflow path. The token must be valid and recent. **A pull-request workflow cannot authorize an import.**
- The Function never follows caller-specified source URLs. Uploaded bytes require the fixed SEC URL, exact company CIK, SEC schema with original taxonomy, bounded size, a matching original-byte SHA-256 and a matching timestamped receipt.
- For Apple FY2025 the Function checks original-form 10-K accession `0000320193-25-000079`, period 2024-09-29–2025-09-27, FY, US GAAP, exact USD 416,161 million revenue, plus *executed* incorrect-amount, issuer and accession negative controls.
- A DB write uses a parameterized statement only for `sec_companyfacts_snapshots`, followed by a read-back confirming canonical SHA, source URL and retrieval day. The imported data remains labeled `operator_attested_sec_json`, not directly fetched from SEC by Railway.
- The handler accepts no unauthenticated write. Only `GET /health` is public, revealing whether a DB variable is set, not its content. No MySQL URL or OIDC token is logged.
- Railway environment-scoped `DATABASE_URL` is secret and must have **only** permissions needed for the SEC cache (SELECT, INSERT, UPDATE). Configure a dedicated DB user before production if operationally available; avoid root credentials.

## Activation
1. Merge code after typecheck, tests and build.
2. On Railway create a **dedicated Function** called `filinglens-sec-oidc-importer` from the exact contents of `ops/railway-sec-oidc-importer.ts`. This is a separate service, not an auth route in the main application.
3. Configure `DATABASE_URL` via Railway service variables or a private reference to a least-privilege MySQL user for `sec_companyfacts_snapshots`. The deployed Function references the existing FilingLens database connection rather than putting any credential in GitHub. `/health` now checks actual MySQL connectivity and the SEC cache table; readiness is not equivalent to a successful data import.
4. Generate a TLS Railway service domain. For public ingestion it must be HTTPS and end `.up.railway.app`. The Function validates GitHub's OIDC identity independently; never publish a bare unauthenticated MySQL endpoint.
5. The production Railway Function is provisioned at `https://filinglens-sec-oidc-importer-production.up.railway.app/v1/sec/import`; the manual GitHub workflow has this URL pinned. The already configured Railway `SEC_CONTACT_EMAIL` is read from the Function's `GET /v1/sec/contact` endpoint by the manually dispatched GitHub workflow using a short-lived signed GitHub OIDC JWT. The workflow masks it and makes it available in that job via `$GITHUB_ENV`; no GitHub repository secret or variable is needed. No GitHub-side database credential or import token is needed.
6. Manually trigger **Actions → Official SEC CompanyFacts acquisition (operator) → Run workflow** with `0000320193`. The workflow downloads the unmodified SEC file only if permitted, validates the accession and raw receipt, stores a three-day artifact, then obtains a GitHub OIDC JWT and uploads to Railway.
7. The upload step requires `imported: true`, `readbackVerified: true`, matched canonical SHA and for Apple `referenceProof.status: verified`. HTTP 403 or a mismatched source fails the run; no fake production cache rows are written.

## Further proof required before closing #52
A successful Actions run provides an authenticated GitHub-workflow import and Function MySQL readback, but to prove the **actual FilingLens application** reads the new production snapshot, run `ops/verify-sec-acceptance.ts` using the restricted application database credentials inside an authorized Railway environment. Confirm sourceMode `operator_attested_sec_json` and the three negative controls. Only then consider closing #52, with the exact workflow run, receipt hashes, retrieval date and verified numeric accession documented.

If genuine SEC access is denied everywhere authorized, stop. The upstream site owner (SEC) must approve/restore access or an operator must obtain an official archive by an explicitly permitted channel. Software cannot lawfully declare unavailable original data to have been acquired.

## Operator contact source-of-truth

The **only** configured `SEC_CONTACT_EMAIL` resides on the dedicated Railway importer service. A read-only `GET /v1/sec/contact` requires the same verified GitHub OIDC identity as the import route and returns the address to the authorized one-run workflow. The job masks the value before writing its environment file; the contact is never committed to the repository and the endpoint rejects unauthenticated requests with HTTP 401. Changing the Railway variable updates future manual runs without touching GitHub Actions secrets. A GitHub workflow with incorrect branch/repository/event/audience cannot retrieve it. This does not resolve upstream SEC 403 if the runner is separately blocked.
