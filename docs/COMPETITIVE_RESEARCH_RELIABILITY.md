# Competitive Research Reliability — Computational Design & Agile Backlog

## Problem statement

The competitive-research lane had an all-or-nothing failure mode: a useful, cited research object could be rejected because one narrative field exceeded a presentation-oriented Zod length limit. A production run on 2026-10-07 returned valid peer/source evidence but failed because `marketStructure.summary` exceeded 420 characters. That is a control-plane defect: content formatting was allowed to invalidate evidence acquisition.

## Computational design

Treat the model as a probabilistic **candidate generator**, not the final validator.

1. **Discover** — web search produces candidate peers, claims and source URLs.
2. **Normalize** — deterministic text cleanup removes duplicated Markdown citations and bounds display text.
3. **Bind evidence** — only HTTPS URLs actually returned by the search provider are accepted.
4. **Recompute** — market-share percentages are recalculated from numerator/denominator; inconsistent values are dropped.
5. **Rank** — peer order is deterministic from relationship strength + source quality.
6. **Degrade locally** — invalid claims are dropped individually. One bad summary cannot discard valid peers.
7. **Recover by decomposition** — if the rich call fails, a plain-text source-discovery call runs first; a second no-tool classifier may use only that explicit source catalog.
8. **Publish diagnostics** — candidate count, verified peers, cited sources, dropped claims and recovery use are persisted.

Invariant: **probabilistic generation may propose evidence; deterministic code decides what reaches FilingAnalysis.**

## Agile delivery

### Sprint 1 — P0 competitive-analysis reliability

User story: As an analyst, when the research engine finds cited competitors, I must see the verified peers even if an unrelated generated field is too long or malformed.

Acceptance criteria:
- Generated narrative length cannot invalidate an otherwise valid research object.
- Inline model-generated Markdown citations are removed; source URLs remain in structured evidence.
- Provider-returned citation URLs remain the sole evidence boundary.
- Market-share percentages are application-recomputed.
- Peers are deterministically ranked.
- A source-catalog recovery path is available if rich structured research fails.
- Dashboard/progress UI exposes verified-peer and cited-source counts.
- Regression test reproduces a >420-character market-structure summary.
- Existing skill, financial, timeline, PowerPoint and build gates remain green.

### Sprint 2 — P1 upstream reliability — implemented

User story: As an analyst, temporary SEC/CVM provider failures should degrade gracefully rather than make authoritative history appear structurally missing.

Acceptance criteria:
- [x] Retry only retryable network/429/5xx failures with bounded exponential backoff.
- [x] Do not retry 4xx data/identifier errors except 429.
- [x] Preserve stale cached authoritative responses during a temporary provider outage.
- [x] Return actionable provider warnings without leaking stack traces.
- [x] Add deterministic provider retry tests.
- [x] Expose retry/cache-fallback capability in the data-tools health response.

### Sprint 3 — P1/P2 usefulness

Backlog:
- Treat filing types without standalone risk sections as Not Applicable rather than failed/partial.
- Add per-stage evidence counters to Data Quality.
- Add optional two-source corroboration for high-impact competitive claims.
- Add competitive peer grouping by operating segment.
- Add regression fixtures for diversified issuers (energy, automotive/energy storage, banks).
- Track research SLOs: successful cited peer retrieval, recovery usage, dropped-claim rate and stage latency.

## Definition of Done

A change is done only when TypeScript/Python checks, unit tests, production build, exact skill smoke tests and PowerPoint round-trip pass; production deployment is healthy; and the change is observable in runtime diagnostics.
