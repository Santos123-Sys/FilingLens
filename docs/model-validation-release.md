# Forecast evidence and specialist valuation methods

Historical release note. The subsequent [broader forecast evaluation](forecast-quality-release.md)
supersedes its forecast-proposal policy; the two-issuer results remain development references.

16 October 2026. This release adds measured historical forecast validation and two bounded specialist calculators. It does not establish a generally more accurate forecasting model, a current fair value, or successful production sign-in.

## Forecast result and remedy

The existing mechanical proposal extrapolates the latest annual revenue growth and tapers it by 15% of that rate per forecast year. Its numerical rule is now shared with the evaluator. The rule is still a scenario proposal: its assumption confidence is **low**, with explicit baseline-comparison guidance.

`/valuation/validation` compares the current rule, naive revenue, linear drift and trailing three-year CAGR. The evaluator uses original-release current-year consolidated annual revenue, expanding training windows starting at three years, and origins on the day after the last training disclosure. Each horizon is evaluated separately. No held-out target enters training or model selection. Error sign is forecast minus actual; positive bias means overforecasting.

Sixteen observations cover Apple and Microsoft FY2018–FY2025. Publication dates come from original issuer releases; source bytes were retrieved on 16 October 2026 and fingerprinted. Each fact retains issuer, fiscal end, publication day, definition, currency, unit, source URL, exact row excerpt and fingerprint. Current copies of historical releases are not independently timestamped historical archive captures. The dataset excludes pre-2018 Microsoft to avoid mixing the earlier revenue-recognition basis.

| Issuer / method | One-year folds | MAE (USD millions) | MAPE |
|---|---:|---:|---:|
| Apple current rule | 5 | 49,361.24 | 12.84% |
| Apple naive | 5 | 32,746.40 | 8.62% |
| Apple drift | 5 | 30,994.38 | 8.26% |
| Apple trailing CAGR | 5 | 44,556.93 | 11.72% |
| Microsoft current rule | 5 | 9,733.56 | 4.45% |
| Microsoft naive | 5 | 27,741.80 | 12.62% |
| Microsoft drift | 5 | 11,011.00 | 4.99% |
| Microsoft trailing CAGR | 5 | 7,246.90 | 3.45% |

The Apple rule performs worse than naive; Microsoft performs better. Switching everyone to drift or CAGR based on this sample would introduce selection bias. No automatic replacement is made. Two selected technology issuers and five one-year origins per issuer do not establish general forecast skill, five-year accuracy, statistical significance, valuation accuracy or investment returns. Longer horizons have fewer overlapping folds (4, 3, 2 and 1). There are 15 origin/horizon combinations per issuer, four model results each: 120 scored predictions in total. These are retrospective replays, not forecasts registered before the historical outcomes. User-edited assumptions are not validated by them.

Reproduce: `node --import tsx ops/evaluate-forecast-reference.ts`. Full folds, source records and scores are in `docs/evaluations/forecast-reference-2026-10-16.json` and the UI export. Pure calculation logic and API schema support additional reviewed annual cohorts without provider calls. Positive revenue only; missing years, duplicate/revised vintages, mixed issuer/currency/definition, invalid dates and overlapping availability are rejected. A constant training series has undefined MASE and remains explicitly null.

## Specialist support matrix

| Workflow | Implemented behavior | Explicit boundary |
|---|---|---|
| Banks and insurers: common-equity residual income | Five annual common net-income/distribution projections; charge on **beginning** common equity; clean-surplus roll-forward; common-equity capital floors; sustainable terminal ROE/retention; cost-of-equity discounting; independent dividend-discount identity | Requires reviewed normalized earnings, clean surplus, no unmodeled OCI or net common issuance/buybacks. Floors are analyst reconciliations, not automated CET1/Basel or insurance-solvency calculations. No actuarial/reserve or asset/liability forecasting engine |
| Equity REIT: property NAV | Forward annual property NOI / cap rate × economic ownership; cash/other assets less debt, liabilities, preferred/minority claims and corporate costs; diluted common-share denominator | Mortgage REITs, development and negative NOI require other models. Consistent look-through debt and minority claims must be reviewed. No automatic appraisal, AFFO definition or cap-rate discovery |
| Industrial operating-company FCFF | Existing validated v2 engine and evidence flow retained | Financial/REIT gate retained. Energy reserves/cycles, regulated utilities and early-stage financing are not newly implemented |

Specialist inputs start blank. Synthetic examples are explicitly labelled. Any edit clears the result and review attestation; stale in-flight responses are ignored. Result amounts open the existing keyboard-accessible evidence panel, including formulas, dependencies and optional analyst source links. Sources remain **user supplied** rather than verified. Exports contain reviewed inputs, full schedules, sources, calculation versions and model limits. No server persistence is added. Sector results are review/export-only: existing GPI portfolio publication and its DCF/comps approval contract are not expanded.

## Security, validation and operation

`POST /api/valuation/sector` and `POST /api/forecast/evaluate` are public stateless deterministic calculators, consistent with the existing deterministic DCF endpoint. They do not execute models, fetch input URLs, access private stores, publish valuations or alter holdings. Requests are bounded to 100,000 bytes and schema-limited to five financial projection years, 30 properties or 50 revenue observations. Responses are no-store. Paid and private routes retain session-bound GPI authorization.

New tests cover hand-calculated book-value/zero-excess-return cases, negative residual income, dividend tie-out, all claims/ownership, invalid sources/dates/ranges, review/capital gates, publication leakage, mixed bases, missing/duplicate vintages, forecast errors and bounded HTTP behavior. Browser acceptance covers mobile/desktop benchmark switching, source-preserving exports, bank/insurer/REIT calculation, formula/keyboard navigation, input invalidation, stale-response exclusion and invalid-input recovery. The existing Apple FCFF flow and isolated GPI authorization/approval/audit flow remain regression gates.

Deploy through the existing main-branch pipeline after CI; no new dependency, migration, credential, service or permission is required. Revert the release commit to roll back. Source observations and immutable existing approvals are not overwritten. Never weaken authentication to complete a test.

## Primary methodological sources

- [CFA Institute, 2026 Residual Income Valuation, Summary](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/residual-income-valuation): beginning common-equity charge and residual-income valuation identity. Only public content was used.
- [Damodaran, Valuing Financial Service Firms](https://pages.stern.nyu.edu/~adamodar/pdfiles/eqnotes/finsvc.pdf): equity approaches and financial-firm reinvestment/capital constraints. Examples are not current market inputs.
- [Nareit glossary, Capitalization Rate and NOI](https://www.reit.com/glossary): property-income/capitalization convention. Does not validate selected cap rates or independent appraisals.
- [Hyndman and Athanasopoulos, Forecasting: Principles and Practice, sections 5.8–5.10](https://otexts.com/fpp3/toolbox.html): out-of-sample errors and rolling forecast origins. Publication-vintage discipline is an additional financial-data control.
- Original Apple PDFs and Microsoft earnings releases are linked individually in the dataset and UI; they provide financial facts, not forecast labels.

## Production usability status

A new secure production sign-in attempt on 16 October returned **Invalid email or password**. This establishes the displayed denial path, not successful authentication and not an account/password defect. No credentials were visible to the agent, reset, substituted or read from deployment configuration. Successful signed-in GPI → FilingLens → approval/audit usability remains blocked pending a valid user-controlled session. Local synthetic cross-application tests are separate evidence.
