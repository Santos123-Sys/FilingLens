#!/usr/bin/env python3
"""Personal-use Yahoo Finance observation bridge (ranaroussi/yfinance).

One symbol per bounded invocation; output a single JSON record to stdout.
No API keys, personal holdings, or private filing contents leave FilingLens.
All Yahoo data is best-effort and may be delayed, incomplete, or rate limited.
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime, timezone

SYMBOL = re.compile(r"^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,5})?$")


def finite(value):
    try:
        if value is None or isinstance(value, bool):
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def positive(value):
    number = finite(value)
    return number if number is not None and number > 0 else None


def get_value(mapping, key):
    try:
        return mapping.get(key)
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


def row(frame, key):
    try:
        if frame is None or frame.empty or key not in frame.index:
            return {}
        series = frame.loc[key]
        return {str(k): finite(v) for k, v in series.items()}
    except (AttributeError, KeyError, TypeError, ValueError):
        return {}


def make_forecasts(ticker):
    warnings = []
    # The endpoints can fail independently. Never throw away revenue/EPS simply
    # because Yahoo's optional revisions endpoint is unavailable.
    def optionally(method, label):
        try:
            return method()
        except Exception:
            warnings.append(label + "_unavailable")
            return None

    revenue = optionally(ticker.get_revenue_estimate, "revenue_estimates")
    eps = optionally(ticker.get_earnings_estimate, "eps_estimates")
    trends = optionally(ticker.get_eps_trend, "eps_trends")
    revisions = optionally(ticker.get_eps_revisions, "eps_revisions")

    if revenue is None and eps is None:
        return [], warnings + ["analyst_estimates_unavailable"], "consensus_unavailable"

    # Yahoo returns relative fiscal buckets (0y / +1y), not dated consensus
    # revisions. We need a known fiscal base to avoid inventing fiscal dates.
    last_year = None
    try:
        annual = ticker.get_income_stmt(freq="yearly")
        if annual is not None and not annual.empty:
            last_year = max(int(x.year) for x in annual.columns)
    except Exception:
        warnings.append("fiscal_anchor_unavailable")
    estimates = []
    for bucket, offset in (("0y", 1), ("+1y", 2)):
        rev = row(revenue, bucket)
        earn = row(eps, bucket)
        trend = row(trends, bucket)
        revision = row(revisions, bucket)
        if not rev and not earn:
            continue
        estimates.append({
            "periodEnd": "FY" + str(last_year + offset) if last_year else bucket,
            "periodBasis": "fiscal_year_inferred_from_last_reported_year" if last_year else "relative_yahoo_bucket",
            "yahooBucket": bucket,
            "revenueAvg": get_value(rev, "avg"),
            "revenueLow": get_value(rev, "low"),
            "revenueHigh": get_value(rev, "high"),
            "epsAvg": get_value(earn, "avg"),
            "epsLow": get_value(earn, "low"),
            "epsHigh": get_value(earn, "high"),
            "numAnalystsRevenue": get_value(rev, "numberOfAnalysts"),
            "numAnalystsEps": get_value(earn, "numberOfAnalysts"),
            "epsTrend30dAgo": get_value(trend, "30daysAgo"),
            "epsRevisionsUp30d": get_value(revision, "upLast30days"),
            "epsRevisionsDown30d": get_value(revision, "downLast30days"),
        })
    if not estimates:
        return [], warnings, "no_covered_estimates"
    warnings.append("forward_ebit_not_available_from_yahoo")
    if not last_year:
        warnings.append("relative_fiscal_labels_are_not_comparable_across_rollovers")
    return estimates, warnings, None


def make_quote(ticker):
    try:
        # One daily price bar: does not imply a real-time executable quote.
        bars = ticker.history(period="10d", interval="1d", auto_adjust=False)
        fast = ticker.get_fast_info()
        if bars is None or bars.empty:
            return None, "quote_unavailable"
        last = bars.iloc[-1]
        price = positive(last.get("Close"))
        cap = positive(get_value(fast, "market_cap"))
        currency = get_value(fast, "currency")
        if not price or not cap or not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency.upper()):
            return None, "quote_fields_incomplete"
        # yfinance daily OHLC index is the trading *date*, NOT a trade timestamp.
        day = bars.index[-1].date().isoformat()
        return {
            "price": price,
            "marketCap": cap,
            "currency": currency.upper(),
            "tradingDate": day,
            "priceBasis": "unadjusted_daily_close",
            "observedAt": day + "T00:00:00.000Z",
        }, None
    except Exception:
        return None, "quote_unavailable"


def collect(symbol, ticker_factory=None):
    if not SYMBOL.fullmatch(symbol):
        return {"error": "invalid_symbol"}
    if ticker_factory is None:
        import yfinance as yf
        ticker_factory = yf.Ticker
    ticker = ticker_factory(symbol)
    quote, quote_error = make_quote(ticker)
    forecasts, warnings, forecast_error = make_forecasts(ticker)
    return {
        "symbol": symbol,
        "provider": "yahoo_finance_unofficial",
        "retrievedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "quote": quote,
        "consensus": forecasts,
        "quoteError": quote_error,
        "consensusError": forecast_error,
        "warnings": warnings,
    }


def main():
    symbol = sys.argv[1] if len(sys.argv) == 2 else ""
    if not SYMBOL.fullmatch(symbol):
        print(json.dumps({"error": "invalid_symbol"}))
        return 2
    try:
        print(json.dumps(collect(symbol), allow_nan=False, separators=(",", ":")))
        return 0
    except Exception:
        # Never emit raw Yahoo response bodies or internal tracebacks.
        print(json.dumps({"error": "provider_unavailable"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
