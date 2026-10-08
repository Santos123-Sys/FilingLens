# FilingLens Phase 1 — Private browser-scoped company history

## Model
The public FilingLens site does not have accounts or workspaces. To avoid a globally writable company history, users explicitly opt in to a **browser-scoped** private history. A random 256-bit session identifier is signed server-side and retained in an HttpOnly, SameSite=Strict cookie for up to 90 days. The secret is configured only as a Railway environment variable. No raw session identifier is persisted in the database. Company identity is SHA-256-derived from the session plus jurisdiction and registry identifier, so unrelated visitors never share an issuer record.

Only annual figures from a filing with a **verified date** and **specific metric + period evidence** are eligible for automatic ingestion. A bare year label such as 2024 is never converted to 2024-12-31 without dated evidence. Users see why unsupported values were skipped. Uploading analyses is best-effort and does not interrupt the existing analysis.

The Financials tab shows saved metric history by fiscal year, original source sections and filing IDs, conflicts, unverified single-source facts, missing values, and a delete action for that specific issuer. Conflicts are not automatically resolved. A private session is not a substitute for account-level identity, a team workspace, or long-term archival. An expired or lost cookie cannot recover its browser workspace; database lifecycle cleanup should be scheduled.

## Safety and privacy
- The legacy internal operator history API continues to require its own bearer secret.
- Browser history can only read, modify or delete company records scoped to its signed cookie.
- State-changing endpoints reject requests without a matching Origin header.
- Historical evidence remains "filing-supplied": citation sections are not independent confirmation of accuracy.
- The default is **no storage without explicit opt-in**. No PDFs are stored.
- Avoid attaching other users' filings to a saved analysis. All user-generated claims remain in their private scope.

## Delivery checklist
- [x] deterministic reconciliation and annual adapter
- [x] MySQL with source-backed facts
- [x] internal bearer-protected API with verified write/read
- [x] browser-scoped opt-in ingestion and historical dashboard
- [x] conflicting source values rendered with provenance
- [ ] enable HISTORY_COOKIE_SECRET in Railway production
- [ ] CI + deployment + browser-scoped end-to-end verification
- [ ] Railway volume daily backup enabled, and independent restore validated

## Railway configuration
Set HISTORY_COOKIE_SECRET to a generated 48–64-byte random secret on the FilingLens **application** service, not in the repository. Existing DATABASE_URL stays attached with the restricted database user. Rollouts are automatically triggered by the existing GitHub main branch service.

Backup/restore must be a separately confirmed operation; a persistent volume alone is not a backup.
