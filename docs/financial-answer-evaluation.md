# Financial answer quality and production gaps

The earlier retrieval evaluation measured excerpt retention. This suite adds actual production financial model answers with independently transcribed issuer table labels and deterministic scoring. It does not use a model to judge itself. Labels are never sent to the model endpoint.

## Frozen suite

Two original English-language issuer statements: Apple FY2025 (existing PDF/text hash) and Microsoft FY2025 income statement, with original HTML and extracted-text SHA-256 identities. Labels cover 34 distinct metric/year facts across annual 2023–2025, including GAAP net income versus adjusted income and annual versus quarter columns. The Microsoft page is an issuer publication, not SEC API verification. No dataset license is assumed for third-party benchmarks.

Each statement runs unchanged and with an appended hostile instruction to invent revenue, plus a separate synthetic withheld-table control. Thus there are six model calls, 68 amount checks (34 unique facts, duplicated across the hostile variants) and 20 absent-series checks. Synthetic controls are explicitly identified; they do not expand the count of real issuers. New production changes are evaluated with the frozen labels, not tuned labels.

The conjunctive gate requires every amount, period and explicit USD scale to match, every scored fact to have a source-bound numeric quote, and every absent metric to remain absent. Failure and omitted cases fail the gate. An HTTP/provider error stops subsequent calls without retry. Unknown currencies and ambiguous units fail closed. Exact span existence plus an expected number is a numeric citation check, not a proof of narrative entailment or correct table-column interpretation.

```bash
# Re-score captured public-only answers without inference:
node ops/financial-answer-evaluation.mjs --replay docs/evaluations/financial-answers-2026-10-15
# Explicit bounded production inference, six serial requests, no automatic retry:
node ops/financial-answer-evaluation.mjs --live /tmp/financial-answer-evaluation
```

The live command sends only these public/synthetic sources to the existing configured production provider. It never reads local credentials or private uploads. Captures contain public-source model results. The ordinary CI suite tests the grader and source binding without paid calls.

## Baseline and resulting fix

Before the fix, the frozen live suite returned 68/68 correct amounts and 20/20 correct abstentions, but **0/68 source-bound citations**. Financial evidence used paraphrased table summaries and aggregated metric/period identifiers despite being labelled exact excerpts. This was invisible to schema-only validation.

The financial agent now requests canonical single-metric/per-period exact spans. A server-side binder removes paraphrases, unknown metrics and mismatched periods before financial tools use evidence. Rejected/missing citations remain visible through validation flags, incomplete diagnostic status and reduced confidence. Extracted amounts remain available for human verification; this binder does not independently certify numerical accuracy. The model completion allowance rises from 2,600 to 6,000 tokens to accommodate bounded per-period citation records (still at most forty). No extra inference call is added to ordinary analysis.

## Remaining acceptance boundaries

This is a measured financial extraction slice, not broad general question-answering evidence. It still needs more issuers, Portuguese/CVM and complete long filings, independent narrative entailment labels, repeated trials and explicit inference cost measurements. Report the actual gate outcome even when amounts pass. Do not describe the entire RAG system as validated from this suite.

Authenticated production usability is still unverified because the secure sign-in request was declined on 2026-10-15. Local browser tests and public endpoint health do not substitute for that check. Once a user-authorized signed-in session is available, verify source selection, embedded FilingLens identity, human valuation approval, portfolio handoff and logout on production; never bypass authentication or seed production accounts for this test.

SEC access remains externally denied until official access clearance, acquisition and verified readback succeed. See [SEC access recovery](sec-access-recovery.md). Issuer publications in this evaluation do not replace SEC provenance.
