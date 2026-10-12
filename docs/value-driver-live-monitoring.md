# Value Driver Intelligence — Live Data, Probabilistic Risk and Scheduled Watch

## Delivered architecture

```
FMP licensed HTTPS API (quote + profile + annual analyst estimates)
          | fixed upstream host + server-side API key
          v
FilingLens Railway Hono routes /api/value-drivers/*
          | validate ticker / currency / timestamps / finite values
          | deduplicate cached requests, 90-second TTL
          v
Value Driver Intelligence UI in DashboardV2 and /value-drivers/apple
          | manual quote override, 5-minute foreground refresh
          | explicit quote observation time vs estimate retrieval time
          +----> FCFF + reverse DCF (existing deterministic contract)
          +----> seeded 1,000-draw triangular Monte Carlo (analyst ranges)
          |
Railway Cron (hourly, separate one-shot process)
          | FILINGLENS_MONITOR_SYMBOLS restricted allowlist, max 12
          | FMP provider key; no private uploads transmitted
          v
MySQL: value_driver_market_snapshots + value_driver_watch_signals
          | persisted hashes deduplicate polls / retry events
          v
Public watch history route -> in-app review signals
```

## Licenses and secrets

FMP documents:
- [Stock Quote API](https://site.financialmodelingprep.com/developer/docs/stable/quote)
- [Company Profile API](https://site.financialmodelingprep.com/developer/docs/stable/profile)
- [Financial Estimates API](https://site.financialmodelingprep.com/developer/docs/stable/financial-estimates)

Access to the annual analyst-estimates endpoint varies by FMP subscription. It cannot be assumed available on Basic/free plans. Market data may be delayed. Redistribution/display rights must be confirmed by the operator before turning on the public-facing feed.

For the **FilingLens web service** set:
- `FMP_API_KEY`: server-side FMP API key (not a client-side `VITE_*` variable).
- `FMP_PUBLIC_DISPLAY_ALLOWED=true`: confirm external provider licensing permits public dashboard display. If absent, the public feed is intentionally unavailable, and historical fixtures remain clearly dated.
- Existing `DATABASE_URL`: required for persisted watch history.
- `FILINGLENS_MONITOR_SYMBOLS=AAPL` (or `AAPL,MSFT,PETR4.SA`; capped at 12).

For the separate hourly **Railway cron service**, configure the same `FMP_API_KEY`, `DATABASE_URL`, and `FILINGLENS_MONITOR_SYMBOLS`, but NOT the public display flag. Set `cronSchedule="0 * * * *"`, `startCommand="node dist/value-driver-cron.js"`, `restartPolicyType="NEVER"` and use the same GitHub source on main. Cron is a single bounded execution, not an HTTP process or an unbounded `setInterval`.

**Credentials not supplied means provider unavailable, not a simulated live state.** The existing historical Apple fixture is retained for offline reproducibility and displayed as archived data.

## Endpoints

- `GET /api/value-drivers/status`: sanitized provider/monitor configuration flags (no credentials).
- `GET /api/value-drivers/live/AAPL?currency=USD`: quote and annual estimate records, fetched time and vendor observation time, source docs, validation status, and partial failure reasons. 503 when no licensed provider is configured.
- `GET /api/value-drivers/watch/AAPL`: up to 12 persisted snapshots and 30 recorded public-market alerts. The ticker must be present in the configured public watchlist. Browser cookies or private filings are NOT involved.

All input URLs are constructed against the fixed `financialmodelingprep.com` HTTPS host, never a URL supplied by a user. The FMP key is not exposed in returned sources. Wrong ticker/currency, nonfinite values, old/future quotes, inaccessible subscription tiers and malformed JSON are rejected. Polling failures do not overwrite the last known timestamp.

## Material watch triggers

Two server-side monitoring triggers, compared to the latest persisted observation:
- At least **5%** change in quote price with a **different provider observation timestamp**.
- At least **3%** change in forecast mean revenue for the **same fiscal-year forecast period**.

No alert on initial observation. No alerts on unchanged observations. Ingestion is deduplicated by content fingerprint and persisted MySQL event keys. These are *review signals*, not automatic trading decisions. **Email/push notifications are not implemented**; alerts are surfaced inside the dashboard.

The collector bootstraps two additional tables with `CREATE TABLE IF NOT EXISTS`. If production database permissions prevent this, apply the CREATE statements in `api/value-driver-monitor.ts` through the database migrator before running the cron. Do not grant DDL privileges to a permanently exposed public API.

## Scenario-conditional Monte Carlo

The simulation uses a deterministic seed and 1,000 triangular draws, with manually editable half-widths for seven DCF inputs and a configurable growth–margin Gaussian-copula correlation. Each forecast draw invokes the exact same underlying `runDcf` validation and formula. Invalid perpetuities are rejected (not clamped, not valued as zero). Invalid sampling space produces an explicit unavailable state.

The output includes enterprise-value and equity-value P10/P50/P90, a histogram, a conditional fraction of simulated values below the market-observed EV when the market quote is comparable, and driver sensitivity ranges. It **does not** estimate objective real-world probabilities, calibrate cross-driver joint distributions, claim a risk-neutral probability, or quantify tail/regulatory hazard frequencies.

Driver risk scores are average absolute model-impact magnitudes for symmetric user-defined shock ranges: not empirical expected loss or trading alpha.

## Validation

```sh
npm ci
npm run check
npm run lint
npm test
npm run build
```

CI unit tests cover provider schema/host/currency/staleness/caching boundaries, ticker validation, empirical vs assumption labeling, deterministic Monte Carlo distribution/accounting, missing market value, watchlist normalization and monitoring dedup logic.

Live production readiness requires two independent validations:
1. **Code and Railway build success** with the route and cron artifact.
2. **Authenticated FMP end-to-end response** after valid licensed `FMP_API_KEY` is provisioned, and actual hourly cron execution writing MySQL snapshots. This step cannot pass without provider credentials. Do not claim end-to-end external-data validation from mocked unit tests.

Publicly publishing FMP data may require a commercial redistribution license; review the provider terms before setting `FMP_PUBLIC_DISPLAY_ALLOWED=true`.
