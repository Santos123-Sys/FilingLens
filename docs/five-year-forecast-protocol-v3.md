# Five-year planning and horizon qualification v3 — frozen design

16 October 2026. Freeze this protocol and predictor before acquiring/scoring new
issuer outcomes. V2's first 60 issuers and FY2023–2025 outcomes are already known;
they are development/calibration evidence, never an untouched v3 test.

## Product scope

Use five annual planning years as the default explicit DCF horizon, not as a
universal market rule or a claim of five-year predictability. Keep the existing
five-year FCFF/ROIC arithmetic and reviewed ledgers compatible. A single coherent
revenue path must compound from one documented base. Every annual driver remains
editable; any edit invalidates empirical bands and creates an analyst scenario.
No automatic portfolio publication or acceptance of assumptions is introduced.
Terminal growth/ROIC/WACC remain independently reviewed; year five is not assumed
to be stable solely because the plan stops there.

## Fixed predictor

Require at least five consecutive positive calendar-year consolidated revenue
observations actually filed before the July 1 origin, with unchanged currency
and account definition. Use up to the last six values. Take the median of their
annual log changes, bound it to [log(0.8), log(1.25)], then damp it by 0.8^(h-1)
for h=1..5. Compound the five growth factors into one path. These fixed bounds
are conservative project controls against extrapolation explosions, not estimated
confidence limits or universal economic constraints. Preserve observed extremes;
never clip actuals, drop bad outcomes or tune these controls on the fresh test.
Compare with naive, legacy taper and adaptive v2 on exactly paired cases. Never
select a different model at each horizon to manufacture an incoherent path.

## Fresh issuer test and vintage integrity

Reuse v2's eligible 2018 universe and SHA256(`filinglens-forecast-v2:<code>`)
ordering. First 60 issuers are development only. The next **120** codes (zero-based
positions 60..179) form the new fixed issuer-held-out cohort. No sector, current
listing, later completeness or outcome filter. Any previously selected issuer
overlap is a hard error. Reconstruct from official retained CVM FY2010–2025 DFPs,
joining each statement to its exact-version receipt. Missing original vintages
are explicit exclusions. Archive retention/amendment attrition can bias the
reconstructed 2018 cohort; it is not a contemporaneous universe capture.

Score FY2023–2025 targets at horizons 1..5 separately (July 1 origins). Origins
must use only finished periods and receipts strictly before them. No new fiscal
year becomes an untouched temporal test merely because its issuer is new. Shared
macroeconomic regimes and overlapping forecasts remain dependent; this is an
issuer-held-out retrospective test, not prospective registration or global proof.

## Calibration and predeclared gates

Use only the original 60 development issuers for pooled horizon-specific 80%
empirical bands. At a forecast origin, calibration labels must already be filed;
never borrow fresh-test issuer errors. Error = absolute forecast minus actual,
scaled by that calibration case's last known revenue. Finite-sample upper order
statistic ceil((n+1)*0.8), with at least 30 errors across at least 10 development
issuers; otherwise unavailable. A band is [max(0,p-q*base),p+q*base]. Reject
nonfinite bounds. Pooling applies only to the BRL calendar-year CVM cohort;
manual/other-currency scenarios do not inherit calibration. Coverage, median and
mean width, and availability must be scored and shown, not assumed useful.

Qualify a point forecast **separately per horizon**, only if the fresh test has:
at least 30 paired issuers, at least 100 paired cases, at least 60% scored coverage
of all fixed attempts, six sectors with at least three scored issuers, macro
scaled absolute error at least 5% below legacy and no more than 5% above naive.
Publish v2 comparison, paired wins/ties/losses, all exclusions and worst cases.
Do not advertise all-five-year qualification unless all five horizon gates pass.
Band usefulness is a separate flag: at least 50 scored bands, at least 75% observed
coverage and median width no greater than 200% of base revenue. These are project
criteria, not significance tests, probability guarantees or a finance standard.

If any gate fails, keep that year as a conditional planning scenario and disclose
the failure. Do not relax gates or retune after opening the fresh test. Further
model work requires a new protocol and another untouched issuer/time cohort.
Revenue evidence does not validate margins, FCFF, WACC, terminal values or returns.

## Acceptance and reproducibility

Unit and independent-oracle checks must cover compounding, damping/bounds,
source-date/revision leakage, no held-out calibration, empty/nonpositive/mixed
history, per-horizon sample gates, interval availability, editing invalidation,
reviewed-only DCF transfer, base-period/currency ties, stale responses and exports.
Freeze hashes for protocol, predictor, source data and calibration inputs.
Retain v2 reports unchanged and attribute CVM derivatives under ODbL 1.0.

Sources: [CFA Institute practitioner discussion of five-year forecasts](https://rpc.cfainstitute.org/blogs/enterprising-investor/2026/rethinking-exit-multiples-in-high-growth-company-valuations),
[CFA financial statement modeling](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/introduction-to-financial-statement-modeling),
[Damodaran on growth duration](https://pages.stern.nyu.edu/adamodar/New_Home_Page/valquestions/highgrowthperiod.htm),
[damped trends](https://otexts.com/fpp3/exponential-smoothing.html).
The bounded median-log construction and thresholds are this project's design.
