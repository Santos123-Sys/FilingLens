# FilingLens Phase 1 — Operations and recovery runbook

Last reviewed: 2026-10-08.

## Services and data ownership
- Railway production **FilingLens**: Node/Hono application. The Cloudflare/stateless Worker does not import the MySQL history store.
- Railway production **MySQL**: persistent `/var/lib/mysql` volume, private-network connection.
- **filinglens-phase1-schema-migrator**: schema verification and restricted MySQL application user initialization.
- **filinglens-history-backup**: encrypted logical backup job, UTC daily at `0 3 * * *`.
- Private Railway object storage bucket **filinglens-phase1-backups**: stores encrypted compressed logical backups.
- Only Railway environment variables reference DB, API and object-storage credentials. Never place secrets in this repository.

## Five Phase 1 tables
1. `companies` — public issuer identity.
2. `filings` — source filing identifiers.
3. `financial_observations` — evidence-backed observations.
4. `regulatory_snapshots` — **public** official SEC/CVM annual facts, grouped by issuer and day.
5. `private_analysis_history` — **opt-in browser-session** financial-analysis summaries.

The first four are not interchangeable with private saved analyses. Private-session data must **never** be served from the regulator history endpoint. The public regulator snapshot path omits PDF contents and unverified claims.

## Production integration
- The existing `/api/internal/history/*` routes require a bearer secret and the restricted DB connection.
- `/api/regulatory-data` archives official annual facts automatically when evidence, issuer and provider checks pass. When the external regulator provider is unavailable, storage must be skipped and filing analysis continues.
- `/api/regulatory-history/:jurisdiction/:registryId` serves official public snapshots only.
- `/api/history/session` establishes a signed, HttpOnly, SameSite=Strict browser session on explicit user interaction.
- `/api/history/save`, `/api/history/mine` use that session, and mutations require a CSRF header. No user account or cross-device syncing exists.
- Browser history is optional and excludes uploaded PDFs. The maximum is 20 saved filing records per browser session. Users can delete the active browser's history.

## Backup operations
Deployed Railway Function source is versioned in `ops/phase1-history-backup.ts.txt`. The live Function must be intentionally updated to match this version when modified; GitHub merging the text file does not redeploy it.

- All five tables are read under a repeatable-read consistent snapshot.
- The logical JSON snapshot is gzip compressed and encrypted with AES-256-GCM using a Railway-secret-held encryption key.
- The ciphertext envelope is uploaded to the private Railway bucket under `phase1/`.
- The function reads the object back, checks the authenticated encryption tag and SHA-256 checksum, recreates scratch tables with `CREATE TABLE ... LIKE`, writes the rows into scratch tables, and compares canonical row checksums.
- Scratch tables are dropped; live business data is not overwritten.
- Historical encrypted objects are retained for approximately 30 days (subject to provider storage behavior and successful scheduled execution). The worker limits each table to 50,000 rows: if that limit is exceeded it **fails closed**, rather than returning a misleading partial backup.
- Inspect `PHASE1_BACKUP_RESTORE_VERIFIED` in Railway deploy logs and investigate any `CRASHED` or missing daily execution.

### Recovery limitations
The scratch-table restore test does not establish the ability to recover the entire Railway project or restore into a separate cloud account. A new isolated-target full disaster-recovery exercise remains necessary. Loss of both the Railway bucket and its encryption key makes historical backup recovery impossible. Store the backup encryption key in a separately controlled secret-recovery mechanism; do not export it into Git.

## Schema changes and rollbacks
The deployed schema initialization function source is in `ops/phase1-schema-migrator.ts.txt`. The Drizzle schema is in `db/schema.ts`.

- For new migrations, generate and review a versioned SQL migration; take a confirmed backup before deployment.
- Do not run blind `drizzle-kit push` or `db:migrate` against existing production: initial tables were created using Railway's schema initializer rather than an automatically tracked Drizzle migration journal.
- Ensure the backup function's table list and restore test are updated whenever a new table is introduced.
- Always merge after GitHub CI, verify final Railway `SUCCESS`, then test authorized writes, isolation and retrieval.
- On failures, revert application code or Railway variables rather than deleting tables or volumes. Reverting app code does not automatically undo a database schema change.

## Assurance record
- Signed private-history save/read/delete test: passed using synthetic session data, then the records were deleted.
- Public regulator-archive route: reachable; a test returned **zero official data** because the upstream provider reported unavailable. Do not call the archival data path end-to-end verified until supported regulator facts are observed in production.
- Encrypted backup retrieval and integrity: verified. Scratch-table restoration verified with populated company/regulatory records; the temporary private-history fixture was separately removed.
- Full isolated-target disaster restore: not yet verified.
