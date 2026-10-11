# Issuer-primary evidence integration (separate from SEC/CVM regulatory facts)

This opt-in integration serves **Apple FY2025 only**, as an explicitly
**issuer-published, unaudited PDF** proof. It does not remedy SEC CompanyFacts
HTTP 403 and must not be described as regulatory source verification.

The existing `/api/integration/v1/issuers/us/:cik/financial-snapshot`
endpoint remains **official SEC/CVM only**. It must continue returning 404
when no authorized public-regulator archive exists.

## Read contract

`GET /api/integration/v1/issuers/us/0000320193/issuer-statement`

Requires `Authorization: Bearer <FILINGLENS_ISSUER_PRIMARY_API_TOKEN>`, with no response
cache. Operator opt-in: `FILINGLENS_ISSUER_PRIMARY_ENABLED=true`.

The `filinglens-issuer-primary-v1` response reports four FY2025 values
in USD millions (net sales 416161, gross profit 195201, operating income
133050, net income 112010), with `secCompanyFactsVerified:false`,
`provenance:issuer_published_unaudited_pdf`, the issuer PDF URL, byte hash
and an envelope content hash. No FY2024/25 growth is asserted.

All figures are checked by the existing
`verifyIssuerApple2025Point` function against the fixed source PDF, and
the PDF bytes must match the SHA-256 accepted by the real-source run
on October 9, 2026:
`43e7f0730b3cce0fc37301a2f43c29712bbde6ab299d97c6df345fd0c754508a`.
The source is the exact Apple-owned URL and no private filing upload, user
identity, market prices or risk data is transferred.

A changed PDF, extraction mismatch, unsupported CIK or unavailable origin
fails closed (404/503), never returns stored synthetic values. Tests using
mocked documents are not a substitute for a real-source staging check.

## Release gates

1. Run tests, typecheck and build in GitHub CI.
2. Confirm publisher can fetch the exact source PDF and its accepted SHA.
3. Deploy the publisher with opt-in disabled initially; confirm 401 without
   token and 503 when disabled.
4. Enable opt-in only after an authorized staging retrieval returns 200,
   and GPI validates the digest, identity and provenance.
5. Keep `FILINGLENS_READ_ENABLED` (regulator-only) separately gated until
   a real SEC/CVM archived record is available.
