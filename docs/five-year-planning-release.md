# Five-year planning: implementation and evidence

16 October 2026. Implementation branch: `feat/five-year-planning`.
Base release: `48aac723b76dd4b92c1348b831d21d21bb713106`.
This document records local verification, not a production deployment.

## Decision and scope

Implement **five explicit annual revenue planning years**, with one compounded
path, editable annual drivers, source inspection and reviewed transfer to the
existing five-year FCFF/ROIC DCF. Five years is a common business-plan/DCF
convention, not a universal financial-market standard or an accuracy guarantee.
Some firms need a longer explicit growth/transition period before terminal
assumptions are defensible. This change does not claim that year five is stable.

Primary guidance:

- [CFA Institute practitioner discussion, 9 March 2026](https://rpc.cfainstitute.org/blogs/enterprising-investor/2026/rethinking-exit-multiples-in-high-growth-company-valuations): common five-year plans can stop before stable growth.
- [CFA Institute financial-statement modeling](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/introduction-to-financial-statement-modeling): revenue-driven models and context-dependent forecast horizons.
- [Damodaran on growth duration](https://pages.stern.nyu.edu/adamodar/New_Home_Page/valquestions/highgrowthperiod.htm): business size, growth and competitive advantages affect the explicit period.
- [Forecasting: Principles and Practice, damped trends](https://otexts.com/fpp3/exponential-smoothing.html): background only; the bounded median-log predictor below is a project design, not an implementation of Holt's fitted state-space model.

## Frozen method and new issuer test

The [protocol](five-year-forecast-protocol-v3.md) was committed as `1d83c38`
before acquiring/scoring new issuers. Predictor/acquirer were frozen as
`b3f3f60`; scoring and finite reporting controls as `087ccc2` before first
successful scoring. No predictive parameter or qualification gate was retuned
after scoring. Subsequent engine changes were formatting only. Acquisition
stopped on a duplicate; one identical row was then collapsed with an explicit
duplicate count. Conflicting duplicates still fail closed.

The model requires at least five consecutive positive calendar-year revenues,
unchanged definition/currency, published strictly before a July 1 origin.
It takes the median log change from up to six values, bounds initial growth to
−20%/+25%, damps log growth by 0.8^(h−1), rounds annual growth drivers to six
decimals, and compounds those exact drivers. Bounds constrain forecasts, never
actuals. These controls are fixed project choices, not economic laws.

The original 60 CVM issuers are development/calibration only. The next 120 codes
in the pre-existing 2018-universe hash order are the fresh issuer test, without
later-listing, sector, completeness or outcome filters. There is no issuer
overlap. The retained source contains 1,675 unique annual observations from
FY2010–2025, with exact-version filing receipts, source rows and hashes.
One byte-identical duplicate (`CVM-20125-2023-v1`, value 2,118.667 BRL millions)
was collapsed and counted; no conflicting value was selected or averaged.

There are 1,800 fixed attempts (120 issuers × 3 FY2023–2025 targets × 5 horizons),
1,284 scored cases and 516 explicit exclusions. Targets are later realized
revenues; each training origin and calibration label obeys its own filing-date
cutoff. Errors are macro averages with each issuer equally weighted, scaled by
its last known revenue, **not MAPE**. Calibration uses only already-filed
outcomes of development issuers, never held-out issuer errors.

| Horizon | Scored / attempts | Paired issuers | V3 error % | Naive error % | Legacy error % | V2 error % | Point gates | Band coverage % | Median width / base % | Band usefulness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 266 / 360 | 98 | 19.31 | 19.46 | 28.78 | 20.57 | Pass | 86.84 (266) | 66.95 | Pass |
| 2 | 264 / 360 | 98 | 36.33 | 36.34 | 75.91 | 38.59 | Pass | 76.89 (264) | 106.15 | Pass |
| 3 | 260 / 360 | 98 | 56.16 | 56.96 | 274,232.57 | 59.64 | Pass | 71.54 (260) | 132.46 | Not established |
| 4 | 253 / 360 | 96 | 83.13 | 86.36 | 14,963,764.60 | 86.03 | Pass | 67.98 (253) | 158.81 | Not established |
| 5 | 241 / 360 | 90 | 113.88 | 118.32 | 1,723.10 | 122.33 | Pass | 66.88 (160) | 206.33 | Not established |

Point gates require ≥30 paired issuers, ≥100 paired cases, ≥60% scored coverage,
six sectors with three issuers, ≥5% lower macro error than legacy and ≤5% worse
than naive. Band usefulness independently requires ≥50 scored bands, ≥75%
observed coverage and median width ≤200% of base. These are predeclared project
criteria, not significance tests or finance-industry certification.

**Interpretation:** the bounded model avoids legacy extrapolation explosions and
passes five historical point-comparison gates. Improvements over naive are small,
especially year two, and no statistical significance is established. Year-five
error is still 113.88% of base revenue; nominal 80% bands under-cover years 3–5.
Five-year precision and future accuracy are not established. Shared macro
regimes, overlapping targets, current registry sector labels and retained-vintage
amendment/attrition limit this retrospective issuer-held-out test. It is not a
prospectively registered or global/SEC test. Revenue evidence does not establish
margins, cash flow, WACC, terminal value, fair value or investment returns.

## Delivered behavior and acceptance specification

| State / action | User-visible behavior and control | Verification |
| --- | --- | --- |
| Evidence overview | Five per-horizon rows, sample sizes, errors, point gates and separate band usefulness; expanding details exposes exclusions, sparse sectors and worst cases | Browser at 390/1440 px; full trace download |
| Idle / source selection | Issuer and origin explicit; historical reconstruction is labeled as created today, not a forecast registered at that date | Source selector/date tests |
| Loading / source change | Build button disabled during request; changing issuer/date invalidates old result; late responses cannot replace a newer selection | Delayed-response browser test |
| Missing history | No forecast if five consecutive positive annual observations are unavailable; no zero-fill or silent shortened horizon | Unit/API/browser tests |
| Error / recovery | Invalid July origin or unavailable API has a visible error; inputs retained and retry possible | API 422/400/413 and browser retry tests |
| Model reference | Five exact compounded growth/revenue rows, source cutoff, underlying filing disclosures, optional empirical model bands | Numerical oracle, source export and browser tests |
| Analyst editing | All five drivers editable; blank is invalid, not zero; edits clear review and remove model-band applicability | Unit/browser tests |
| DCF suggestion | Optional bounded suggestion only if five annual revenues, currency, periods and current ledger base align; absent vintage evidence means no empirical bands | Annual/quarter/mismatch tests |
| Reviewed transfer | Requires checkbox plus documented rationale; verifies issuer/base/year/currency and all five ledger row IDs; changes only growth rows, records low confidence and limitations | Unit and keyboard browser tests |
| Applied / recalculated | Applying invalidates old DCF and reconciliation; other assumptions retained; recalculation uses the exact five drivers; later draft edits do not silently alter the ledger | Real DCF compounding, audit export and browser tests |
| Terminal transition | Warns if year-five growth differs from reviewed terminal growth by more than 3 percentage points; never changes terminal ROIC/growth/WACC automatically | Browser test |
| Audit / recovery | Export includes review status, drivers, formulas, source references and uncertainty limits; existing saved-session restore and legacy evidence flows remain available | Existing browser regressions |

The design-agentic-ux skill informed the separation of evidence, editable drafts,
explicit reviewed actions, stale-response handling and recovery. The React
checklist informed state isolation, type-only server imports and avoiding
unnecessary memoization. Inputs have visible/accessibility labels; keyboard
activation and mobile horizontal table containment are acceptance checks.

## API, integration and operational boundaries

`POST /api/forecast/plan` is stateless and deterministic: strict schema,
100 KB body limit, 100-observation limit, July 1 calendar origin and `no-store`.
It reads no user-provided URL, calls no paid provider and mutates no storage.
Only exact normalized canonical CVM series receive development-cohort bands;
altered/arbitrary input can produce a conditional path but not calibrated bands.

The new UI is at `/valuation/validation` and in the DCF assumption workspace.
Unreviewed growth assumptions are not auto-populated. Existing reviewed ledgers,
`fcff-roic.v2` arithmetic, Apple reference value and public publication contracts
remain compatible. Applying a scenario is not portfolio publication. No new
dependency, secret, auth bypass, database migration or provider configuration was
introduced. SEC acquisition remains paused. Signed-in production usability is
outside this change and has not been newly verified.

An extra local cross-repository GPI approval-flow test fails at handoff context
with HTTP 401 against both this branch and the exact preceding release
`48aac723`, but passes against the older `991ebd1` worktree. The checked-out GPI
fixture does not supply the session/audience/permissions required by the newer
FilingLens authorization contract. This is a baseline fixture/contract mismatch,
not evidence of a regression from five-year planning, and no authorization gate
was weakened to make it pass. Cross-project signed-in production verification
remains an explicit gap; it is not included in the passed test count.

Mobile testing also found an existing unbroken source fingerprint on the Apple
reference page extending beyond 390 px. The source paragraph now wraps; the
fingerprint and source content are unchanged.

The original V2 datasets/reports remain unchanged. New source and reports are
CVM derivatives under [ODbL attribution](../data/LICENSE-CVM.md). Complete cases,
exclusions, per-issuer/sector metrics, source IDs and calibration-pool references
are retained in `public/evaluations/five-year-evaluation-v3.json`.

## Reproduction and verification

```sh
npm ci
npm run check
npm test
npm run build
python -m unittest discover -s tests -p 'test_*acquisition.py' -v
npm run forecast:evaluate:five-year
python ops/verify-five-year.py
python ops/verify-forecast-cohort.py
git diff --exit-code -- src/data/five-year-qualification-summary.json public/evaluations/five-year-evaluation-v3.json
# With @playwright/test and Chromium installed (or PLAYWRIGHT_TEST_MODULE set):
node ops/verify-five-year-workflow.cjs
node ops/verify-forecast-workflow.cjs
node ops/verify-valuation-workflow.cjs
node ops/verify-model-validation.cjs
```

Verified locally:

- 428 TypeScript tests in 89 files, including 14 new tests; TypeScript check and production build pass.
- Four Python acquisition tests pass, including identical/conflicting duplicate handling.
- Independent V3 oracle verifies 1,675 observations, 1,800 attempts and all 1,284 scored paths, source cutoffs, bands and gates.
- Existing V2 oracle verifies 826 source observations and 14,214 forecast values; frozen V2 reports are unchanged.
- Eight browser runs pass: new five-year workflow, V2 forecast evidence, Apple DCF/audit/version recovery and specialist-model validation, each at 390 and 1440 px. Screenshots were visually inspected.
- New TypeScript modules/components and reference pages pass targeted ESLint; `git diff --check` passes. Repository-wide legacy lint remains a pre-existing non-blocking CI step, not claimed clean.
- Production dependency audit reports zero vulnerabilities. Minified executable comparison confirms predictor/scorer semantics are unchanged since pre-score commit `087ccc2`.
- The extra cross-repository GPI test fails identically on this branch and exact release baseline as described above; it is excluded from passed counts.

Protocol, engine, source and development hashes are embedded in the generated
reports. CI reproduces both frozen V2 and V3 reports
offline and rejects byte drift. The independent Python V3 oracle verifies every
new source row, attempted exclusion, scored V3/naive/legacy prediction,
pre-origin development pool, empirical band and gate. It recomputes V2 comparator
aggregates, not its adaptive selection on the fresh cohort; V2's own independent
oracle separately verifies its original frozen cohort.

Production release is pending explicit authorization for the completed new
commit, followed by public PR/CI/merge and Railway verification. No live success
is claimed here. Rollback target is the previous release `48aac723`; no data
migration or irreversible operation needs reversal.
