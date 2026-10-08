# Phase 1: validated historical ingestion

The Phase 1 ingestion mapper converts extracted financial series into source-backed `FinancialObservation` objects. It requires verified filing ID, filing date, fiscal period metadata, currency, unit and exact per-metric/per-period evidence.

Uncited numbers are excluded and reported as issues rather than persisted with invented provenance. The mapper is not automatically invoked by the public API. Call `prepareFinancialObservations` after obtaining verified period-end metadata; write via the opt-in `createHistoryStore` only after the MySQL schema has been migrated and appropriate authentication has been implemented.

## Railway production observation
As checked on October 8, 2026, the FilingLens production Railway project had no MySQL service and its application lacked a `DATABASE_URL` variable. The history store must stay disabled until provisioned and migrated. No database or live environment variables are changed by this PR.

## Deployment prerequisites
- Provision a private MySQL service with backups and a tested restore procedure.
- Set `DATABASE_URL` on the application through a Railway service reference (do not put credentials in Git).
- Apply a reviewed Drizzle migration in a controlled maintenance step, with backup taken first.
- Configure authentication/authorization and request limits before introducing read/write history endpoints.
- Confirm coverage of actual filing citations and fiscal period-end dates; never synthesize those from calendar-year labels.

## Future wiring
1. Connect the existing financial output processor to the mapper.
2. Save normalized company identity, filing, then its validated observations transactionally.
3. Derive `annualHistory` using the existing adapter and show unresolved source conflicts.
4. Add integrated DB and UI tests using multi-filing fixtures.
