# Scheduled SEC EDGAR acquisition

FilingLens now applies the folder convention from the MIT-licensed
`jadchaar/sec-edgar-downloader` without moving SEC network access into Railway.
The exact package version is pinned in GitHub Actions. A bounded watchlist is
processed serially every weekday and can also be run manually.

```text
GitHub Actions (scheduled or manual)
  ├─ sec-edgar-downloader 5.1.0
  │    └─ sec-edgar-filings/{TICKER}/{FORM}/{ACCESSION}/
  ├─ FilingLens CompanyFacts acquisition
  │    └─ sec-edgar-filings/{TICKER}/COMPANYFACTS/CIK{CIK}/
  └─ signed GitHub OIDC ──> Railway importer ──> private MySQL cache
```

The initial watchlist is `AAPL` and `MSFT`, limited to Forms 10-K, 10-Q and 8-K,
a ten-day lookback, and at most two filings per form. Edit
`config/sec-edgar-watchlist.json` through normal review to change that scope.
The parser rejects more than 12 issuers, unsupported forms, more than five
filings per form, or lookbacks over 31 days.

The workflow runs at `04:17 UTC` Monday through Friday. It loads the genuine SEC
contact from the dedicated Railway importer using a short-lived GitHub OIDC JWT,
then uses the downloader's declared User-Agent and built-in SEC rate limiter.
HTTP denial remains terminal: there is no proxy, IP rotation or retry bypass.

Downloaded public-source files and their SHA-256 manifest are retained only as a
three-day workflow artifact. They are never committed to the repository. The
CompanyFacts bytes are separately verified and imported into the existing
`sec_companyfacts_snapshots` Railway MySQL table with database read-back.

The Railway intake accepts tokens only from either the existing manual workflow
or `.github/workflows/sec-scheduled-acquisition.yml` on `main`. Scheduled tokens
cannot impersonate a pull request or another repository, branch, workflow or
audience.
