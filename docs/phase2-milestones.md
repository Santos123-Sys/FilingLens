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

## Milestone 2.3 — Competitive benchmark model (pending)
- Add independently sourced competitor financial data with issuer entity identifiers (CIK/CNPJ/ticker), metric definitions, accounting frameworks and period types.
- Build like-for-like comparison cohorts by fiscal period, currency conversion date, business scope and non-GAAP definitions. Reject mismatched peers.
- Separate moat mechanisms (switching costs, scale/cost advantage, network effects, intangible assets and regulation) from observed manifestations such as retention, ROIC persistence or pricing.
- Add uncertainties, source coverage and counter-evidence. No derived moat rating without direct supporting evidence.
- Acceptance: reproducible, source-cited peer metrics with tests preventing quarter-vs-FY, mixed-currency and unsupported moat comparisons.

## Milestone 2.4 — Forward outlook and valuation-driver bridge (pending)
- Turn cited company/segment guidance and independently cited competitor outlook into explicitly probabilistic revenue/margin/capex drivers.
- Quantify model sensitivity and flag which inputs are material to valuation instead of amplifying interesting but irrelevant news.
- Never equate a competitor analyst's narrative with management guidance; label source nature.
- Acceptance: side-by-side base/bull/bear driver assumptions with source provenance, sensitivity linkage, and explicit unsupported-data states.

## Infrastructure and release strategy
- The new Phase 2 computations are deterministic and operate on the existing FilingLens validated analysis contract. No new autonomous agent, MySQL table, or Railway service is required for milestones 2.1 and the initial 2.2 audit.
- Public competitive web research remains bounded by existing citation verification. No direct browser-to-database access is added.
- Merge only on green typecheck, tests and build. Railway auto-deploys `main`; verify **the new commit** reaches SUCCESS and review deploy logs, rather than assuming CI proves production.
- Exposing a new Phase 2 metric must fail closed if the evidence or comparability conditions cannot be established.
