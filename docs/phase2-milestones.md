# FilingLens Phase 2 — Segment, competitive and investment-driver intelligence

Updated: 2026-10-08. Phase 1 provides a source-aware financial foundation; Phase 2 adds decision-relevant business analysis without pretending that filing excerpts reveal undisclosed numbers.

## Milestone 2.1 — Operating-segment economics (implemented in this PR)
- Capture exact source-disclosed **unit** and **currency** alongside segment revenue and segment operating earnings, when the filing explicitly provides them.
- Parse and align annual FY and genuine comparable quarters; never convert YTD or LTM values to quarterly or FY observations silently.
- Require a quoted filing source, distinct segment names, and one-to-one periods for the revenue and earnings arrays. Flag unusable series rather than fabricating alignments.
- Calculate source-local implied margin (earnings / revenue) and YoY revenue changes only for exact FY/FY or same-quarter/year-earlier pairs; no zero/negative comparison denominator.
- Segment mix requires two or more disclosed segments with **the same period and exactly matching source-declared unit and currency** and positive sum. Label denominator as *sum of disclosed segments* — never as consolidated revenue or market share. Never assume intersegment eliminations reconcile without a filing source.
- Add bilingual Market-tab cards, period choice, evidence quotes, source links and comparability diagnostics.
- Tests: period separation, YoY, missing/different units, duplicate periods, evidence, zero denominator.

## Milestone 2.2 — Peer / moat evidence coverage (implemented initial audit in this PR)
- Count independently linked numerical observations, moat evidence statements and cited outlook by peer.
- Display distinct source hosts and missing-data flags; cite counts are **not** moat strength scores.
- Preserve the existing cited competitive deep-dive component and market-share verification.
- Tests: malformed URLs, uncited claims, source-host deduplication.
- Still needed for a full peer benchmarking engine: semantic metric mapping and period/unit/currency normalization; no cross-company margin or multiple comparison without that mapping.

## Milestone 2.3 — Competitive benchmark model (partial implementation in PR #35)
Implemented: deterministic normalization of existing citation-linked peer facts to a whitelist of financial metrics; explicit FY period-end dates, consolidated reporting scope, accounting basis, ISO currency and scaled numeric amounts; intra-peer net margin; and issuer-versus-peer absolute comparisons only when all fields including exact fiscal-year-end match. Duplicate or malformed data are excluded with visible explanations. Uses existing cited research lane; **does not claim independent audit of model-extracted figures**.

The next increment, PR #36, adds SEC EDGAR CIK/accession entity checks and numerical matching against the *same filing accession* in SEC CompanyFacts. Only genuinely matching, year-long US GAAP USD facts are admitted into benchmark comparisons. Unverified cited figures, conflicting tags, issuer mismatches and unsupported Brazilian/IFRS data fail closed. The SEC API check is a source consistency test, not an independent audit, and runs only with a configured compliant SEC User-Agent. Limit SEC checks to three candidate issuers and bounded seven-second network calls.

PR #41 adds **up to five fiscal years of multi-metric primary SEC history per verified peer** from the already fetched official CompanyFacts record. It excludes historical facts whose SEC financial-year, 10-K accession, duration, taxonomy values or issuer identity are inconsistent, then calculates annual within-peer growth and finds narrowly matched exact-end-date peer cohorts. A successful primary SEC filing-figure proof remains the prerequisite for expanding that peer. The history is shown separately from model-generated peer narrative and does not silently map an IFRS or CVM metric onto US GAAP.

Still pending for full milestone completion: authenticated CVM/IFRS peer amounts, wider ticker-to-legal-issuer directory verification, independently validated cross-standard accounting-definition bridges, FX rates with explicit timestamps, and like-for-like valuation multiples with matched equity/debt/market-price timestamps. Missing support must result in empty rather than invented charts.
- Add independently sourced competitor financial data with issuer entity identifiers (CIK/CNPJ/ticker), metric definitions, accounting frameworks and period types.
- Build like-for-like comparison cohorts by fiscal period, currency conversion date, business scope and non-GAAP definitions. Reject mismatched peers.
- Separate moat mechanisms (switching costs, scale/cost advantage, network effects, intangible assets and regulation) from observed manifestations such as retention, ROIC persistence or pricing.
- Add uncertainties, source coverage and counter-evidence. No derived moat rating without direct supporting evidence.
- Acceptance: reproducible, source-cited peer metrics with tests preventing quarter-vs-FY, mixed-currency and unsupported moat comparisons.


### Milestone 2.3 release acceptance gates
- Inputs: candidate peer facts retain an external research citation that was present in the verified source catalog; no fictional fact or number is added on the client.
- Accepted peer observations must state a whitelisted metric, FY period label, exact fiscal year end, consolidated basis, named accounting standard, ISO currency and numeric scale. The engine refuses unsupported locales, ambiguous currencies, duplicate facts, and interim/annual period mixing.
- Peer income margins are only computed using revenue and net income in the same issuer, currency, period end and accounting basis.
- Issuer–peer values must additionally match exact year-end date, reported unit, issuer statement scope and accounting standard. Same calendar year alone is not enough.
- Tests include cross-currency, mismatched year-end, unknown issuer basis, ambiguous formats, negative net income and duplicate handling.
- No new database service, agent or outside research calls are added merely to calculate comparisons.

## Milestone 2.4 — Forward outlook and valuation-driver bridge (first implementation)
- Deterministic evidence-gated historical driver baseline: consecutive source-cited FY revenue growth, matching EBIT margin, capex intensity.
- Separate cited management guidance from peer analyst outlook; never equate them.
- User explicitly initializes, edits and approves bear/base/bull assumptions with probability weights summing to 100%. All scenario deltas are analyst illustrations, never company guidance or AI predictions.
- Project third-year revenue, EBIT, capex and EBIT-less-capex as an *operating contribution proxy*, NOT FCFF, intrinsic enterprise value or equity price.
- Rank the impact of a 1-percentage-point perturbation in operating driver assumptions on that proxy; never represent proxy sensitivity as valuation sensitivity.
- Connect to the existing independently approved DCF WACC × terminal growth and implied per-share valuation if and only if a completed valuation exists.
- Fail closed on missing source evidence, inconsistent FY periods and incomplete assumption validation.
- Full valuation impact from scenario-driven multi-year DCF reruns remains outside this initial increment; pre-existing assumption-gated DCF is preserved.
- Turn cited company/segment guidance and independently cited competitor outlook into explicitly probabilistic revenue/margin/capex drivers.
- Quantify model sensitivity and flag which inputs are material to valuation instead of amplifying interesting but irrelevant news.
- Never equate a competitor analyst's narrative with management guidance; label source nature.
- Acceptance: side-by-side base/bull/bear driver assumptions with source provenance, sensitivity linkage, and explicit unsupported-data states.

## Infrastructure and release strategy
- The new Phase 2 computations are deterministic and operate on the existing FilingLens validated analysis contract. No new autonomous agent, MySQL table, or Railway service is required for milestones 2.1 and the initial 2.2 audit.
- Public competitive web research remains bounded by existing citation verification. No direct browser-to-database access is added.
- Merge only on green typecheck, tests and build. Railway auto-deploys `main`; verify **the new commit** reaches SUCCESS and review deploy logs, rather than assuming CI proves production.
- Exposing a new Phase 2 metric must fail closed if the evidence or comparability conditions cannot be established.
