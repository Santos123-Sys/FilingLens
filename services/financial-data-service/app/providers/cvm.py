from __future__ import annotations

import asyncio
import io
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
        active_rows = active.loc[active["SIT"].astype(str).str.upper().str.contains("ATIV", na=False)]
        if not active_rows.empty:
            active = active_rows
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
        ultimo = out.loc[out["ORDEM_EXERC"].astype(str).str.upper().str.contains("ÚLTIMO|ULTIMO", regex=True)]
        if not ultimo.empty:
            out = ultimo
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
    if current_liabilities or noncurrent_liabilities:
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
    if short or long:
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
    cnpj_digits = normalize_cnpj(cnpj)
    if len(cnpj_digits) != 14:
        raise ValueError("invalid_cnpj")
    requested_year = year_from_period(reporting_period)
    # The five-year history is deliberately sourced from audited/annual DFP files,
    # even when the uploaded document is an ITR. Try the reporting year first and
    # walk backwards until five complete annual archives are found.
    candidate_years = list(range(requested_year, requested_year - history_years - 3, -1))
    retrieved = datetime.now(timezone.utc).isoformat()
    metrics: list[Metric] = []
    sources: list[SourceRef] = []
    coverage: list[int] = []
    company_name = ""
    attempted: list[int] = []

    for year in candidate_years:
        if len(coverage) >= history_years:
            break
        attempted.append(year)
        url = f"{CVM_BASE}/DFP/DADOS/dfp_cia_aberta_{year}.zip"
        try:
            raw = await _cached_bytes(url)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                continue
            raise
        frames = _statement_frames(raw, cnpj_digits)
        if all(frame.empty for frame in frames.values()):
            continue
        source = SourceRef(
            provider="cvm_open_data",
            url=url,
            retrievedAt=retrieved,
            form="DFP",
            period=f"FY{year}",
        )
        year_metrics = _extract_year_metrics(frames, year, source)
        if not year_metrics:
            continue
        metrics.extend(year_metrics)
        sources.append(source)
        coverage.append(year)
        if not company_name:
            for frame in (frames["DRE"], frames["BPA"], frames["BPP"]):
                if not frame.empty and "DENOM_CIA" in frame.columns:
                    company_name = str(frame.iloc[-1].get("DENOM_CIA") or "")
                    if company_name:
                        break

    coverage.sort()
    coverage_years = [f"FY{year}" for year in coverage]
    warnings: list[str] = []
    if len(coverage) < history_years:
        warnings.append(
            f"CVM Open Data supplied {len(coverage)} of {history_years} requested annual DFP periods."
        )

    return RegulatorySnapshot(
        status="complete" if len(coverage) >= min(3, history_years) else "partial",
        jurisdiction="br",
        provider="cvm_open_data",
        company={
            "name": company_name,
            "cnpj": cnpj_digits,
            "document": "DFP",
            "requestedFilingType": filing_type,
        },
        metrics=metrics,
        sources=sources,
        warnings=warnings,
        raw={
            "annualHistoryPolicy": "latest_available_dfp_years",
            "attemptedYears": attempted,
            "statementRowsByYear": coverage_years,
        },
        coverageYears=coverage_years,
        historyRequested=history_years,
        resolvedIdentifier=cnpj_digits,
    )
