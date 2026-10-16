# Valuation correctness and inspectable financial evidence

## Scope and decision

GPI remains the navigation/research workspace, FilingLens the financial calculation owner, and Portfolio Risk the risk owner. This release improves the existing boundaries; it adds no service, vendor, dependency or migration. US SEC and Brazilian CVM scope remain unchanged; no Swiss coverage is added.

The software deliverable takes precedence over an investment recommendation or a spreadsheet model. The real Apple example is an illustrative reference calculation, not a current target price or a forecast-performance claim.

## Prioritized diagnosis

| Priority | Observed issue at FilingLens `4b56ba8` | Decision impact | Implemented correction |
|---|---|---|---|
| P1 | `api/valuation/dcf.ts` grows Y5 FCFF to perpetuity without an explicit sustainable reinvestment assumption | Terminal value can encode an undocumented return on new capital | Require terminal incremental ROIC; FCFF6 = NOPAT6 × (1 − g/ROIC), version `fcff-roic.v2` |
| P1 | Negative EBIT receives an immediate tax benefit under EBIT × (1−tax) | Overstates cash flow without a supported NOL/recoverability schedule | No immediate operating-loss tax benefit; show model limitation |
| P1 | `financial-metrics.ts` can use reported FCF as its own calculated comparator | A report of 999 can pass despite CFO 100 and capex 20 | Independent CFO − abs(capex) diagnostic equals 80; preserve reported definition |
| P1 | DCF lacks a sector suitability boundary and permits currency relabelling | Industrial FCFF may be misapplied to a bank or USD amounts renamed BRL | Block recognized banks, insurers, REITs; require compatible currency, explicit valuation date and supported terminal economics |
| P2 | Proposal sources selected by first metric match without period | Latest annual value can open an earlier-period quote | Remove misleading single-source assignment; navigate period-specific underlying evidence |
| P2 | Whole-series confidence can borrow evidence from one year | Unsupported years appear well sourced | Require every component × every period for the legacy qualitative confidence field |
| P2 | Valuation exports omit financial evidence; GPI receives an opaque snapshot hash | Saved values cannot be inspected end to end | Export full evidence graph; protected audit endpoint; GPI account/version/issuer checks and evidence dialog |
| P2 | No convenient recovery of a previous in-session ledger | Changes are hard to compare or undo | Five in-session snapshots, changed-input comparison, restore and explicit durable export |

## Research to implementation

See [valuation-source-matrix.md](valuation-source-matrix.md) for 13 opened sources, dates, locators, contributions and limitations. These are implementation requirements, not assertions that a cited author validated GPI.

| Source | Requirement | Implementation | Verification |
|---|---|---|---|
| Damodaran, *Value Creation and Enhancement*, pp.5–7 | Growth requires reinvestment tied to incremental capital returns | `api/valuation/dcf.ts`, explicit terminal ROIC; shared discount helper accepts terminal CF6 without growing it twice | Independent level-perpetuity and terminal-cash-flow references; terminal-growth/ROIC rejection |
| CFA, *Free Cash Flow Valuation*, 2026 public summary | Match FCFF/WACC and equity bridge; separate operating cash proxy | DCF notes, nominal currency check, explicit bridge and shares; independent reported FCF comparison | Currency mismatch, signed bridge, share positivity, FCF discrepancy tests |
| Damodaran financial institutions notes; CFA residual income summary | Method follows economics | `fcffSuitability`; financial/REIT gate, specialized method guidance | Recognized financial sector denied by server; unsupported status visible |
| McKinsey ROIC/growth; MSIM intangible investment; original Ewens/Peters/Wang paper | Avoid costless growth and unexplained adjustments | Explicit reinvestment/ROIC; retain reported figures and analyst assumptions; no automatic R&D capitalization | Source classifications, forecast/actual separation, conditional sensitivity tests |
| SEC XBRL API; SEC C&DI102.07; IFRS IAS38 summary | Preserve fiscal/unit/definition context and differences | Annual-only basis, per-period sources, reported FCF preserved; missing values stay missing | Existing quarter/YTD, scale, source and identity tests; new period evidence regressions |
| Hyndman/Athanasopoulos rolling evaluation | Forecast accuracy needs genuinely out-of-sample evidence | No forecast accuracy claim; two-year reference explicitly insufficient | Sample limitation displayed and recorded; no fabricated backtest or consensus |
| W3C PROV-O; WAI Dialog pattern | Navigable derivation and keyboard inspection | Versioned graph, safe source links, formulas, input/dependent navigation, export, Radix modal; GPI native dialog | Graph completeness, unsafe links, wrong workspace/issuer, focus return, mobile/desktop flow |

## Financial conventions and sector limits

