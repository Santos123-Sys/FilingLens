# FilingLens Phase 4 — Valuation materiality and research triage

This release adds a deterministic **decision-support** workspace, not an autonomous investment agent or recommendation engine. It builds on Phase 3 filing-change signals, existing user-approved DCF output and the existing analysis missing-data inventory.

## Delivered
- Valuation sensitivity from a **completed, user-approved DCF** only. Reads the existing 5×5 WACC × terminal-growth grid. Checks axis ordering, exact center/assumption consistency and center implied-per-share value before publishing any sensitivity.
- Uses the central finite difference between adjacent grid points to estimate the per-share effect of a **+1 percentage point** perturbation in WACC or terminal growth. Sorts the two comparable *local* numerical impacts by absolute magnitude; displays signed effects and units.
- Fails closed if the DCF is absent, if a grid neighbor is unavailable (e.g. WACC <= g) or if axes/base values are inconsistent. No market price, FX, discount, recommendation or price target is inferred.
- Builds a bounded, source-aware research queue from: Phase 3 overlapping-period discrepancies; unapproved/uncited DCF assumptions; and existing analysis missing-data flags. No autonomous search or private filing upload occurs.
- Preserves two important distinctions: a user-approved assumption is not independently verified, and a model-extracted cross-filing discrepancy is not an official restatement.
- Bilingual on-screen workspace with source links where the evidence contains an explicit HTTPS citation.
- Unit tests for central differences, axis errors, missing grid neighbors, no approved DCF, and evidence queue priority.

## Numerical interpretation
DCF grid axes are percentage points, not decimals. The slope is:

`(value at upper neighboring grid point - value at lower neighboring grid point) / (upper pp - lower pp)`

This is a *local linear estimate*, not a full +1pp DCF rerun; nonlinear WACC–terminal-growth interactions may make larger changes materially different. The system does not label this as portfolio risk, expected return, valuation certainty or investment advice.

## Release acceptance
- TypeScript check, Vitest and production build pass.
- Both Railway main application and data-tools deployments reach SUCCESS on the merged commit.
- The SEC CompanyFacts real-data production acceptance issue #52 remains independent and open until official accession-linked data is imported and checked.
- Future increments: validated quote-vs-valuation margins of safety (requires independently sourced synchronized market price), scenario-driven monitoring and cross-company watchlists (requires a durable identity/permission design), and genuine official filing restatement adjudication.
