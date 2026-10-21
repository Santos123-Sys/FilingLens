from __future__ import annotations

import asyncio
import io
import math
import re
import time
import unicodedata
import zipfile
from datetime import datetime, timezone
from typing import Any

import httpx
import pandas as pd

from ..models import Metric, RegulatorySnapshot, SourceRef
from .http_retry import get_with_retry, retryable_status

CVM_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC"
CVM_REGISTRY_URL = "https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv"
CACHE_TTL_SECONDS = 6 * 60 * 60

_cache: dict[str, tuple[float, bytes]] = {}
_cache_lock = asyncio.Lock()


def normalize_cnpj(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def year_from_period(period: str | None) -> int:
    if period:
        match = re.search(r"(20\d{2})", period)
        if match:
            return int(match.group(1))
    return datetime.now(timezone.utc).year


def _normalize_text(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


async def _cached_bytes(url: str, timeout_seconds: float = 35.0) -> bytes:
    now = time.monotonic()
    async with _cache_lock:
        cached = _cache.get(url)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
    stale_raw = cached[1] if cached else None
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
            follow_redirects=True,
            headers={"User-Agent": "FilingLens/1.0"},
        ) as client:
            response = await get_with_retry(client, url)
            raw = response.content
    except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as exc:
        status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        if stale_raw is not None and (status is None or retryable_status(status)):
            return stale_raw
        raise
    async with _cache_lock:
        _cache[url] = (time.monotonic(), raw)
    return raw


async def resolve_cvm_identifier(company_name: str | None = None) -> str | None:
    key = _normalize_text(company_name)
    if not key:
        return None
    raw = await _cached_bytes(CVM_REGISTRY_URL)
    registry = pd.read_csv(io.BytesIO(raw), sep=";", encoding="latin1", low_memory=False)
    active = registry
    if "SIT" in active.columns:
        active = active.loc[active["SIT"].astype(str).map(_normalize_text).eq("ativo")]
    names: list[tuple[int, str]] = []
    for idx, row in active.iterrows():
        legal = _normalize_text(str(row.get("DENOM_SOCIAL") or ""))
        trade = _normalize_text(str(row.get("DENOM_COMERC") or ""))
        if key == legal or key == trade:
            cnpj = normalize_cnpj(str(row.get("CNPJ_CIA") or ""))
            return cnpj if len(cnpj) == 14 else None
        if len(key) >= 6 and (key in legal or legal in key or key in trade or (trade and trade in key)):
            names.append((idx, str(row.get("CNPJ_CIA") or "")))
    unique = {normalize_cnpj(cnpj) for _, cnpj in names if len(normalize_cnpj(cnpj)) == 14}
    return next(iter(unique)) if len(unique) == 1 else None


def _read_csv_from_zip(raw: bytes, match_tokens: tuple[str, ...]) -> pd.DataFrame | None:
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        candidates = [n for n in names if all(token.lower() in n.lower() for token in match_tokens)]
        if not candidates:
            return None
        candidates.sort(key=lambda n: ("_con_" not in n.lower(), len(n)))
        with archive.open(candidates[0]) as fh:
            return pd.read_csv(fh, sep=";", encoding="latin1", low_memory=False)


def _filter_company(df: pd.DataFrame | None, cnpj: str) -> pd.DataFrame:
    if df is None or df.empty or "CNPJ_CIA" not in df.columns:
        return pd.DataFrame()
    normalized = df["CNPJ_CIA"].astype(str).str.replace(r"\D", "", regex=True)
    out = df.loc[normalized == cnpj].copy()
    if out.empty:
        return out
    if "VERSAO" in out.columns:
        max_version = pd.to_numeric(out["VERSAO"], errors="coerce").max()
        if pd.notna(max_version):
            out = out.loc[pd.to_numeric(out["VERSAO"], errors="coerce") == max_version]
    if "ORDEM_EXERC" in out.columns:
        # A substring match also accepts PENÚLTIMO and can select the prior
        # year's comparative value as the current year when row order changes.
        out = out.loc[out["ORDEM_EXERC"].astype(str).map(_normalize_text).eq("ultimo")]
    return out


def _scale_multiplier(value: Any) -> float:
    normalized = _normalize_text(str(value or ""))
    if "bilhao" in normalized or "bilhoes" in normalized:
        return 1_000_000_000.0
    if "milhao" in normalized or "milhoes" in normalized:
        return 1_000_000.0
    if normalized == "mil" or "milhar" in normalized or "milhares" in normalized:
        return 1_000.0
    return 1.0


def _pick_account(
    df: pd.DataFrame,
    codes: list[str],
    label_contains: list[str] | None = None,
) -> tuple[float | None, str | None, str | None, str | None]:
    if df.empty:
        return None, None, None, None
    work = df
    if "CD_CONTA" in work.columns:
        exact = work.loc[work["CD_CONTA"].astype(str).isin(codes)]
        if not exact.empty:
            work = exact
        elif label_contains and "DS_CONTA" in work.columns:
            pattern = "|".join(re.escape(x) for x in label_contains)
            work = work.loc[work["DS_CONTA"].astype(str).str.contains(pattern, case=False, regex=True, na=False)]
        else:
            return None, None, None, None
    if work.empty or "VL_CONTA" not in work.columns:
        return None, None, None, None
    row = work.iloc[-1]
    value = pd.to_numeric(pd.Series([row.get("VL_CONTA")]), errors="coerce").iloc[0]
    if pd.isna(value):
        return None, None, None, None
    scale = _scale_multiplier(row.get("ESCALA_MOEDA"))
    return (
        float(value) * scale,
        str(row.get("CD_CONTA") or ""),
        str(row.get("DS_CONTA") or ""),
        str(row.get("DT_REFER") or row.get("DT_FIM_EXERC") or ""),
    )


def _statement_frames(raw: bytes, cnpj: str) -> dict[str, pd.DataFrame]:
    dfc = _filter_company(_read_csv_from_zip(raw, ("DFC_MI",)), cnpj)
    if dfc.empty:
        dfc = _filter_company(_read_csv_from_zip(raw, ("DFC_MD",)), cnpj)
    return {
        "DRE": _filter_company(_read_csv_from_zip(raw, ("DRE",)), cnpj),
        "BPA": _filter_company(_read_csv_from_zip(raw, ("BPA",)), cnpj),
        "BPP": _filter_company(_read_csv_from_zip(raw, ("BPP",)), cnpj),
        "DFC": dfc,
    }


def _extract_year_metrics(
    frames: dict[str, pd.DataFrame],
    year: int,
    source: SourceRef,
) -> list[Metric]:
    dre, bpa, bpp, dfc = frames["DRE"], frames["BPA"], frames["BPP"], frames["DFC"]
    spec = [
        ("revenue", dre, ["3.01"], ["Receita"]),
        ("grossProfit", dre, ["3.03"], ["Resultado Bruto", "Lucro Bruto"]),
        ("ebit", dre, ["3.05"], ["Resultado Antes do Resultado Financeiro", "Resultado Operacional"]),
        ("netIncome", dre, ["3.11"], ["Lucro", "Prejuízo", "Resultado Líquido"]),
        ("totalAssets", bpa, ["1"], ["Ativo Total"]),
        ("cash", bpa, ["1.01.01"], ["Caixa", "Equivalentes de Caixa"]),
        ("totalEquity", bpp, ["2.03"], ["Patrimônio Líquido"]),
        ("currentLiabilities", bpp, ["2.01"], ["Passivo Circulante"]),
        ("nonCurrentLiabilities", bpp, ["2.02"], ["Passivo Não Circulante"]),
        ("shortTermDebt", bpp, ["2.01.04"], ["Empréstimos", "Financiamentos"]),
        ("longTermDebt", bpp, ["2.02.01"], ["Empréstimos", "Financiamentos"]),
        ("operatingCashFlow", dfc, ["6.01"], ["Atividades Operacionais"]),
    ]
    metrics: list[Metric] = []
    for key, frame, codes, labels in spec:
        value, code, label, period = _pick_account(frame, codes, labels)
        if value is None:
            continue
        metrics.append(Metric(
            key=key,
            value=value,
            unit="BRL",
            period=f"FY{year}",
            fiscalYear=year,
            statementType="annual",
            status="single_source",
            source=source,
            rawLabel=label,
            rawCode=code,
        ))

    by_key = {metric.key: metric for metric in metrics}
    current_liabilities = by_key.get("currentLiabilities")
    noncurrent_liabilities = by_key.get("nonCurrentLiabilities")
    if current_liabilities and noncurrent_liabilities:
        template = current_liabilities or noncurrent_liabilities
        assert template is not None
        metrics.append(Metric(
            key="totalLiabilities",
            value=(current_liabilities.value if current_liabilities and current_liabilities.value is not None else 0.0)
                + (noncurrent_liabilities.value if noncurrent_liabilities and noncurrent_liabilities.value is not None else 0.0),
            unit="BRL",
            period=f"FY{year}",
            fiscalYear=year,
            statementType="annual",
            status="single_source",
            source=template.source,
            rawLabel="currentLiabilities + nonCurrentLiabilities",
        ))
    short = by_key.get("shortTermDebt")
    long = by_key.get("longTermDebt")
    if short and long:
        template = short or long
        assert template is not None
        metrics.append(Metric(
            key="totalDebt",
            value=(short.value if short and short.value is not None else 0.0)
                + (long.value if long and long.value is not None else 0.0),
            unit="BRL",
            period=f"FY{year}",
            fiscalYear=year,
            statementType="annual",
            status="single_source",
            source=template.source,
            rawLabel="shortTermDebt + longTermDebt",
        ))
    return metrics


async def enrich_cvm(
    cnpj: str,
    reporting_period: str | None,
    filing_type: str | None,
    history_years: int = 5,
) -> RegulatorySnapshot:
    # Reuse the all-issuer archive cache and strict, source-preserving normalizer.
    # No PDF/OCR or label-guessing path may certify financial observations.
    from . import cvm_facts
    identity = cvm_facts.cnpj_id(cnpj)
    requested_year = year_from_period(reporting_period)
    metrics, sources, coverage, warnings = [], [], [], []
    company_name = ""
    for year in range(requested_year, max(2009, requested_year-history_years-3), -1):
        if len(coverage) >= history_years:
            break
        url = cvm_facts.source_url("DFP", year)
        try:
            raw, receipt = await cvm_facts.acquire(url)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                continue
            raise
        reported, issues = await asyncio.to_thread(cvm_facts.parse_archive, raw, "DFP", year, receipt, identity)
        selected, conflicts = cvm_facts.select_facts(reported, "consolidated")
        if not selected:
            if reported:
                warnings.append(f"FY{year}: consolidated scope missing; standalone facts remain available through the account API.")
            continue
        source = SourceRef(provider="cvm_open_data", url=url, retrievedAt=receipt["retrievedAt"], form="DFP", period=f"FY{year}")
        candidates: dict[str, list[dict]] = {}
        for fact in selected:
            if not fact["canonicalMetric"] or fact["currency"] != "BRL" or fact["periodEnd"] != fact["referenceDate"]:
                continue
            if fact["periodKind"] == "duration":
                days = (datetime.fromisoformat(fact["periodEnd"])-datetime.fromisoformat(fact["periodStart"])).days
                if not 250 <= days <= 450:
                    continue
            candidates.setdefault(fact["canonicalMetric"], []).append(fact)
        year_metrics = []
        for key, choices in candidates.items():
            if len(choices) != 1:
                warnings.append(f"FY{year}:{key}:ambiguous_context")
                continue
            fact = choices[0]
            company_name = company_name or fact["issuerName"]
            numeric = float(fact["value"])
            if not math.isfinite(numeric):
                continue
            year_metrics.append(Metric(key=key, value=numeric, unit="BRL", period=fact["periodEnd"],
                fiscalYear=int(fact["periodEnd"][:4]), statementType="annual", status="single_source", source=source,
                rawCode=fact["accountCode"], rawLabel=fact["accountLabel"]))
        by_key = {m.key: m for m in year_metrics}
        for key, operands in (("totalLiabilities", ("currentLiabilities", "nonCurrentLiabilities")),
                              ("totalDebt", ("shortTermDebt", "longTermDebt"))):
            if all(k in by_key for k in operands):
                parts = [by_key[k] for k in operands]
                if len({m.period for m in parts}) == 1:
                    year_metrics.append(Metric(key=key, value=sum(m.value for m in parts), unit="BRL", period=parts[0].period,
                        fiscalYear=parts[0].fiscalYear, statementType="annual", status="single_source", source=source,
                        rawLabel=" + ".join(operands)))
        if year_metrics:
            metrics.extend(year_metrics)
            sources.append(source)
            coverage.append(f"FY{year}")
        warnings.extend(issues[:3]+conflicts[:3])
    if len(coverage) < history_years:
        warnings.append(f"CVM supplied {len(coverage)} of {history_years} requested annual periods; missing values remain missing.")
    warnings.append("Annual consolidated facts only. ITR duration contexts and standalone accounts are available in the CVM account API. Price/corporate-action certification and point-in-time availability are separate.")
    return RegulatorySnapshot(status="complete" if len(coverage) == history_years else "partial", jurisdiction="br",
        provider="cvm_open_data", company={"name":company_name,"cnpj":identity,"document":"DFP","requestedFilingType":filing_type},
        metrics=metrics, sources=sources, warnings=warnings, coverageYears=sorted(coverage), historyRequested=history_years,
        resolvedIdentifier=identity, raw={"annualHistoryPolicy":"strict_latest_available_dfp", "mappingVersion":cvm_facts.MAPPING_VERSION,
        "pointInTimeSupported":False,"priceCertification":"separate","scope":"consolidated"})
