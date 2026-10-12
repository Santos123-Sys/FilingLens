# Value Driver Intelligence — Yahoo Finance personal research integration

## Overview
The former FMP quote/analyst estimates provider has been replaced with [ranaroussi/yfinance](https://github.com/ranaroussi/yfinance) (Apache-2.0). **This is an unofficial Yahoo Finance adapter intended exclusively for private, personal research.** Yahoo is not affiliated with the library and data access is subject to Yahoo's own terms. It is not a commercially licensed, reliable or real-time production market-data feed.

```
Authenticated personal browser (token kept only in React memory)
      | Authorization: Bearer <private valuation token>
      v
FilingLens Hono /api/value-drivers/live/:ticker
      | require YAHOO_PERSONAL_USE_ENABLED and >=32-byte secret
      | rate mitigation: 20-minute per-symbol cache and request deduplication
      v
Node execFile('python', ['scripts/yfinance_bridge.py', validatedSymbol])
      | bounded 30-second process, no shell, 180 kB output bound
      | Python package: yfinance 1.7.0 (pinned, isolated venv)
      v
Yahoo Finance best-effort public-data retrieval
      | unadjusted last DAILY CLOSE, market cap, currency
      | annual current/next FY revenue estimates, EPS estimates,
      | optional EPS 30-day trend and revision counts
      v
Finite-value checks, timestamp/fiscal-bucket validation, provenance
      | missing EBIT stays NULL, never derived from an unrelated source
      v
Valuation UI (risk Monte Carlo unaffected)
      +
Daily Railway cron 23:00 UTC on weekdays (up to 12 watched symbols)
      | MySQL value_driver_market_snapshots, value_driver_watch_signals
      v
Authenticated personal watch history, no push/email notifications
```

## Railway setup

The Railway FilingLens web service must have:
- `YAHOO_PERSONAL_USE_ENABLED=true`: explicit confirmation the product is operated **only for personal research**.
- `FILINGLENS_VALUATION_READ_API_TOKEN`: an existing random secret of at least 32 characters, already used for other private valuation integrations. It **must not** be configured in a browser bundle or shared publicly.
- `DATABASE_URL`: existing MySQL history store for optional watch history.
- `FILINGLENS_MONITOR_SYMBOLS=AAPL` or a comma-separated allowlist, up to 12 symbols, e.g. `AAPL,MSFT,PETR4.SA`.

In the Value Driver Intelligence UI, enter the private valuation token into the password field. It remains in memory only, is not stored to sessionStorage/localStorage, and is never appended to URLs. Re-enter it after reloading the page. An unauthenticated GET /api/value-drivers/status returns only sanitized configuration flags, not the watchlist.

The dedicated Railway monitor service needs:
- `YAHOO_PERSONAL_USE_ENABLED=true`, `DATABASE_URL`, and `FILINGLENS_MONITOR_SYMBOLS=AAPL`.
- GitHub repository `Santos123-Sys/FilingLens`, main branch.
- `cronSchedule="0 23 * * 1-5"` (UTC, after ordinary US/B3 regular trading hours); `startCommand="node dist/value-driver-cron.js"`; `restartPolicyType="NEVER"`.
- No private access token or FMP API key; the cron process does not expose HTTP routes.

The Dockerfile installs the isolated pinned yfinance package into `/opt/yfinance-venv` and sets `PYTHON_EXECUTABLE`. CI runs Python bridge tests without outbound requests, TypeScript tests, typecheck, and bundle build.

## Data contract: known limitations

1. **Price** is the last unadjusted DAILY closing price, not an executable intraday quote, not dividend adjusted, and not suitable for intraday P&L. The bar's YYYY-MM-DD is the trading date; the synthetic `T00:00:00Z` field is only a sortable date anchor **not the time of a trade**. Last available observation over 7 days old is marked stale.
2. **Market capitalization** from Yahoo `fast_info.market_cap` may be refreshed on a different schedule from the close. `sharesBn` is only the implied quotient of market cap / daily close. It is not the official outstanding-shares disclosure.
3. **Estimates** use the Yahoo `0y` / `+1y` relative fiscal buckets. Where the latest reported annual income-statement year is available, `FY2026` etc. is inferred from it, **not a verified fiscal-year-end calendar day**. If unavailable the bucket remains `0y` / `+1y`, which is excluded from persistent revenue revision signals to prevent false year-over-year comparisons.
4. **EBIT, EBITDA estimates** are not provided via the standard yfinance estimate methods and are represented as `null`. The historical Apple sample forecasts stay visibly archived and must not be called live consensus.
5. **Revision timing**: the timestamp on the returned consensus is the application's retrieval time, never a provider's actual analyst update time. Optional EPS trend / revision counts are Yahoo's rolling comparison buckets and have no guaranteed individual analyst provenance.
6. **Endpoint availability**: cookie, crumb, throttling, anti-bot or schema changes can cause partial/unavailable responses. Never fabricate a fallthrough provider number. Never retry aggressively when rate-limited.
7. **Provider switch**: FMP historical snapshots are intentionally preserved for auditability but comparison logic refuses cross-provider signals. SHA fingerprints include provider name to avoid deduplication collisions.
8. **Jurisdiction**: Brazilian tickers are normalized with `.SA`; no guarantee Yahoo supports every B3 ticker. Verify USD versus BRL, listing, share class and calendar before using quotes in a valuation.

## Routes and example

```bash
curl -H "Authorization: Bearer $FILINGLENS_VALUATION_READ_API_TOKEN" \
 "https://filinglens-production-158f.up.railway.app/api/value-drivers/live/AAPL?currency=USD"
```

- GET `/api/value-drivers/status` (sanitized, no watchlist).
- GET `/api/value-drivers/live/:ticker` (private).
- GET `/api/value-drivers/watch/:ticker` (private, explicitly monitored symbols only).

The access token is validated with a constant-time comparison; unauthenticated requests return HTTP 401, and unconfigured services return HTTP 503. Same-site/same-origin browser requests only. Input tickers cannot contain URLs, shell punctuation or separators; child_process runs without shell. No private documents or portfolios are sent to Yahoo.

## Monitoring and validation

Material review signals (not investment decisions):
- Quote: >=5% daily close change across different trading dates.
- Forward revenue: >=3% change in the same inferred annual fiscal bucket; disabled for unknown relative fiscal dates.
- No initial baseline comparison and no cross-provider comparisons.
- Check `[value-driver-cron]` logs for `attempted/stored/materialSignals/unavailableSymbols`; each run is bounded and can fail without inventing data.

Local static checks:
```bash
npm ci
npm run check
npm test
python3 -m unittest discover -s tests -p 'test_yfinance_bridge.py' -v
npm run build
```

A successful build/CI does **not** prove Yahoo access from Railway. Validate the authenticated AAPL/PETR4.SA response and one genuine MySQL cron record independently, and distinguish provider/network errors from lack of analyst coverage. Avoid upgrading the sampling cadence without assessing Yahoo's terms and rate limits.
