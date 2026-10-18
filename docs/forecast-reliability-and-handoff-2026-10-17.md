# Forecast reliability and GPI compatibility follow-up

## Outcome and evidence boundary

The code-level GPI handoff incompatibility reported earlier is no longer present
in current GPI main. The missing session, audience and permissions fields were
already repaired by GPI PR #159 and are included in deployed GPI `0849ef839733e0043ba98a01e3a6fe824df0373d`.
This follow-up reproduces the real cross-app session/approval flow with isolated
databases and updates the GPI CI consumer pin to released FilingLens `3e2e896085dd7263da5524210693cbadfa7a4a97`.
It does not weaken FilingLens authentication to accept obsolete tickets.

The long-horizon predictor's accuracy has **not** been improved or proven by this
change. Instead, a confirmed reliability defect is repaired: years 3–5 bands
that failed the precision gate can no longer be served/displayed/exported as
usable empirical bands. A fixed forward ledger and timestamp-verified scoring
path provide a way to accumulate real prospective evidence. These are concrete
controls, not a claim that uncertainty disappeared.

Confidence: 4/5 for the implemented controls and reproduced integration. Real
production positive-path sign-in and future realized forecast accuracy are
separate evidence gaps. New changes in this follow-up are local pending release
authorization; the existing GPI repair is already deployed.

## Observed findings and changes

| ID / priority | Observation and risk | Implemented response | Residual limit |
| --- | --- | --- | --- |
| FR01 / P1 | V3 historical years 3–5 band coverage is 71.54%, 67.98%, 66.88%; year-five median width is 206.33% of base. API and exports still returned these bands despite the warning. | Shared `forecast-reliability.v1` gate withholds their intervals in the API, UI and exports, including defensive handling of older model responses. Row-level status explains the failed gate and next action. | Point forecasts remain conditional scenarios. This is risk control, not lower measured prediction error. |
| FR02 / P1 | Reusing known FY2023–2025 outcomes to retune parameters and calling them untouched would manufacture evidence. No prospective registration existed. | Preserve frozen predictor, evaluator and V2/V3 reports byte-for-byte. Freeze 91 eligible issuers plus 29 explicit exclusions from the fixed 120-issuer universe; retain all five future targets. Never overwrite registration with the CLI. | All 455 outcomes are pending. No new model or significance claim. |
| FR03 / P1 | A locally declared timestamp/hash does not establish that a forecast existed before its outcome. | Independent receipt verifier reads bounded public GitHub API responses: successful CI, correct repository/workflow, exact committed registry bytes and chronology. Runtime-verified receipts are immutable; cloned/forged receipts are refused. | GitHub is the timestamp trust source, not a cryptographic third-party notarization or proof that issuer data is truthful. No real receipt exists for this unpublished local ledger yet. |
| FR04 / P1 | Missing outcomes, restatements and exclusions can bias reported accuracy. | Pending stays pending, never zero; first retained target disclosure is frozen for scoring; currency/definition changes or outcomes preceding the anchor remain ineligible, with reason. Fixed denominator includes initial exclusions. | Missing original vintages can still bias a supplied outcome feed. No live future-outcome collector is configured by this patch. |
| IAM01 / P1, previously repaired | Old GPI checkout lacked the delegation fields required by FilingLens. Current GPI has them and production runs its repaired SHA. | Strengthened actual-code test: session/audience/permissions, logout, new login, old-ticket replay and immediate membership downgrade; current released consumer is pinned in GPI CI. | Synthetic DB/provider transport is not a real user's production browser session. Production sign-in requires the user's secure login. |

The criteria remain the predeclared project gates, not industry certification:
point comparison and empirical interval usefulness are separate. Years 1–2 only
have historical cohort support, never an issuer-specific future probability.
No interval is widened, sample dropped, or threshold relaxed to turn failure into
success. Revenue evidence does not establish FCFF, WACC, terminal value or returns.

## Forward ledger and chronology

`public/evaluations/forecast-watch-v1.json` is frozen at
`2026-10-17T22:52:24.900Z`, digest
`effac31a5c2b0e39378c314c70777833a6246021b25b993730488bb298e68be7`.
It records the existing bounded median-damped model, source/predictor hashes,
source cutoff `2026-07-01`, all training IDs, base values and five point paths.
The issue date is **October**, not July. FY2026 is a partly elapsed target year;
these are not five complete annual lead times from the actual issue date.
Interim information after the July cutoff is intentionally not used, so this
is not claimed to be the best currently informed corporate forecast.

| Planning row | Target | Current outcome status |
| --- | --- | --- |
| 1 | FY2026 | Pending annual target disclosure |
| 2 | FY2027 | Pending annual target disclosure |
| 3 | FY2028 | Pending annual target disclosure |
| 4 | FY2029 | Pending annual target disclosure |
| 5 | FY2030 | Pending annual target disclosure |

