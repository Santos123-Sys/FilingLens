# Brazilian data: diagnose, solve, verify

## 1. Diagnose the problem tree

The root problem is treating source availability as economic comparability or complete market certification.

| Branch | Solution | Release condition |
| --- | --- | --- |
| Fundamentals | CVM annual DFP and quarterly ITR bulk archives; exact CNPJ/account/period/scope/version; all-issuer API | Immutable source hash, strict units, no guessed or zero-filled facts |
| Instruments and prices | Existing paginated BrAPI B3 catalog, exact CNPJ/ISIN mapping, existing raw-price and cash/stock normalization engine | Each instrument passes independently; unavailable entitlements remain blocked |
| Operations and evidence | Shared bounded archive cache, immutable original archives, source receipts, cross-app API, explicit SEC access status | Regression tests, CI, deployment SHA and authenticated source canary |

CVM-registered issuers, DFP filing issuers, B3 companies, share classes, fractional-board lines and tradeable instruments are different populations. None is a substitute denominator for another. This API has no hand-picked company allowlist. A company with no filing, ambiguous sector mapping, unsupported scope, short listing history or unverified events remains visibly incomplete.

## 2. Implemented contract

FilingLens remains the financial-data owner. New service-token-authenticated endpoint:

`POST /api/integration/v1/brazil/fundamentals`

```json
{"operation":"issuers","offset":0,"limit":50,"activeOnly":true}
```

```json
{"operation":"facts","cnpj":"33000167000101","form":"ITR","year":2026,"scope":"consolidated","offset":0,"limit":100}
```

```json
{"operation":"screen","form":"DFP","year":2025,"scope":"consolidated","offset":0,"limit":50}
```

Follow `nextOffset` until null. A facts request addresses one archive year, not a claim of five-year completeness: enumerate DFP/ITR years and pages to cover the desired window. `scope=standalone` is explicit and never replaces consolidated figures silently. The private data-tools endpoint is `/v1/fundamentals/br`, authenticated with the existing corpus token. No new public data-tools domain is created.

GPI exposes these operations to signed-in users through `POST /api/integration/v1/brazil-data`; `GET` at that route pages the B3 vendor instrument catalog and labels identity/fundamentals/risk as not evaluated. POST reads require same-origin requests. This does not add a stock to a user's workspace or authorize portfolio use. No holdings, account datasets or frozen valuations are modified.

Every account fact includes CNPJ, form, statement, account code/label, period start/end, reference date, filing version, consolidation scope, original currency/scale/value, normalized exact decimal value, source URL, archive SHA-256, member and row. Mapping is deterministic and versioned. Both issuer-specific and unmapped accounts remain available as reported facts. Bank/insurer accounts requiring a different economic model do not become industrial revenue, debt, EBIT or gross profit merely because account codes overlap.

Conflicting observations are excluded from canonical selection and reported. Multiple duration contexts remain explicit arrays with `ambiguousMetrics`; ITR YTD is not relabeled as a standalone quarter. Missing values never become zero. Derived liabilities/debt require both compatible components. The existing annual enrichment now reuses this strict shared implementation and requires all requested years before declaring complete.

The archive receiver limits compressed/expanded sizes, members, concurrency, response bytes and request pages; rejects traversal/encrypted members and untrusted URLs; and bounds network requests. It preserves original archives and acquisition receipts. Read-only access does not label official reported numbers independently verified.

### Persistence and refresh

Set `CVM_ARCHIVE_CACHE_DIR=/data/cvm-archives` on a persistent data-tools volume. Without a volume the default `/tmp/filinglens-cvm-archives` is an ephemeral local cache. Original blobs are content-addressed and receipts are immutable; current pointers are atomically replaced. Reuse is six hours; a failed refresh returns unavailable rather than relabeling stale data as current. Monitor volume utilization: archive vintages are not automatically deleted. The existing MySQL regulatory snapshots remain durable and separate from this raw archive store.

Current archives contain revisions, not every historical publication vintage. `availableAt=null`, `pointInTimeSupported=false`; unknown `asOf` queries are rejected. Retrieval time is not filing availability. This release does not certify point-in-time backtests, price history, cash events or all B3 stocks.

## 3. Verify and operate

Live local acquisition on 2026-10-21: CVM register returned 661 active issuers; DFP 2025 archive enumerated 669 filing issuers; Petrobras had 286 consolidated annual account facts and 615 ITR 2026 account facts. The population difference is expected and must stay visible. Full-archive normalization coverage is measured separately by `ops/check-brazil-fundamentals.py`.

Tests cover monetary scaling, zero versus missing, per-reference filing-version selection, conflicting values, sector semantics, ITR durations, pagination, source integrity, safe archives, auth, identity mismatches and SEC no-network pause. Optional `BRAZIL_FUNDAMENTALS_CANARY_ENABLED=true` invokes the exact deployed service-token API for registry, annual screening and Petrobras ITR once at app startup and logs only public counts/hashes. Disable after verification.

### SEC finding and change

`config/sec-acquisition-access.json` still records an unresolved official HTTP 403 and `state=paused`. New `/api/integration/v1/regulatory-access` reports that exact policy without probing SEC. Python health also reports it. The Python SEC provider and normal production peer lookup now honor the same pause before network access; synthetic test transports remain usable. SEC contact must be explicitly configured, CIKs cannot be truncated, and `USD/shares` cannot be treated as `USD`. No new SEC request was used to bypass the incident. Lawfully acquired cached evidence remains distinct from fresh acquisition. Recovery requires the process documented in `docs/sec-access-recovery.md`.

### Economics and limitations

Free CVM/SEC source access does not make normalization, quality control, storage, support, share-class mapping, restatement history or licensed prices free. No specific paid plan or monthly price was evaluated or purchased. Keep CVM open-data attribution/licensing, market-data rights and downstream redistribution scope attached to their own source contracts. B3's public historical quotation page states that quotations are unadjusted and prohibits automated collection; this release does not scrape it.

Sources: https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp ; https://dados.cvm.gov.br/dataset/cia_aberta-doc-itr ; https://www.sec.gov/search-filings/edgar-application-programming-interfaces ; https://brapi.dev/docs/acoes/historico .

### Measured annual-archive coverage (2026-10-21)

Full DFP 2025 replay: 669 issuers in the selected statement archives; 440 with consolidated facts; 229 with consolidated scope missing. Unambiguous canonical coverage: assets 440; operating cash flow 438; cash 428; equity/current liabilities/non-current liabilities 427 each; revenue/EBIT/short-term debt/long-term debt 424 each; net income 425. Zero parsing/conflict issues were returned for this replay. Archive SHA-256: `5e273568aae97d1301c852e9f5d2ed024584beab31ee82a65eff47478ffdf34f`.

These are latest-archive reported facts, not 669 validated listed stocks. The account API covers BPA, BPP, DRE and direct/indirect DFC tables; equity movements, comprehensive income and value-added tables are not included in v1. Additional sectors/accounts remain available only when the selected source tables and semantic mappings support them. Every per-issuer conflict now changes its screen status to `conflict`; other valid accounts remain inspectable.
