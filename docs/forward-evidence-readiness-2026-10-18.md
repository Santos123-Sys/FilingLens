# Forward evidence readiness — 18 October 2026

## Outcome and limits

The previous release's live page still displayed the initial unanchored local
snapshot after its GitHub timestamp had actually been verified. This update
publishes a separate dated timestamp attestation and makes the operational
state distinguishable from predictive accuracy. It does not change any frozen
forecast, prior score, predictor, precision gate, issuer exclusion or result.

Future accuracy cannot be established on 18 October 2026 for the fixed calendar
annual FY2026–2030 targets. The input contract requires a December 31 period end
and a subsequent publication date. A CVM resource named 2026 is not by itself a
qualifying outcome for these targets; interim results, other fiscal calendars,
revised prior-year figures and analyst estimates cannot be substituted.

The existing 455 paths remain pending, with no error or coverage invented.
Historical issuer-held-out evaluation remains available separately. Years 3–5
failed bands stay withheld. No claim of lower prediction error is made.

## Observation and trust contract

| Evidence | State | Next action |
| --- | --- | --- |
| Frozen registration | Independently observed in successful GitHub CI run 39115630450 at 2026-10-18T09:30:51Z | Inspect the exact commit and digest in the downloadable attestation |
| Current outcome snapshot | Initial dated unanchored snapshot; all targets pending | Preserve it as audit evidence; score later qualifying actuals with live receipt verification |
| Target year not complete | Not yet observable | Wait for year-end and a qualifying annual disclosure |
| Year complete, disclosure absent | Annual disclosures pending | Acquire retained filing vintages and verify period, definition, currency and publication date |
| Outcomes scored | Validation decision pending | Inspect errors, coverage, exclusions and adequate sample evidence; do not auto-qualify accuracy |
| Positive signed-in GPI production path | Requires secure user sign-in | Verify the existing workspace and minimal handoff without private portfolio mutation or access bypass |

`checkedWatchAttestation` checks shape, exact ledger digest, receipt URL and
chronology. This offline consistency check does **not** independently authenticate
an arbitrary receipt. The attestation was produced by the real fixed-origin
GitHub verifier. A parsed or copied attestation never belongs to the verifier's
private WeakSet and cannot authorize prospective scoring.

The browser displays a dated observation, not a continuously rechecked badge.
CI keeps deterministic offline reproduction; it does not add a network dependency
to every PR merely to display this retained evidence. Recheck the real provider
explicitly before publishing or relying on refreshed timestamp evidence:

```sh
FORECAST_WATCH_ANCHOR_RUN_ID=39115630450 npm run forecast:watch -- attest
npm run forecast:watch -- verify-attestation
npm run forecast:watch -- verify
python ops/verify-forecast-watch.py
```

`attest` updates only the dated attestation, never forecasts or outcome scores.
`verify-attestation` re-fetches actual GitHub metadata and committed snapshot bytes
and compares the receipt. Unavailable or changed evidence fails closed. Neither
command qualifies prediction accuracy or starts an automatic actuals collector.

No authentication implementation, credential, permission, database schema,
production account, financial model or dependency is changed. Do not create a
test-login bypass to close a missing production-browser evidence gap.

## Acceptance and release

- Tampered digest, URL and chronology fail validation.
- A parsed attestation cannot act as live scoring authority.
- Reporting-year, missing-disclosure and scored states remain distinct.
- The UI exposes the receipt and period ends without implying future accuracy.
- Original watch, pending score and predictor remain byte-for-byte unchanged.
- Release only through green PR CI and verify the actual Railway source SHA.

User authorization covers this follow-up's verified merge and Railway release.
Local verification: 437 tests, typecheck, production build and changed-file
ESLint pass. The real GitHub attestation command and re-verification both pass;
the independent Python oracle reproduces all 455 paths. No frozen forecast,
pending score or model bytes changed. Both mobile/desktop five-year browser runs
pass after restoring the missing local Chromium runtime. The production browser
still has no verified signed-in session; manual secure sign-in is needed before
the actual positive-path test can be completed. No auth implementation defect
has been established by this lack of access.

Rollback to preceding FilingLens merge e4aec15 restores the previous interface;
retain the published attestation and registration in history as audit evidence.
No data migration or portfolio change needs reversal. Confidence is conditional
on the tests and production evidence recorded in the release PR, not this plan.

Primary source: [CVM DFP dataset](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp).
The calendar restriction is this project's explicit input contract, not a claim
that every CVM issuer follows a December fiscal year.
