# FilingLens exact skill runtime

The five supplied skill packages are integrated as bounded sub-tools behind the Agent Manager.

- `equity-research`: Tear Sheet methodology only, with citation-backed issuer/business cross-check. Filing data remains authoritative; Equity Report/valuation modes are not invoked.
- `market-research-brief`: analytical framework only, with filing-first market evidence and citation-backed peer research when the filing contains no usable peers.
- `financial-ratio-toolkit`: the supplied `scripts/analyze.py` is executed from the preserved source archive once per usable filing period. FilingLens conventions override incompatible debt, ROIC, period and locale definitions.
- `financial-statement-analyzer`: the supplied `scripts/analyze_financials.py` is executed on comparable filing periods and supplements, rather than replaces, FilingLens reconciliation checks.
- `filing-timeline-extractor`: filing extraction and citation-backed gap enrichment are followed by the supplied `validate_timeline.py` before events are bound. Rejected events are dropped with visible validation flags.

The Node production image therefore requires Python 3. The repository `Dockerfile` installs Python and sets `PYTHON_EXECUTABLE=python3`. No additional Railway secret is required for the deterministic Python skills; web-enriched stages use the existing OpenAI configuration.

CI typechecks, runs the test suite, performs a production build and smoke-tests each exact Python utility so a missing runtime/archive fails before merge.
