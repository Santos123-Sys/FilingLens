from __future__ import annotations

import asyncio
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from ..models import Metric, RegulatorySnapshot, SourceRef

SEC_BASE = "https://data.sec.gov"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_USER_AGENT = os.getenv(
    "SEC_USER_AGENT",
    "FilingLens/1.0 filinglens-contact@users.noreply.github.com",
)
CACHE_TTL_SECONDS = 6 * 60 * 60

FACT_MAP: dict[str, list[str]] = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    "grossProfit": ["GrossProfit"],
    "ebit": ["OperatingIncomeLoss"],
    "netIncome": ["NetIncomeLoss", "ProfitLoss"],
    "totalAssets": ["Assets"],
    "totalLiabilities": ["Liabilities"],
    "totalEquity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "operatingCashFlow": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment"],
    "shortTermDebt": ["LongTermDebtCurrent", "ShortTermBorrowings", "ShortTermDebtCurrent"],
    "longTermDebt": ["LongTermDebtNoncurrent"],
}
DURATION_KEYS = {"revenue", "grossProfit", "ebit", "netIncome", "operatingCashFlow", "capex"}
ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = asyncio.Lock()


def normalize_cik(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if not digits:
        raise ValueError("missing_cik")
    return digits.zfill(10)[-10:]


def _normalized_name(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


async def _cached_json(url: str, *, timeout_seconds: float = 25.0) -> dict[str, Any]:
    now = time.monotonic()
    async with _cache_lock:
        cached = _cache.get(url)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
    headers = {
        "User-Agent": SEC_USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(
        headers=headers,
        timeout=httpx.Timeout(timeout_seconds, connect=10.0),
        follow_redirects=True,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
    async with _cache_lock:
        _cache[url] = (time.monotonic(), payload)
    return payload


async def resolve_sec_identifier(ticker: str | None = None, company_name: str | None = None) -> str | None:
    payload = await _cached_json(SEC_TICKERS_URL)
    rows = list(payload.values()) if isinstance(payload, dict) else []
    ticker_key = (ticker or "").strip().upper()
    if ticker_key:
        for row in rows:
            if str(row.get("ticker") or "").upper() == ticker_key:
                return normalize_cik(str(row.get("cik_str") or ""))
    name_key = _normalized_name(company_name)
    if not name_key:
        return None
    exact = [row for row in rows if _normalized_name(str(row.get("title") or "")) == name_key]
    if len(exact) == 1:
        return normalize_cik(str(exact[0].get("cik_str") or ""))
    candidates = [
        row for row in rows
        if len(name_key) >= 6 and (
            name_key in _normalized_name(str(row.get("title") or ""))
            or _normalized_name(str(row.get("title") or "")) in name_key
        )
    ]
    if len(candidates) == 1:
        return normalize_cik(str(candidates[0].get("cik_str") or ""))
    return None


def _duration_days(item: dict[str, Any]) -> int | None:
    start, end = item.get("start"), item.get("end")
    if not start or not end:
        return None
    try:
        return (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
    except (TypeError, ValueError):
        return None


def _fact_entries(companyfacts: dict[str, Any], tags: list[str]) -> list[dict[str, Any]]:
    facts = companyfacts.get("facts", {}).get("us-gaap", {})
    out: list[dict[str, Any]] = []
    for tag in tags:
        concept = facts.get(tag)
        if not concept:
            continue
        for unit_name, entries in (concept.get("units") or {}).items():
            if not str(unit_name).upper().startswith("USD"):
                continue
            for item in entries or []:
                if item.get("val") is None:
                    continue
                out.append({**item, "_tag": tag, "_unit": unit_name})
    return out


def _annual_facts(
    companyfacts: dict[str, Any],
    tags: list[str],
    *,
    duration_metric: bool,
    history_years: int,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for item in _fact_entries(companyfacts, tags):
        if item.get("form") not in ANNUAL_FORMS:
            continue
        if item.get("fp") not in (None, "FY"):
            continue
        end = item.get("end")
        if not end:
            continue
        duration = _duration_days(item)
        if duration_metric:
            if duration is None or duration < 250 or duration > 450:
                continue
        elif item.get("start"):
            continue
        try:
            fiscal_year = int(str(end)[:4])
            value = float(item.get("val"))
        except (TypeError, ValueError):
            continue
        candidates.append({**item, "_fiscal_year": fiscal_year, "_value": value})

    # Later filings may repeat comparative facts. The most recently filed version
    # wins for the same period, while the period itself remains the fact's end year.
    by_period: dict[str, dict[str, Any]] = {}
    for item in candidates:
        period_key = str(item.get("end"))
        previous = by_period.get(period_key)
        if previous is None or (item.get("filed") or "") >= (previous.get("filed") or ""):
            by_period[period_key] = item
    ordered = sorted(by_period.values(), key=lambda item: str(item.get("end") or ""))
    return ordered[-history_years:]


def _latest_filing_fact(
    companyfacts: dict[str, Any],
    tags: list[str],
    forms: set[str],
    *,
    duration_metric: bool,
) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for item in _fact_entries(companyfacts, tags):
        if item.get("form") not in forms:
            continue
        duration = _duration_days(item)
        if duration_metric and duration is not None and duration < 60:
            continue
        candidates.append(item)
    if not candidates:
        return None
    candidates.sort(key=lambda x: (x.get("filed") or "", x.get("end") or "", x.get("start") or ""))
    return candidates[-1]


def _metric_from_fact(
    key: str,
    item: dict[str, Any],
    source_url: str,
    retrieved: str,
    statement_type: str,
) -> Metric:
    period = str(item.get("end") or "")
    fiscal_year = int(period[:4]) if period[:4].isdigit() else None
    source = SourceRef(
        provider="sec_edgar",
        url=source_url,
        retrievedAt=retrieved,
        form=item.get("form"),
        period=period or None,
    )
    return Metric(
        key=key,
        value=float(item.get("_value", item.get("val"))),
        unit=str(item.get("_unit") or "USD"),
        period=f"FY{fiscal_year}" if statement_type == "annual" and fiscal_year else period,
        fiscalYear=fiscal_year,
        statementType=statement_type,  # type: ignore[arg-type]
        status="single_source",
        source=source,
        rawLabel=item.get("_tag"),
    )


async def enrich_sec(cik: str, filing_type: str | None = None, history_years: int = 5) -> RegulatorySnapshot:
    cik10 = normalize_cik(cik)
    companyfacts_url = f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik10}.json"
    submissions_url = f"{SEC_BASE}/submissions/CIK{cik10}.json"
    companyfacts, submissions = await asyncio.gather(
        _cached_json(companyfacts_url),
        _cached_json(submissions_url),
    )
    retrieved = datetime.now(timezone.utc).isoformat()
    metrics: list[Metric] = []

    # Always retrieve the latest five annual periods, irrespective of whether the
    # uploaded filing is a 10-Q. This is the external-history lane used by the UI.
    for key, tags in FACT_MAP.items():
        annual = _annual_facts(
            companyfacts,
            tags,
            duration_metric=key in DURATION_KEYS,
            history_years=history_years,
        )
        metrics.extend(
            _metric_from_fact(key, item, companyfacts_url, retrieved, "annual")
            for item in annual
        )

    # Preserve a current-period structured cross-check for interim filings without
    # mixing it into the five-year annual series.
    filing_upper = (filing_type or "").upper()
    current_forms: set[str] | None = None
    statement_type = "instant"
    if filing_upper.startswith("10-Q"):
        current_forms = {"10-Q", "10-Q/A"}
        statement_type = "interim"
    elif filing_upper.startswith("6-K"):
        current_forms = {"6-K"}
        statement_type = "interim"
    if current_forms:
        for key, tags in FACT_MAP.items():
            item = _latest_filing_fact(
                companyfacts,
                tags,
                current_forms,
                duration_metric=key in DURATION_KEYS,
            )
            if item:
                metrics.append(_metric_from_fact(key, item, companyfacts_url, retrieved, statement_type))

    # Derive total debt independently for each annual period.
    annual_by_key_year: dict[tuple[str, int], Metric] = {
        (metric.key, metric.fiscalYear): metric
        for metric in metrics
        if metric.statementType == "annual" and metric.fiscalYear is not None
    }
    years = sorted({year for _, year in annual_by_key_year})
    for year in years:
        short = annual_by_key_year.get(("shortTermDebt", year))
        long = annual_by_key_year.get(("longTermDebt", year))
        if not short and not long:
            continue
        template = short or long
        assert template is not None
        metrics.append(Metric(
            key="totalDebt",
            value=(short.value if short and short.value is not None else 0.0)
                + (long.value if long and long.value is not None else 0.0),
            unit=template.unit,
            period=f"FY{year}",
            fiscalYear=year,
            statementType="annual",
            status="single_source",
            source=template.source,
            rawLabel="shortTermDebt + longTermDebt",
        ))

    coverage_years = [
        f"FY{year}" for year in sorted({
            metric.fiscalYear for metric in metrics
            if metric.statementType == "annual" and metric.fiscalYear is not None
        })[-history_years:]
    ]
    company = {
        "name": submissions.get("name") or companyfacts.get("entityName") or "",
        "cik": cik10,
        "tickers": submissions.get("tickers") or [],
        "exchanges": submissions.get("exchanges") or [],
        "sic": submissions.get("sic"),
        "sicDescription": submissions.get("sicDescription"),
        "fiscalYearEnd": submissions.get("fiscalYearEnd"),
    }
    sources = [
        SourceRef(provider="sec_edgar", url=companyfacts_url, retrievedAt=retrieved, form=filing_type),
        SourceRef(provider="sec_edgar", url=submissions_url, retrievedAt=retrieved, form=filing_type),
    ]
    warnings: list[str] = []
    if len(coverage_years) < history_years:
        warnings.append(
            f"SEC CompanyFacts supplied {len(coverage_years)} of {history_years} requested annual periods."
        )
    return RegulatorySnapshot(
        status="complete" if metrics and len(coverage_years) >= min(3, history_years) else "partial",
        jurisdiction="us",
        provider="sec_edgar",
        company=company,
        metrics=metrics,
        sources=sources,
        warnings=warnings,
        raw={
            "factsNamespace": "us-gaap",
            "recentForms": (submissions.get("filings", {}).get("recent", {}).get("form") or [])[:20],
            "annualHistoryPolicy": "latest_distinct_annual_fact_periods",
        },
        coverageYears=coverage_years,
        historyRequested=history_years,
        resolvedIdentifier=cik10,
    )
