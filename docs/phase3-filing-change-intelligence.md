# FilingLens Phase 3 — Filing-to-filing change intelligence

**Scope:** deterministic, read-only comparison of two user-provided FilingLens v2.0 analyses. The current analysis is on screen; the user selects a previously exported JSON. This is not an automatic SEC/CVM filing monitor, official restatement determination or audit.

## Implemented
- Browser-only prior JSON import, max 2 MB; no server request or database write.
- Issuer identity lock: exact regulator CIK/CNPJ, or (only when neither analysis has an ID) strict ticker + exchange + name.
- Strictly later valid filing date required.
- Comparable numerical rows only when source-declared unit, known accounting basis, statement scope and explicit fiscal year-end match.
- Numeric discrepancy candidates only for overlapping, unique fiscal-year labels and aligned finite series; never compare FY with Q/YTD/LTM or different fiscal years.
- Both source references retained for a two-source review status. Missing sources are flagged; no verified-restatement status is produced.
- New and removed fiscal-year coverage shown separately from numeric discrepancies.
- Exact normalized risk-title additions/removals (wording only, not semantic changes).
- Bilingual local comparison UI and negative tests for issuer mismatch, period mixing, currency/basis/scale, missing evidence, zero denominator, duplicate FY labels and date order.

## Acceptance and limitations
CI: `npm run check && npm test && npm run build`. Test fixtures are synthetic and never prove a live regulatory restatement. This comparison operates on existing extracted/validated analysis JSON; source extraction mistakes may produce false discrepancy candidates. Actual SEC/CVM filing downloads, authenticated provenance and real issuer restatement adjudication are separate production gates. No automatic periodic fetching or alerts are implied.

## Phase 4 boundary
The next increment prioritizes **which filing discrepancies and valuation assumptions warrant research**. It must not convert Phase 3 change signals into unsupported price targets, recommendations or confirmed company disclosures.
