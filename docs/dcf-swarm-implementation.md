# FilingLens hybrid DCF assumption review

## 1. Dependency mapping and risks

Adapted from the user-supplied `dcf-swarm-architecture.md` and `dcf-swarm-scaffold.patch` on 2026-10-20. The attachment targeted GPI; this implementation belongs to FilingLens, as requested. Existing signed GPI delegation authorizes the issuer/workspace, then server-owned archived SEC/CVM snapshots supply public facts. Neither client analyses nor arbitrary URLs supply model evidence.

Flow: verified delegation → durable bounded run → archived evidence → five specialist opinions (two concurrently) → index-only selection judge → disagreement-preserving ledger → explicit user transfer → pending DCF inputs → existing human acceptance, deterministic calculation and separate publication.

No trading, autonomous publication, agent tools, dynamic agents or agent-to-agent instructions. Source numbers must match the cited record's metric, unit and value; quote overlap alone cannot validate a forecast. In most cases forward inputs must be labeled estimates.

## 2. Architecture proposals

| Candidate | Feasibility and resource model | Latency | Controls and proof | Trade-off |
|---|---|---|---|---|
| One structured analyst | Existing provider adapter; one call, up to 2,400 output tokens | One model wave | Same evidence validator and human review | Cheapest baseline; less role coverage |
| Five specialists plus selector (implemented) | Existing Node service and MySQL; at most six calls, 14,400 output tokens, no provider retries | Four waves with concurrency two, capped at 100 seconds overall | Role scopes, schema/value checks, exact proposal selection, retained alternatives, cancellation and quota tests | More resource use; incremental quality remains unmeasured |
| Free multi-round swarm | Would require dynamic scheduling and bigger budgets | Unbounded without additional policy | Rejected: no measured benefit to justify additional failure surface | Not implemented |

Input payloads are bounded to 64 KB per call, evidence to twenty records/48 KB, generated objects to 64 KB. Each model call has thirty seconds including admission. No dollar cost is asserted without measured token usage and verified deployed model rates. Six calls are an upper bound, not a latency or quality promise.

## 3. Comparative pros and cons

The chosen workflow has measured deterministic validation behavior under injected model outputs. Specialist quality, provider latency, cost per successful review and human correction effort are **unmeasured**. Concurrency two preserves FilingLens's existing process-wide admission policy; the GPI scaffold's five-at-once assumption was not copied. Budget exhaustion returns failed-closed with retained valid opinions; no paid run is automatically retried after a crash.

## 4. Recommendation and rollout

Deploy the feature disabled (`DCF_SWARM_ENABLED` absent/false), as the supplied design requires. Existing valuation tools continue functioning. Enable only after reviewing the benchmark below with the deployed model. Confidence: 4/5 in the bounded control design, 1/5 in an incremental forecast-quality claim. This is an assumption-review aid, not proof of forecasting accuracy.

## 5. Implementation blueprint and interaction contract

- `contracts/dcf-swarm.ts`: typed briefs, closed keys/roles, numerical ranges/units and qualitative text bounds.
- `api/dcf-swarm/orchestrator.ts`: server evidence, five specialists, index-only judge, copy-only synthesis. All challenges and alternative opinions remain inspectable. A judge cannot invent a rationale, number or citation, upgrade an estimate, or silently erase a conflicting proposal.
- `api/dcf-swarm/routes.ts`: same signed issuer/session authorization as analysis; authenticated requests reread current authority. The existing schema migrator creates `dcf_debate_runs` additively/idempotently; the restricted application only verifies its presence. A MySQL named lock serializes the per-workspace daily quota (three runs), inserts, and idempotency. An already-used run ID cannot execute again or cross account boundaries. Read operations constrain account and issuer. On process loss, unfinished runs become visibly interrupted after 150 seconds and are never automatically replayed.
- `DcfDebatePanel`: idle/run/cancel-request/failed/saved-review states, evidence dates and immutable snapshot, specialist failures, original proposals and dissent. Reload retrieves the saved run. No fabricated progress percentage or automatic acceptance.
- Transfer is explicitly per assumption. Growth and margins are flat five-year suggestions, visibly identified; transfer invalidates calculated values and resets touched rows to proposed. Existing manual edits outside the selected assumption remain intact. Accept/edit and publication gates remain in the existing deterministic valuation workflow. Run/snapshot IDs survive in each transferred row's rationale and publication audit.
- No private filing body, token, holdings, or retrieved instructions enter this feature's model context. Safe error names and usage metrics are logged, not prompts or credential-bearing URLs.
- Rollback: disable `DCF_SWARM_ENABLED`; keep the additive table and existing receipts. Code rollback does not remove saved debate records.

## 6. Verification and release gates

Run unit/HTTP tests plus repository typecheck/build/full CI. Tests use synthetic outputs and verify zero-call paths, issuer/period boundaries, role impersonation, numeric grounding, malformed selection, partial provider failure, cancellation, transfer reset and anonymous authorization. They do not establish live model quality.

Before production enablement: prepare reviewed SEC and CVM evidence cases including sparse/missing/contradictory annual facts and injected instructions. Compare the one-call baseline, four-specialist ablation, and five-specialist workflow under equivalent context/output budgets, with at least three repeated trials per case. Preserve raw validated outputs and token counts privately. Require zero unsupported source-number/citation admissions, zero cross-issuer evidence, exact dissent retention and no automatic valuation approval. A human reviewer must assess forecast assumptions and correction effort. Report median/tail latency only with sample-size limitations. Do not enable on synthetic tests alone; the required live comparative benchmark has not been completed.

## Security and operational record

| Finding | Evidence | Fix | Residual risk |
|---|---|---|---|
| Attachment judge could invent proposals | Original validateConsensus checked citations but not specialist membership | Judge emits only key/role selections; server copies originals | Specialist estimates can still be wrong |
| Citation could launder unrelated number | Exact quote did not bind metric/unit/value | Exact structured source-value validation | Historical fact does not establish future outcome |
| GPI-only types/jobs unusable in FilingLens | Attachment imports foundation/research modules absent here | Native provider, delegated access, durable MySQL record and valuation UI | Deployment is separate from model enablement |
| Retry could duplicate charges | Request disconnect or process restart | Durable unique run ID, quota lock, no crash replay | In-flight provider billing may occur on cancellation |

Research foundations: the attached design; local authorization/valuation contracts; Microsoft HAI guidelines (https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf). Accessibility has semantic labels/status and keyboard controls; whole-application WCAG conformance and live user usability are not claimed.
