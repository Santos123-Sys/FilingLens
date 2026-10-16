# Broader forecast evidence and evidence-gated proposals

16 October 2026. The one-year selector passes the thresholds frozen for a
specific historical CVM cohort. This replaces the two-company evidence gap with
a reproducible multi-sector experiment, while withholding unsupported automatic
DCF growth. It does not prove universal or future forecast accuracy.

## Measured result

The cohort contains the first 60 codes under a deterministic hash ordering of
301 eligible 2018 reporters. Selection uses positive consolidated calendar-year
revenue and an exact-version receipt by 30 June 2019. No current-listing or
future-completeness filter is applied. There are 826 retained annual observations
from official FY2010–2025 archives, 3,300 attempted origin/horizon cases and 2,369
scored cases. All exclusions remain in the exported trace. Current sector labels
are descriptive, not model inputs. The cohort is reconstructed from rows retained
today: loss of original versions and amendment attrition can bias eligibility.

The protocol was frozen in local commit `e787863`, and candidate implementation
in `ecbf085`, before the expanded test was scored. Exact protocol, engine and
dataset SHA-256 hashes are in the reports. A small post-score reporting correction
represents empty groups as null, adds a one-year-only scope field, and discloses
archive-selection limitations; no model, split, cohort, threshold or scored
prediction was tuned after observing test results. Formatting does not change
forecast formulas. Apple/Microsoft are development references only.

Locked one-year targets FY2023–2025 yield **136 paired cases across 50 issuers**,
with **44 of 180 attempts excluded**. Six sectors have at least three test issuers.
The mean scaled absolute error is first averaged within each issuer, then equally
across issuers. The scale is last available annual revenue; these are **not MAPE**.

| One-year predictor | Macro scaled absolute error |
|---|---:|
| Legacy latest-growth taper | 38.19% |
| Historical selector v2 | 26.84% |
| Naive last revenue | 28.01% |
| Drift (comparison) | 21.37% |
| Median ensemble (comparison) | 19.54% |

Selector error is **29.73% lower than legacy**, and 4.21% lower than naive.
It wins/ties/loses against legacy in 78/3/55 cases. All five declared project
gates pass. These thresholds are project acceptance criteria, not a statistical
standard. The selector is not the best model observed after the fact; switching
to the best held-out comparator would require a new protocol and untouched test.

| Horizon | Scored / attempted locked cases | Selector macro scaled error | Empirical band cases | Coverage |
|---|---:|---:|---:|---:|
| 1 year | 136 / 180 | 26.84% | 113 | 91.15% |
| 2 years | 136 / 180 | 66.79% | 104 | 85.58% |
| 3 years | 137 / 180 | 1,501.57% | 93 | 72.04% |
| 4 years | 131 / 180 | 204,338.87% | 51 | 58.82% |
| 5 years | 128 / 180 | 1,514.29% | 0 | Unavailable |

Longer horizons are **comparison only**, with extreme failures retained, not
clipped. Small bases, restructuring and changing business scale make normalized
errors unstable. Empirical bands use a finite-sample upper quantile of earlier
available normalized errors, with at least five errors. One-year average band
width is **2,521.21% of base revenue**: high coverage does not establish useful
precision. No guaranteed probability or significance claim is made. Multi-year
cases overlap and are dependent. Revenue evidence does not validate margins,
earnings, cash flow, WACC, terminal value, fair value or stock returns.

## Implemented controls and product behavior

- Each retained statement row is joined only to its exact filing version and
  receipt. Later amendments cannot borrow an earlier original filing date.
- Each July 1 origin uses only finished annual periods filed strictly before it.
  Missing/nonpositive training years, definition/currency changes and missing
  vintages stop the usable consecutive suffix. Target nonpositive actuals are
  retained in scaled scoring; their MAPE is undefined.
- Per-horizon selection uses at least three already-filed prior errors. A
  non-naive model needs at least 10% lower paired historical error than naive.
  Otherwise the explicit naive fallback applies. Future labels cannot influence
  selection or calibration.
- `/valuation/validation` shows splits, horizons, sector coverage, sparse groups,
  per-issuer results, worst cases, band availability/coverage/width and complete
  source/forecast/exclusion downloads. A reconstructed July 2026 scenario uses
  only pre-origin vintages; it is labelled as created retrospectively.
- `POST /api/forecast/quality` is a stateless, schema/byte-bounded deterministic
  comparison. It fetches no supplied source URLs, reads no private stores and
  calls no paid provider. It does not label arbitrary inputs validated.
- New DCF revenue-growth proposals are blank when the analysis lacks the exact
  publication-vintage series required for calibration. An aggregate five-year
  history or two filing values cannot substitute for that evidence. Rationale,
  missing source cutoff, interval status and limits remain in the assumption
  ledger and audit export. Analyst acceptance/edits are conditional scenarios.
- Old saved **unreviewed** growth proposals are cleared on load/restore; explicitly
  reviewed inputs and existing approved arithmetic references are retained.
- The CVM production parser now matches the current-period label exactly.
  The old substring filter also matched `PENÚLTIMO`, allowing prior comparative
  revenue to enter a current-year calculation when row order changed.

No new dependency, migration, secret, permission, remote persistence or portfolio
publication contract is introduced. SEC acquisition remains paused. Reverting
the release restores the previous proposal behavior; existing approvals are not
rewritten. Signed-in production access was not retested in this forecast task.

## Reproduce and verify

```sh
python ops/acquire-forecast-cohort.py --cache ../forecast-cohort-raw
npm run forecast:evaluate
python ops/verify-forecast-cohort.py
python -m unittest discover -s tests -p 'test_forecast_cohort_acquisition.py' -v
npm run check
npm test
npm run build
```

Acquisition uses bounded requests to the official CVM archive and stores raw
ZIPs outside git. Weekly revisions can change future downloads; the committed
normalized rows, exact receipts, archive/row hashes and source fields reproduce
this experiment offline. The derivative database retains CVM attribution and
[ODbL 1.0](../data/LICENSE-CVM.md), separate from application-code licensing.

CI regenerates the frozen report, rejects differences and runs the independent
Python oracle: **14,214 forecast values**, selectors, bands, **826 source
conversions/receipts**, file/row hashes, cutoffs and macro scores agree.
Unit tests cover future targets/revisions, same-day cutoff, insufficient
selection/calibration history, ambiguous vintages, missing/nonpositive training,
changed currency/definition, invalid sources/calendars, invalid candidates,
request limits, persisted unreviewed proposals and documented manual DCF inputs.
Browser checks cover 390px/1440px matrices, horizon failure visibility, sparse
sectors, evidence exports, issuer switching, delayed-response invalidation and
error recovery. The existing Apple reference and sector calculators remain
regression checks.

Local verification completed: FilingLens typecheck/build, **414 application
tests**, **189 GPI tests** including the isolated real two-application approval
flow, **19 data-tools tests**, **2 acquisition tests**, changed-file lint, the
independent oracle and **six production-build browser runs** (three workflows at
390px/1440px). GPI typecheck also passes. These local results do not substitute
for release-commit GitHub CI or live-deployment verification.

Primary sources: [CVM DFP](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp),
[CVM register](https://dados.cvm.gov.br/dataset/cia_aberta-cad),
[rolling-origin evaluation](https://otexts.com/fpp3/tscv.html),
[forecast combinations](https://otexts.com/fpp3/practical.html).
