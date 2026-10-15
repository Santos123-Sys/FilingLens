# SEC access recovery

Scheduled and operator-dispatched acquisition are paused after the official CompanyFacts endpoint returned HTTP 403 in [run 38711218906](https://github.com/Santos123-Sys/FilingLens/actions/runs/38711218906). This is an external access denial, not missing contact configuration: signed OIDC contact loading succeeded. The pause applies to primary filings and CompanyFacts and runs before contact loading in both acquisition workflows. Paused jobs fail visibly and archive a receipt with zero attempted requests. Existing stored snapshots are not refreshed by this change.

## Operator recovery

1. Contact SEC support using the official [webmaster FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions). Include the UTC timestamp, exact official API URL, HTTP status, genuine operator User-Agent/contact, and GitHub run link. Keep private contact details out of public issues. No support message is sent automatically.
2. Confirm authorization/fair-access requirements for the original acquisition network. Do not rotate IPs, use a proxy/tunnel to defeat the denial, or repeatedly retry HTTP 403/429. Do not probe from another service while this incident is open.
3. Record actual clearance and its scope in a repository issue or PR. Change `config/sec-acquisition-access.json` from `paused` to `reviewed` and set `reviewReference` to that issue/PR. This is an operator attestation, not proof of SEC approval. Review and merge the policy change before manually dispatching a single bounded acquisition. Do not clear the pause merely because CI passed.
4. Require an original official JSON response, a matching acquisition receipt, successful signed import, verified readback and current retrieved date for each planned issuer. Archive the receipt even on failure. A 403/429 stops immediately; re-pause the checked-in policy before any further run. Current per-request code never retries; future denial still requires operator re-pause across runs.

## Existing lawful original-file lane

An operator who already possesses lawfully obtained, unmodified official SEC JSON may use `ops/import-sec-companyfacts-json.ts` or the signed OIDC importer with the original bytes and truthful retrieval date/receipt. See the CLI's validation requirements. Do not acquire those bytes through a new network to bypass the active denial. Operator-attested provenance remains distinct from a direct acquisition receipt. Transformed samples, model output and issuer earnings releases cannot satisfy SEC acceptance.

## Completion evidence

Access is restored only when a cleared acquisition run and verified import/readback succeed. A paused receipt, local regression tests, ordinary deployment health or issuer-published financial statements do not close that gap.