- Supported implemented reference: non-financial operating-company five-year nominal FCFF, discounted at nominal WACC, end-year Y1–Y5 measured from the chosen valuation date. The historical base is not automatically rolled forward and there is no stub-period model.
- Explicit forecasts retain D&A, capex and operating NWC ratios. Terminal CF replaces those ratios with sustainable reinvestment `g / terminal incremental ROIC`; Y5 operating margin persists in Y6. Transition to perpetuity is a substantive assumption to review.
- Require WACC > g, positive terminal NOPAT, positive terminal ROIC, and 0 ≤ g ≤ terminal ROIC. Negative perpetual growth is unsupported by this particular steady-state model; it requires a specialized run.
- No immediate operating-loss tax benefit; no integrated tax-loss carryforward schedule. Debt tax shield still assumes the reviewed WACC tax convention.
- Equity = EV − net debt + signed other bridge adjustments; divided by reviewed diluted shares in millions. No automatic claim that leases, marketable securities, preferred/minority interests or option dilution were exhaustively reconciled.
- Generic FCFF is blocked for recognized banks/insurers/REITs. Classification is a guard, not proof of suitability. Utilities, energy/commodities, early-stage companies, software intangibles and conglomerates may need regulatory, cycle, reserve, financing, retention or segment schedules. DDM, FCFE, residual income, NAV and SOTP are guidance/deferred workflows, not newly implemented engines.
- Comps remains the existing reviewed component-based method. Sector membership alone is not peer justification; analyst review of economics, periods, accounting and capital structure remains necessary.

## Evidence contract

`financial-lineage.v1` separates original sources from extraction/calculation method. Nodes retain issuer/registry, metric, period, unit, classification, formula/rationale, input IDs, safe source references, specific checks, limitations and dependents. Missing evidence and observed conflicts propagate through dependent results. Analyst acceptance is not source verification.

`Source linked` means a metric/period locator is attached; it does not assert numerical reconciliation or independent audit. `User supplied` means an analyst input. `Calculated` means deterministic derivation conditional on inputs. `Unverified` and `Conflicting evidence` remain visible. Original title/publication date/fingerprint or extraction method that was not retained is explicitly unavailable; the UI does not fabricate it.

`financial-audit.v1` exports company, metadata, financials/evidence, sector context, reviewed ledger, result and graph. Session credentials/capabilities are excluded. Approved publications preserve immutable server audit data; unsaved session snapshots are explicitly memory-only and require export to survive reload.

`valuation-audit.v1` is read through FilingLens's existing service identity plus workspace header. GPI checks current signed-in workspace, locally saved valuation, canonical issuer, outer version/issuer, inner graph identity, graph bounds, dependencies/cycles, source URL safety and root value/unit before exposing it. No database/service credential reaches the browser. Denials use `no-store`; evidence access never grants permission to an upstream private document.

Existing historical valuation versions are retained and labeled legacy. They are not silently recalculated. A fresh ledger requires terminal ROIC/date; rebuilding preserves reviewed DCF input values while adding missing fields. A new reviewed publication remains subject to current GPI permissions.

## Real-data reference and test interpretation

Open `/valuation/reference/apple`. Original document: [Apple FY2025 consolidated statements, unaudited](https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf), pp.1–3. Saved source hash `43e7f0730b3cce0fc37301a2f43c29712bbde6ab299d97c6df345fd0c754508a`; prior retrieval date2026-10-09. Current public PDF was reopened in this implementation session; numerical tables were checked against the source. Exact quotation regressions verify the frozen extracted text separately from live access.

The illustrative ledger uses annual revenue416,161 and EBIT133,050 (USD millions), analyst WACC8%, terminal growth2%, terminal incremental ROIC20%, and FY2025 weighted-average diluted shares15,004.697million. Independent Python reference: EV1,844,438.46647million; net debt62,723million; other adjustment0; equity1,781,715.46647million; value/share118.74384844, displayed118.74. Shares are historical, the debt/cash snapshot is historical, leases/securities and other bridge claims are incomplete. This is a reproducible arithmetic example, not decision-grade current fair value.

The journey covers: choose the Apple reference → inspect reported revenue → follow formulas/inputs → edit terminal ROIC → compare scenarios → recalculate → save/restore a session version → export source and calculation lineage. GPI additionally inspects a saved valuation through the authenticated cross-app flow.

### Reproduce checks

```bash
npm run check
npm test
npm run build
# Reuse the connected GPI repository's existing Playwright dependency; no new package is required:
PLAYWRIGHT_TEST_MODULE=/absolute/path/to/gpi/node_modules/@playwright/test node ops/verify-valuation-workflow.cjs
```

`ops/verify-valuation-workflow.cjs` starts the built local server and browser in one process scope. It uses only public reference data and deterministic calculation APIs. Tests use isolated accounts/stores for authorization; no production portfolio is created.

## Release and rollback

Deploy FilingLens before GPI so the producer endpoint is available first. Both releases are additive and require no database migration or secret change. Existing API consumers retain `valuation.v1`; audit access is a new endpoint. Keep the current GPI source and capability policy intact.

Rollback by reverting the coordinated release commits through PRs, passing CI, and allowing existing main-branch Railway deployment. Stored reviewed versions/audits are immutable and are not deleted by code rollback. GPI must show audit unavailable if the producer endpoint is rolled back; existing valuation summaries remain usable with their source limitations. A code rollback does not erase results already published under v2; use their saved calculation version and inputs for reproduction.

## Material residual gaps

Signed-in production user acceptance needs a user-authorized session; earlier declined authentication is not retried automatically. Local browser and isolated authenticated cross-app tests do not establish live usability. SEC acquisition access remains an independent provider/operations issue. No forecast-accuracy gain, broad narrative RAG-quality gain, full sector coverage, enterprise lakehouse/SAP integration, full accessibility conformance or exhaustive penetration testing is claimed. Legacy/unsupported numerical surfaces outside the new financial/valuation lineage remain work for subsequent releases.
