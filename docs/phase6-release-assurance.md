# FilingLens Phase 6 — Analysis assurance and reviewable audit export

**Release scope.** The repository contained no approved Phase 5/6 milestone specification. Phases 5 and 6 were therefore implemented as the final two explicitly bounded product increments: (5) analyst decision dossier, and (6) per-analysis internal consistency gates and reproducible audit package. This completes that *feature sequence*, not every production source-integration acceptance requirement.

## Delivered milestones

### 6.1 Deterministic internal analysis-quality review
`contracts/analysis-assurance.ts` generates eight transparent checks:
- issuer name and well-formed CIK/CNPJ presence (not a registry lookup);
- financial-series period alignment, duplicate periods, finite values and available data;
- balance-sheet reconciliation and financial validation errors;
- failed/incomplete specialist execution diagnostics;
- quoted filing excerpt evidence inventory;
- manually attested analyst review from Phase 5;
- available, user-approved valuation, without implying current market quote correctness;
- Phase 3 prior-file comparison quality when a comparison exists.

Possible statuses: `pass`, `attention`, `blocked`, `not_applicable`. Overall `reviewReadiness` is `reviewable`, `attention` or `blocked`. **`reviewable` means only internal checks had no blockers or attention items**; it does NOT certify official source authenticity, audited financial accuracy, regulatory compliance, investment suitability, quote timeliness or a price target.

The separate `officialRegulatoryAcceptance` field is always `not_demonstrated` under this mechanism, regardless of review readiness. Real SEC CompanyFacts numerical production acceptance remains tracked in GitHub issue #52. The report does not make a live SEC or CVM call.

### 6.2 Explicit portable audit-bundle export
The Phase 6 browser workspace exports a JSON package **only when the user requests it**. Package contains:
- `schema: filinglens.audit_bundle.v1`
- `createdAt` with exact UTC timestamp
- analyzed FilingLens v2 data, including reported figures and provenance
- optional Phase 3 comparison (unverified discrepancy candidates)
- Phase 5 analyst-written dossier and review declarations
- independently recomputable Phase 6 internal-check report
- `sha256` of compact `JSON.stringify` of the payload **without** the checksum field.

The checksum detects accidental edits. It is **not** a digital signature, external timestamp attestation, tamper-proof evidence or proof that market/SEC source observations are authentic. An actor who can rewrite the file can generate another valid checksum.

Full analysis JSON and user notes can contain private financial research or excerpts. No background upload, new database table, cloud storage, model call or automated sending is introduced.

### 6.3 Independent operator verification
After downloading the audit bundle, run:

```bash
npx --yes tsx ops/verify-phase6-audit.ts /secure/filinglens-audit-us-EX.json
```

The CLI rejects malformed/oversized packages, checksum mismatch and internal report inconsistencies. It recomputes the dossier and all quality checks from the bundled original analysis and analyst declarations. It reports `valid`, issuer name, `reviewReadiness`, and `officialRegulatoryAcceptance`. It **does not** confirm that cited SEC filings or market numbers came from a trustworthy external source.

### 6.4 CI + production release checks
- CI must pass TypeScript, Vitest, Python service checks and production build before merge.
- Negative tests cover duplicate fiscal years, financial array mismatches, red financial flags, manual review pending, corrupted SHA-256 and modified assurance fields.
- Railway auto-deploys the exact merged SHA. Verify final `FilingLens` and `filinglens-data-tools` deploys both reach `SUCCESS` and health state online.
- Existing official SEC source-access/acceptance blocker (#52) remains separately open. A green audit export cannot close it.

## Follow-up beyond the six scoped feature increments
1. Obtain an original, authorized SEC CompanyFacts record; run accession-linked numerical acceptance against the production database (#52).
2. Verify genuine CVM issuer/source identity and financial data against a real live sample.
3. Real-company acceptance for file-to-file comparison, DCF research, investor export and private analysis history, including realistic failed/partial cases.
4. Decide whether to introduce durable collaboration and a signed, centrally managed provenance ledger. An unsigned browser file is not one.
