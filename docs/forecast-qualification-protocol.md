# Forecast qualification protocol v2 — frozen before expanded outcomes are evaluated

Protocol written 16 October 2026, before acquiring/evaluating the expanded CVM outcome years. Apple/Microsoft historical results are already known and are development-only evidence; they are excluded from the new locked test.

## Scope and cohort

- Target: annual consolidated reported revenue; no stock-return or valuation-accuracy claim.
- Additional scope if audited extraction permits it: annual operating margin, separately scored, never inferred as validated by revenue error.
- Source: official CVM annual DFP statement CSVs and their exact-version filing receipts. Original issuer/statement/account, period, scale, version, document ID, filing date, archive SHA-256 and source row remain attached. Retained revised versions are usable only after their actual filing date. Missing historical versions are exclusions, not reconstructed facts.
- Fixed cohort: eligible positive-revenue, twelve-month December-year-end consolidated reporters present in the 2018 archive whose retained 2018 version was filed by 2019-06-30. Sort eligible CVM codes by SHA-256 of `filinglens-forecast-v2:<code>` and select the first 60. No current-listing, future-completeness, sector-performance or outcome filter. Issuer exits, missing years and missing vintages remain visible as exclusions.
- Current CVM sector labels are descriptive only and do not enter forecasts or cohort selection. This is a historical Brazilian reporting cohort, not a representative global stock universe.
- Acquire FY2010–FY2025 where available. Forecast origins are July 1; target year one ends December 31 of that year. Retained values filed on/after the origin and fiscal periods not finished before the origin are excluded. Require a consecutive usable suffix ending at the prior fiscal year.

## Forecast design fixed before the test

- Compare legacy latest-growth taper, naive revenue, drift and trailing-three-year CAGR. Additional candidate: the median of naive/drift/CAGR; invalid or nonpositive component forecasts abstain.
- New candidate: per-horizon model selection using only earlier forecast-origin outcomes available before the current origin. Use mean absolute error scaled by the last training revenue. Require at least three past errors per candidate, and at least 10% lower mean scaled error than naive before selecting a non-naive candidate; otherwise use naive and label the fallback. Never use a target outcome for its own selection.
- Forecast bounds: unsupported nonfinite/nonpositive values abstain, with a reason. Do not winsorize realized outcomes or remove high-error companies after scoring.
- Empirical 80% error bands use only pre-origin calibration errors and the finite-sample upper quantile; at least five errors are required. Otherwise interval status is unavailable. Coverage is measured out of sample, not assumed. Financial time series need not be exchangeable, so these are empirical bands, not guaranteed 80% probabilities.
- Revenue does not validate margins, earnings, cash flow, WACC, terminal value or user-edited drivers. Missing evidence must not be labelled calibrated or verified.

## Temporal separation and scoring

- Development/diagnostic outcomes: through FY2021; validation: FY2022. Do not tune after opening FY2023–FY2025 results.
- Locked test: FY2023–FY2025 targets, reported separately at horizons 1–5. Training and model selection may expand with outcomes already filed before each origin, including earlier locked-test years; this is a prequential deployment simulation, not fitting to future labels.
- Record every attempted company/origin/horizon and excluded case, retained-vintage coverage, interval availability and failures. Publish per-company, sector and horizon sample sizes and paired results. Treat a sector with few issuers as insufficient rather than a pass.
- Metrics: paired mean scaled absolute error (scale = last known annual revenue), per-issuer median/mean error, win/tie/loss counts and macro-average by issuer; MAE only within common currency/metric. Report MAPE only for positive actuals and identify its denominator sensitivity. Interval coverage and relative width are separate metrics.
- Deployment qualification for replacing the automatic revenue-growth proposal: at least 30 test issuers, 100 paired one-year cases, six disclosed sectors with at least three test issuers each; macro mean scaled absolute error at least 5% lower than legacy and no more than 5% worse than naive. Sector results and worst cases remain visible. These are declared project thresholds, not a universal statistical standard.
- If qualification fails, retain the candidate as a comparison and block any claim of general superiority. Forward calculations remain conditional scenarios. No retrospective experiment can establish guaranteed future accuracy.

## Integrity and operation

Changes to cohort, predictor, thresholds, splits or exclusions require a new protocol version and a fresh untouched test set. Unit/abuse tests must prove no future publication, revision or target leakage; exclude missing/null data without zero-fill; propagate user edits as unvalidated. The product must expose model, origin, source cutoff, evidence gaps, qualification and interval status next to proposals and preserve them in exports.

Sources: [CVM DFP dataset](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp), [rolling-origin evaluation](https://otexts.com/fpp3/toolbox.html), [forecast combinations](https://otexts.com/fpp3/practical.html). CVM derivatives retain ODbL attribution/license; application code retains its existing license. The protocol is a project design, not an endorsement by those sources.