Each row has 120 fixed issuer attempts, 29 initial history exclusions and 91
pending eligible predictions. No errors, band coverage or future accuracy are
reported from nonexistent outcomes. A hash check alone never upgrades an
unanchored local score to prospective. Even future observed scores do not
automatically qualify the model: a separately predeclared validation decision
and adequate data remain necessary.

## Interaction contract

- The existing five-year form stays editable. Failed bands are replaced with
  “Withheld · precision gate failed,” not silently removed without explanation.
- Draft edits still clear review and all calibration applicability. Explicit
  reviewed DCF transfer, currency/base/issuer ties, stale-result invalidation
  and terminal-transition warnings remain unchanged.
- Expandable forward tracking shows issue/source dates, fixed denominator,
  exclusions, pending outcomes, timestamp status and downloadable evidence.
  It explicitly labels the page as a dated snapshot, not a live automatic feed.
- Source/date changes still suppress late responses. Missing history remains
  unavailable; bad requests remain bounded and recoverable.
- No new login form, account, inference call, portfolio publication, production
  write endpoint, secret, dependency, database migration or SEC request is added.

The UX skill influenced the separation between historical evidence, failed
precision, analyst scenarios and pending future verification. The security
skill requires current server authority rather than accepting legacy tickets or
using a public test-login endpoint.

## Reproduce and maintain

```sh
npm ci
npm run forecast:policy
npm run forecast:watch -- verify
python ops/verify-forecast-watch.py
python ops/verify-five-year.py
python ops/verify-forecast-cohort.py
npm run check
npm test
npm run build
# With @playwright/test installed, set PLAYWRIGHT_TEST_MODULE if needed:
node ops/verify-five-year-workflow.cjs
node ops/verify-valuation-workflow.cjs
node ops/verify-forecast-workflow.cjs
node ops/verify-model-validation.cjs
```

`register` uses exclusive file creation and refuses to replace the existing
ledger. Do not delete the ledger to obtain a new date or better outcome. `verify`
reproduces the checked-in dated score/summary without changing it to today's
date. CI also checks that the compact browser policy reproduces the frozen V3
report, avoiding loading the entire evaluation report into every DCF page.

To score real later outcomes, prepare a retained-vintage JSON file with an
`observations` array using the existing CVM source/receipt contract. Preserve the
original source archives and hashes. After this ledger is publicly committed,
use a successful CI run containing its exact bytes as the independent receipt:

```sh
FORECAST_WATCH_OUTCOMES=/absolute/path/to/permitted-vintages.json \
FORECAST_WATCH_ANCHOR_RUN_ID=<completed-successful-run-id> \
  npm run forecast:watch -- score
```

This explicit command updates dated local score/summary files, not the frozen
forecasts and not production. Review actuals, source versions, exclusions and
the receipt before publishing updated evidence. Future verification with that
outcome feed must use the same retained file. If anchored, receipt verification
requires public GitHub connectivity; unavailable evidence fails closed.

GPI reproduction, from its checkout:

```sh
FILINGLENS_TEST_ROOT=/absolute/path/to/filinglens npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e:production
```

The final command runs the built app on local loopback with synthetic browser
fixtures; its name does **not** mean that it signs into Railway production.

## Verification and release state

Local suites: 435 FilingLens tests; 190 GPI tests with `FILINGLENS_TEST_ROOT`
enabled, including real password/session, signed introspection, approval/import,
stored synthetic risk and revocation. Both typechecks and production builds pass.
GPI lint has zero errors and one pre-existing unescaped-entity warning; targeted
changed FilingLens TypeScript passes ESLint. Both production dependency audits
report zero vulnerabilities. Independent Python checks reproduce the 455 new
frozen paths plus the original V2/V3 evidence. All 11 local browser runs pass:
eight FilingLens runs covering the five-year, valuation, earlier forecast and
specialist-model workflows at mobile/desktop widths, plus three GPI built-app
tests. The five-year checks verify withheld bands and the downloadable fixed
ledger; these browser fixtures do not establish production sign-in.

Observed production identity: GPI deployment
`0a39fd19-8d55-4412-92f9-ecdd1b7b3382`, `SUCCESS`, source `0849ef8`.
The current production browser reaches the ordinary sign-in screen; no positive
signed-in production test is claimed, no credentials were guessed/extracted and
no test account was created. The next boundary is secure user-provided sign-in.

Publishing this new work and deploying it require new authorization for the
completed commit(s). The previous authorization covered the earlier release,
not these new changes. Rollback is code-only: revert the new policy/UI commit;
retain the frozen registration as audit evidence. No stored portfolio, approved
valuation or database schema is changed. Rollback must not relabel failed bands
as accurate or turn pending outcomes into successes.

## Primary references

- [Forecasting: Principles and Practice, chapter 5](https://otexts.com/fpp3/toolbox.html): time-ordered validation, multi-step errors and distributional evaluation. This supports the evaluation design, not a promise that this project model is accurate.
- [GitHub workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run) and [repository contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content): independent run metadata plus exact committed snapshot bytes. Receipt mocks establish regression behavior; a real receipt remains pending publication.
