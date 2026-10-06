from __future__ import annotations
import asyncio
import os
from datetime import datetime, timezone
from typing import Any
import httpx
from ..models import Metric, RegulatorySnapshot, SourceRef

SEC_BASE = "https://data.sec.gov"
SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "FilingLens/1.0 (Santos123-Sys; https://github.com/Santos123-Sys/FilingLens)")

FACT_MAP: dict[str, list[str]] = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    "netIncome": ["NetIncomeLoss", "ProfitLoss"],
    "totalAssets": ["Assets"],
    "totalLiabilities": ["Liabilities"],
    "totalEquity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "operatingCashFlow": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment"],
    "shortTermDebt": ["ShortTermBorrowings", "LongTermDebtCurrent"],
    "longTermDebt": ["LongTermDebtNoncurrent", "LongTermDebt"],
}


def normalize_cik(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if not digits:
        raise ValueError("missing_cik")
    return digits.zfill(10)[-10:]


def _latest_fact(companyfacts: dict[str, Any], tags: list[str], forms: set[str]) -> tuple[float | None, str | None, str | None, str | None, str | None]:
    facts = companyfacts.get("facts", {}).get("us-gaap", {})
    candidates: list[dict[str, Any]] = []
    for tag in tags:
        concept = facts.get(tag)
        if not concept:
            continue
        for unit_name, entries in (concept.get("units") or {}).items():
            for item in entries or []:
                if item.get("form") not in forms or item.get("val") is None:
                    continue
                candidates.append({**item, "_tag": tag, "_unit": unit_name})
    if not candidates:
        return None, None, None, None, None
    candidates.sort(key=lambda x: (x.get("filed") or "", x.get("end") or ""))
    chosen = candidates[-1]
    try:
        value = float(chosen.get("val"))
    except (TypeError, ValueError):
        value = None
    return value, chosen.get("_unit"), chosen.get("end"), chosen.get("form"), chosen.get("_tag")


async def enrich_sec(cik: str, filing_type: str | None = None) -> RegulatorySnapshot:
    cik10 = normalize_cik(cik)
    headers = {"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate", "Accept": "application/json"}
    companyfacts_url = f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik10}.json"
    submissions_url = f"{SEC_BASE}/submissions/CIK{cik10}.json"
    timeout = httpx.Timeout(25.0, connect=10.0)
    async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=True) as client:
        facts_response, submissions_response = await asyncio.gather(client.get(companyfacts_url), client.get(submissions_url))
    facts_response.raise_for_status()
    submissions_response.raise_for_status()
    companyfacts = facts_response.json()
    submissions = submissions_response.json()
    forms = {"10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "8-K"}
    if filing_type and filing_type.upper().startswith("10-Q"):
        forms = {"10-Q", "10-Q/A"}
    elif filing_type and filing_type.upper().startswith("10-K"):
        forms = {"10-K", "10-K/A"}
    elif filing_type and filing_type.upper().startswith("20-F"):
        forms = {"20-F", "20-F/A"}

    retrieved = datetime.now(timezone.utc).isoformat()
    metrics: list[Metric] = []
    sources: list[SourceRef] = []
    for key, tags in FACT_MAP.items():
        value, unit, period, form, tag = _latest_fact(companyfacts, tags, forms)
        if value is None:
            continue
        src = SourceRef(provider="sec_edgar", url=companyfacts_url, retrievedAt=retrieved, form=form, period=period)
        metrics.append(Metric(key=key, value=value, unit=unit, period=period, status="single_source", source=src, rawLabel=tag))
    by_key = {m.key: m for m in metrics}
    if by_key.get("shortTermDebt") and by_key.get("longTermDebt"):
        short = by_key["shortTermDebt"]
        long = by_key["longTermDebt"]
        metrics.append(Metric(
            key="totalDebt",
            value=(short.value or 0) + (long.value or 0),
            unit=short.unit or long.unit,
            period=short.period or long.period,
            status="single_source",
            source=short.source,
            rawLabel="shortTermDebt + longTermDebt",
        ))
    sources.append(SourceRef(provider="sec_edgar", url=companyfacts_url, retrievedAt=retrieved, form=filing_type))
    sources.append(SourceRef(provider="sec_edgar", url=submissions_url, retrievedAt=retrieved, form=filing_type))
    company = {
        "name": submissions.get("name") or companyfacts.get("entityName") or "",
        "cik": cik10,
        "tickers": submissions.get("tickers") or [],
        "exchanges": submissions.get("exchanges") or [],
        "sic": submissions.get("sic"),
        "sicDescription": submissions.get("sicDescription"),
        "fiscalYearEnd": submissions.get("fiscalYearEnd"),
    }
    return RegulatorySnapshot(
        status="complete" if metrics else "partial",
        jurisdiction="us",
        provider="sec_edgar",
        company=company,
        metrics=metrics,
        sources=sources,
        warnings=[] if metrics else ["SEC CompanyFacts returned no mapped metrics for the selected filing family."],
        raw={"factsNamespace": "us-gaap", "recentForms": (submissions.get("filings", {}).get("recent", {}).get("form") or [])[:20]},
    )
