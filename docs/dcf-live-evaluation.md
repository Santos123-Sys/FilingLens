# DCF live release experiment

First deploy `ops/phase1-schema-migrator.ts.txt` to the existing schema migrator with `DCF_SCHEMA_ONLY=true`. That additive branch creates/verifies the two DCF tables and returns before legacy grants/password operations. The application keeps its existing SELECT/INSERT/UPDATE/DELETE privileges and only verifies schema with read-only queries. Production rejected the earlier request-time CREATE with `ER_TABLEACCESS_DENIED_ERROR`; do not solve that by granting DDL privileges to the app.

Set a fresh UUID in `DCF_BENCHMARK_RUN_ID` on the FilingLens Node service. Its next startup runs one bounded experiment; a durable unique receipt prevents paid execution from repeating after a crash/redeploy. A running/crashed receipt is never silently replayed. This flag does not enable user generation.

The same validators and evidence limits compare one analyst, four specialists plus selector, and five specialists plus selector. Cases are archived SEC Apple and CVM Petrobras, a derived sparse SEC case and a CVM prompt-injection case. Three trials rotate architecture order per case. Missing evidence separately requires zero calls. Maximum 144 model calls, two concurrent process-wide, no retries, twenty-five-minute experiment deadline and existing run/call deadlines. Input evidence is capped equally. All modes have a completion-token ceiling no greater than the five-role workflow's aggregate ceiling; actual usage is reported rather than assumed equal.

Private MySQL receipts retain validated outputs, input hashes, snapshot IDs, calls, latency, token use and disagreements. Public `/api/status` exposes aggregate metrics only. No private filing, holdings, credentials, user workspace, accepted assumptions or valuation is modified. Outputs remain unapproved hypotheses.

Mechanical eligibility requires all twelve trials for a mode to complete with known usage, at least two proposed keys, no injected sentinel and all role/source validators passing. Missing, duplicated or failed trials block eligibility. This measures operational/safety behavior, **not forecast accuracy**. Sparse-data coverage can reveal overconfident guessing; review retained estimates and correction effort before enabling production swarm generation. More dissent or more keys alone does not prove quality improvement.

`DCF_SWARM_ENABLED` is not changed automatically. An unfinished/rejected benchmark stays visible. Disable/remove the experiment UUID to stop future startup work; completed receipts remain. Running work obeys its deadline and platform termination. Never reset a receipt to force replay: a deliberate new experiment uses a new UUID.


## Recorded result and supervised preview

Experiment `d307995c-98b9-4764-a458-d5ea03a2ba52`, completed 2026-10-20 at 09:44:05 UTC, used the deployed gpt-6-sol model for thirty-six trials and 144 model calls. All trials produced reviewable ledgers and none admitted the injected sentinel. Invalid individual proposals may be rejected by the validators; this is not proof that every raw generation was valid. The missing-evidence control made zero calls.

| Mode | Trials meeting the preset operational/coverage gate | Calls total | Tokens reported total | Median latency | Largest observed latency |
| --- | --- | --- | --- | --- | --- |
| Single analyst | 7/12 | 12 | 38,654 | 7.59 s | 10.14 s |
| Four specialists plus selector | 12/12 | 60 | 148,943 | 14.45 s | 17.07 s |
| Five specialists plus selector | 11/12 | 72 | 189,931 | 20.43 s | 28.25 s |

The five-specialist workflow missed the minimum-proposal threshold in one sparse case. A cautious abstention is not necessarily an error: that threshold is a utility screen, not ground truth. More proposals or challenges do not establish better assumptions. The extra challenger's incremental financial quality remains unproven. The cases cover two real issuers and two derived test cases, not a broad financial benchmark; no population p95, dollar cost or forecast-accuracy claim follows.

Enable only a supervised four-specialist draft preview with `DCF_SWARM_MODE=four` and `DCF_SWARM_ENABLED=true`. The server recomputes the recorded operational gate, requires the configured experiment ID, checks the saved prompt version and model pins, and denies five-role/unmatched/incomplete receipts. Existing quota, auth, estimate/source labels, explicit transfer, human acceptance and separate deterministic valuation publication remain mandatory. This preview makes no claim that human correction effort or future forecast accuracy improved. Roll back by setting `DCF_SWARM_ENABLED=false`.
