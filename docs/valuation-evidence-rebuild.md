# Evidence and valuation rebuild — 2026-10-09

## Why the screenshot sections were missing

1. SEC CompanyFacts requests returned HTTP 403. Retrieval and UI implementation cannot independently remove that upstream restriction. The repaired pipeline tries a bounded, fixed-URL Micron issuer-release fallback and labels it `issuer_disclosure`; it does not claim SEC verification.
2. Financial completeness declared an 8-K inapplicable before checking whether it contained an earnings exhibit. Completeness now examines recovered statement content first.
3. Micron's `Quarterly Business Unit Financial Results` heading was absent from market retrieval targeting. Deterministic recovery now binds the four business-unit revenue rows to their exact excerpt, periods and disclosed scale. Currency must be disclosed or supported by the Micron-specific issuer identity.
4. The supplied release has no geographic revenue table. The UI now distinguishes a missing disclosure from an extraction gap and explains which additional source is required. It never substitutes competitors' locations for issuer sales geography.
5. The history comparison could describe values derived from the same filing as independent alignment. The workbench distinguishes same-source comparisons from external corroboration. Five year labels alone no longer establish complete statement coverage.

## Milestones and acceptance

| Milestone | Delivered behavior | Verification |
|---|---|---|
| M1: evidence diagnosis and repair | Content-based financial applicability, segment recovery, explicit geography coverage, same-source comparison labels | Real Micron table fixtures and negative controls |
| M2: annual history fallback | Five annual GAAP slots from fixed public Micron releases, publication cutoff, actual fiscal dates, hashes and provenance | Fixture tests; live HTTP acceptance recorded separately |
| M3: DCF calculation rebuild | Annual base only, explicit currency/millions/million shares, editable base revenue, signed equity adjustments, bounded assumptions, accepted-edit retention, duplicate/blank rejection | Independent level-perpetuity and discount-timing calculations; scale invariance and quarterly/YTD rejection |
| M4: Comps calculation rebuild | Analyst-selected metric and fiscal tolerance, full-year peer durations, minority/preferred claims, synchronized quotes, median/quartiles and explicit issuer equity bridge | Four-peer even median, component tampering, missing-source, annual-duration and currency gates |
| M5: analyst workflow | Prepare → review → calculate, grouped assumptions, peer component form, reviewable automatic research, editable source inputs, invalidation of stale results, JSON audit export | Type check and build; browser acceptance remains to be recorded |
| M6: release assurance | Expanded suite includes contracts and browser-side financial helpers; PR, CI and deployment verification | Local 253 tests passed; external release evidence to be recorded after delivery |

## GitHub project selection

| Project | Observed capabilities | Integration decision |
|---|---|---|
| [FinanceToolkit](https://github.com/JerBouma/FinanceToolkit) | Transparent Python valuation formulas; MIT license | Adapt only scalar discount timing, perpetuity and EV formulas to the existing TypeScript stack. Pin `a232ddf84d4bb2da17e5385b7862873b6943c2a8`; preserve license and attribution in `vendor/financetoolkit`. |
| [Equity Research Lab](https://github.com/mariasfondrini/equity-research-lab) | Configurable DCF, Comps, sensitivity, normalization, SEC/Yahoo providers and Streamlit | Inspected at `29f5b1daf4b55dc6c630c95952e02cd5123ac96e`. Use as a workflow reference; do not import its separate Python/UI stack or assume its SEC connector fixes hosted 403 errors. No upstream code copied. |
| [OpenBB](https://github.com/openbq-org/OpenBB) | Data-provider integration, Python API server, analyst workspace connections | Current repository states Apache 2.0 (the earlier AGPL assessment was outdated). Defer a separate provider service until a concrete licensed data requirement justifies it; no OpenBB code imported. |

This is a small FinanceToolkit formula integration, not installation of its complete toolkit, market providers or hosted MCP service. Public formulas do not provide missing financial inputs or remove provider access restrictions. Automatic preparation proposes available filing-derived assumptions and source-linked peer components; analyst edits and approval determine the final calculation.

## Numerical conventions

- DCF and Comps money inputs use currency millions; diluted shares use million shares; results show currency/share.
- Annual cohorts are selected from FY labels or annual filing forms. Ambiguous bare-year labels in an 8-K do not automatically seed annual DCF forecasts. Quarter/YTD values are never multiplied into annual estimates.
- Operating NWC is A/R + inventory − A/P. FCFF is EBIT × (1 − tax rate) + D&A − capex − change in NWC. The effective-tax proxy and weighted-average shares require forward-rate/current-dilution review.
- A finite, positive WACC must exceed terminal growth. Terminal value is discounted over the five-year horizon. Invalid sensitivity/scenario cells remain empty.
- EV peer numerators include market capitalization + net debt + minority interest + preferred equity. Missing minority/preferred amounts are not automatically replaced with zero.
- For EV-based issuer valuations, equity equals EV − net debt + the reviewed signed bridge adjustment. Negative equity is retained. P/E produces common-equity value directly.
- Peer annual durations must be 300–380 days, fiscal-end tolerance 0–90 days, quotes no older than seven days, and financial reporting age no more than 550 days. These are disclosed product validation limits, not guarantees of economic comparability. Three distinct eligible peers sharing one quotation date are required.
- Source URLs in an automatic response must belong to the actual web-search source catalog. Catalog membership and analyst attestation do not independently verify the numeric contents.

## Local validation

`npm run check`, `npm test` (51 files, 253 tests), `npm run build` and `git diff --check origin/main` passed. Lint has the same 33 pre-existing errors as main, with no new normalized findings. The built Node server passed an actual local HTTP DCF smoke: proposal 200, unapproved calculation 409, approved calculation 200, hand-calculated result 12 USD/share. Those figures are synthetic arithmetic acceptance, not a real issuer valuation. The three focused suites passed all 16 tests after fixture whitespace normalization.

Expanding Vitest discovered two earlier issues: partial filing-delta evidence caused a dossier crash, and a missing transformed SEC sample returned the wrong diagnostic. Both are repaired without weakening the original rejection controls. Python service tests were not run locally because pytest is unavailable; no Python service source was changed. Browser interaction acceptance is unverified: the browser binary is absent and its download failed.

## Release status at handoff

The code is committed locally on `feature/valuation-evidence-rebuild`, based on main `36ee016`. Automatic approval review rejected both branch-push attempts, saying the GitHub destination and source payload need explicit user approval. Repository identity and the baseline blob were read back through the GitHub connector, and changed files passed a credential-pattern scan, but those checks did not lift the approval block. No new PR, merge or deployment was created. Production still runs the earlier PR #73 release.

## Boundaries and rollout

The issuer-history fallback supports Micron only. It fetches public disclosures without sending private filing content, checks issuer identity and publication cutoff, rejects redirects, bounds response size/time and caches only public releases. Other issuers retain existing regulatory/import paths and explicit gaps.

Existing saved valuations should be re-prepared because the new annual base, currency and equity-bridge inputs are mandatory. No database migration is required. Reload the app and rerun the filing analysis to populate new segment/history evidence; older cached analyses are not silently rewritten.

Rollback: revert this PR and deploy the prior main commit. No user data deletion or schema reversal is needed. Release completion requires CI at the exact PR head, an observed Railway `SUCCESS` and HTTP valuation/evidence checks; a successful build alone is insufficient.
