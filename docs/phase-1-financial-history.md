# Phase 1 — source-aware financial history foundation

The first Phase 1 increment introduces `contracts/financial-history.ts`, a deterministic reconciliation component, and corresponding Vitest cases.

## Scope delivered
- Explicit FY, Q, YTD and LTM distinctions (no mixed-period comparisons).
- Metric/period/currency/unit composite identities.
- Preservation of missing observations as `null`, never fabricated zero.
- Source filing IDs, filing dates, section references and optional URLs.
- Cross-filing conflict detection without silent restatement or winner selection.
- Deterministic chronological series suitable for future UI integration.

## Not yet delivered
This component is a **foundation**, not full Phase 1. It is not yet wired into the extraction API, dashboard, database, or external regulatory providers. No durable storage or automatic filing ingestion is claimed. Existing `financials.annualHistory` remains unchanged.

## Next integration sequence
1. Define and migrate company/filing/observation storage, with normalized issuer identity.
2. Ingest verified historical facts from existing filing output, with explicit period and provenance mapping.
3. Feed reconciliation results into `financials.annualHistory` and chart validation, preserving unresolved conflicts.
4. Add a UI review panel for conflicted/restated numbers and missing periods.
5. Add multi-filing fixtures, DB integration tests, and CI validation.

Do not merge observations of unlike units, currencies, period kinds, or fiscal designations. Never treat identical filings as independent verification.
