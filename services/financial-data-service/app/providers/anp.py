from __future__ import annotations

import asyncio
import io
import re
import time
import unicodedata
import zipfile
from collections import defaultdict
from typing import Any

import httpx
import pandas as pd

from ..models import MarketShareMetric, MarketShareSnapshot

ANP_LIQUID_FUELS_PAGE = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp/"
    "paineis-dinamicos-do-abastecimento/painel-dinamico-do-mercado-brasileiro-de-combustiveis-liquidos"
)
ANP_LIQUID_FUELS_DATA = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/mdpg/liquidos.zip"
)
CACHE_TTL_SECONDS = 6 * 60 * 60

_cache: tuple[float, bytes] | None = None
_cache_lock = asyncio.Lock()


def _norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _company_core(value: str) -> str:
    tokens = [
        token for token in _norm(value).split()
        if token not in {"s", "a", "sa", "ltda", "companhia", "cia", "participacoes", "holding"}
    ]
    return " ".join(tokens[:5])


def _pick_column(columns: list[str], *required_tokens: str) -> str | None:
    normalized = {column: _norm(column) for column in columns}
    for column, key in normalized.items():
        if all(token in key for token in required_tokens):
            return column
    return None


def _resolve_columns(columns: list[str]) -> dict[str, str | None]:
    normalized = {column: _norm(column) for column in columns}

    distributor = None
    for column, key in normalized.items():
        if "distrib" in key and any(token in key for token in ("razao", "nome", "agente", "social")):
            distributor = column
            break
    if distributor is None:
        for column, key in normalized.items():
            if key in {"distribuidor", "razao social", "razao social distribuidor", "agente", "nome agente"}:
                distributor = column
                break
    if distributor is None:
        distributor = next((column for column, key in normalized.items() if "razao social" in key or "nome agente" in key), None)

    cnpj = None
    for column, key in normalized.items():
        if "cnpj" in key and ("distrib" in key or distributor is not None):
            cnpj = column
            break

    volume = None
    for column, key in normalized.items():
        if ("volume" in key or "quantidade" in key or key.startswith("vendas")) and "preco" not in key:
            if any(token in key for token in ("venda", "vendido", "comercial", "m3", "litro", "volume", "quantidade")):
                volume = column
                break

    product = next((column for column, key in normalized.items() if "produto" in key), None)
    year = next((column for column, key in normalized.items() if key == "ano" or key.endswith(" ano")), None)
    month = next((column for column, key in normalized.items() if key == "mes" or key.endswith(" mes")), None)
    date = next((column for column, key in normalized.items() if key in {"data", "data referencia", "periodo", "mes ano", "mes ano referencia"}), None)
    uf = next((column for column, key in normalized.items() if key in {"uf", "estado", "uf destino"}), None)

    return {
        "distributor": distributor,
        "cnpj": cnpj,
        "volume": volume,
        "product": product,
        "year": year,
        "month": month,
        "date": date,
        "uf": uf,
    }


def _numeric(series: pd.Series) -> pd.Series:
    raw = series.astype(str).str.strip()
    comma_ratio = raw.str.contains(",", regex=False).mean() if len(raw) else 0
    if comma_ratio > 0.1:
        raw = raw.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    return pd.to_numeric(raw, errors="coerce")


def _read_sample(archive: zipfile.ZipFile, name: str) -> tuple[pd.DataFrame | None, str, str]:
    for encoding in ("utf-8-sig", "latin1"):
        for sep in (";", ","):
            try:
                with archive.open(name) as fh:
                    sample = pd.read_csv(fh, sep=sep, encoding=encoding, nrows=8, low_memory=False)
                if len(sample.columns) > 1:
                    return sample, encoding, sep
            except Exception:
                continue
    return None, "latin1", ";"


def _select_table(raw: bytes) -> tuple[str, str, str, dict[str, str | None]]:
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        candidates: list[tuple[int, str, str, str, dict[str, str | None]]] = []
        for name in archive.namelist():
            if not name.lower().endswith(".csv"):
                continue
            sample, encoding, sep = _read_sample(archive, name)
            if sample is None:
                continue
            columns = _resolve_columns([str(column) for column in sample.columns])
            if not columns["distributor"] or not columns["volume"]:
                continue
            filename = _norm(name)
            score = 10
            score += 4 if "venda" in filename or "comercial" in filename else 0
            score += 3 if "distrib" in filename else 0
            score += 2 if columns["product"] else 0
            score += 2 if columns["year"] or columns["date"] else 0
            score += 1 if columns["month"] or columns["date"] else 0
            # Supplier-delivery tables can also contain distributors. Prefer the
            # distributor commercialization table when both are present.
            score -= 5 if "fornec" in filename or "entrega" in filename else 0
            candidates.append((score, name, encoding, sep, columns))
        if not candidates:
            raise ValueError("anp_distribution_table_not_found")
        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        _, name, encoding, sep, columns = candidates[0]
        return name, encoding, sep, columns


async def _download_dataset() -> bytes:
    global _cache
    now = time.monotonic()
    async with _cache_lock:
        if _cache and now - _cache[0] < CACHE_TTL_SECONDS:
            return _cache[1]

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(80.0, connect=15.0),
        follow_redirects=True,
        headers={"User-Agent": "FilingLens/1.1 public-market-share-research"},
    ) as client:
        response = await client.get(ANP_LIQUID_FUELS_DATA)
        response.raise_for_status()
        raw = response.content

    if not zipfile.is_zipfile(io.BytesIO(raw)):
        raise ValueError("anp_dataset_not_zip")

    async with _cache_lock:
        _cache = (time.monotonic(), raw)
    return raw


def _unit_from_column(column: str) -> str:
    key = _norm(column)
    if "m3" in key or "metro cubico" in key:
        return "m³"
    if "litro" in key:
        return "litres"
    return "reported volume units"


def _period_label(year: int, months: set[int]) -> str:
    valid = sorted(month for month in months if 1 <= month <= 12)
    if valid and max(valid) < 12:
        return f"{year} YTD through M{max(valid):02d}"
    return str(year)


def _name_mask(series: pd.Series, company_name: str) -> pd.Series:
    normalized = series.astype(str).map(_norm)
    core = _company_core(company_name)
    if not core:
        return pd.Series(False, index=series.index)
    direct = normalized.str.contains(re.escape(core), regex=True, na=False)
    if direct.any():
        return direct
    distinctive = [token for token in core.split() if len(token) >= 5]
    if not distinctive:
        return direct
    required = max(1, min(2, len(distinctive)))
    score = sum(normalized.str.contains(re.escape(token), regex=True, na=False).astype(int) for token in distinctive)
    return score >= required


def calculate_market_share_from_zip(
    raw: bytes,
    company_name: str,
    cnpj: str | None = None,
    max_products: int = 4,
) -> MarketShareSnapshot:
    table_name, encoding, sep, columns = _select_table(raw)
    distributor_col = columns["distributor"]
    volume_col = columns["volume"]
    assert distributor_col and volume_col

    usecols = [
        column for column in (
            distributor_col,
            columns["cnpj"],
            volume_col,
            columns["product"],
            columns["year"],
            columns["month"],
            columns["date"],
        ) if column
    ]

    market: dict[tuple[int, str], float] = defaultdict(float)
    issuer: dict[tuple[int, str], float] = defaultdict(float)
    months: dict[int, set[int]] = defaultdict(set)
    matched_names: dict[str, float] = defaultdict(float)
    requested_cnpj = _digits(cnpj)
    requested_root = requested_cnpj[:8] if len(requested_cnpj) >= 8 else ""
    observed_years: set[int] = set()

    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        with archive.open(table_name) as fh:
            chunks = pd.read_csv(
                fh,
                sep=sep,
                encoding=encoding,
                usecols=usecols,
                chunksize=200_000,
                low_memory=False,
            )
            for chunk in chunks:
                values = _numeric(chunk[volume_col])
                valid_volume = values.notna() & (values >= 0)
                if not valid_volume.any():
                    continue
                chunk = chunk.loc[valid_volume].copy()
                chunk["_volume"] = values.loc[valid_volume].astype(float)

                if columns["year"]:
                    years = pd.to_numeric(chunk[columns["year"]], errors="coerce")
                elif columns["date"]:
                    parsed_dates = pd.to_datetime(chunk[columns["date"]], errors="coerce", dayfirst=True)
                    years = parsed_dates.dt.year
                else:
                    years = pd.Series(0, index=chunk.index, dtype=float)
                chunk["_year"] = years.fillna(0).astype(int)
                observed_years.update(int(year) for year in chunk["_year"].unique() if 2000 <= int(year) <= 2100)

                if columns["month"]:
                    month_values = pd.to_numeric(chunk[columns["month"]], errors="coerce")
                elif columns["date"]:
                    parsed_dates = pd.to_datetime(chunk[columns["date"]], errors="coerce", dayfirst=True)
                    month_values = parsed_dates.dt.month
                else:
                    month_values = pd.Series(float("nan"), index=chunk.index)
                for year, month in zip(chunk["_year"], month_values, strict=False):
                    if 2000 <= int(year) <= 2100 and pd.notna(month):
                        months[int(year)].add(int(month))

                if columns["product"]:
                    products = chunk[columns["product"]].astype(str).str.strip().replace("", "All liquid fuels")
                else:
                    products = pd.Series("All liquid fuels", index=chunk.index)
                chunk["_product"] = products
                product_norm = chunk["_product"].map(_norm)
                # Avoid double-counting explicit aggregate rows if the source also
                # includes underlying product rows.
                chunk = chunk.loc[~product_norm.isin({"total", "total geral", "todos os produtos"})]
                if chunk.empty:
                    continue

                if requested_root and columns["cnpj"]:
                    cnpj_root = chunk[columns["cnpj"]].astype(str).map(_digits).str[:8]
                    matched = cnpj_root.eq(requested_root)
                    if not matched.any():
                        matched = _name_mask(chunk[distributor_col], company_name)
                else:
                    matched = _name_mask(chunk[distributor_col], company_name)

                grouped_market = chunk.groupby(["_year", "_product"], dropna=False)["_volume"].sum()
                for (year, product), volume in grouped_market.items():
                    market[(int(year), str(product))] += float(volume)

                if matched.any():
                    matched_chunk = chunk.loc[matched]
                    grouped_issuer = matched_chunk.groupby(["_year", "_product"], dropna=False)["_volume"].sum()
                    for (year, product), volume in grouped_issuer.items():
                        issuer[(int(year), str(product))] += float(volume)
                    for name, volume in matched_chunk.groupby(distributor_col)["_volume"].sum().items():
                        matched_names[str(name)] += float(volume)

    if not issuer:
        return MarketShareSnapshot(
            status="company_not_found",
            provider="ANP SIMP",
            companyName=company_name,
            warnings=[f"No distributor row in the selected ANP commercialization table matched {company_name!r}."],
            sourceUrl=ANP_LIQUID_FUELS_PAGE,
        )

    available_years = sorted(year for year in observed_years if any(key[0] == year for key in market))
    if not available_years:
        return MarketShareSnapshot(
            status="unavailable",
            provider="ANP SIMP",
            companyName=company_name,
            warnings=["ANP dataset did not expose a usable reference year."],
            sourceUrl=ANP_LIQUID_FUELS_PAGE,
        )

    latest_year = available_years[-1]
    period = _period_label(latest_year, months.get(latest_year, set()))
    unit = _unit_from_column(volume_col)
    issuer_products = {
        product: volume for (year, product), volume in issuer.items()
        if year == latest_year and volume > 0
    }
    market_products = {
        product: volume for (year, product), volume in market.items()
        if year == latest_year and volume > 0
    }
    matched_company = max(matched_names.items(), key=lambda item: item[1])[0] if matched_names else company_name
    caveat = (
        "Closest public volume-share proxy based on ANP SIMP distributor commercialization data. "
        "ANP states that volumetric information is declaratory and may be reprocessed; this is a "
        "share of reported distributed volume, not a revenue or retail-sales share."
    )

    metrics: list[MarketShareMetric] = []
    numerator_total = sum(issuer_products.values())
    denominator_total = sum(market_products.values())
    if numerator_total > 0 and denominator_total > 0:
        share = min(100.0, numerator_total / denominator_total * 100)
        metrics.append(MarketShareMetric(
            label="Brazil liquid-fuels distribution volume share proxy",
            valuePercent=round(share, 2),
            numerator=round(numerator_total, 3),
            denominator=round(denominator_total, 3),
            unit=unit,
            period=period,
            geography="Brazil",
            productScope="All detailed liquid-fuel products in the selected ANP distributor commercialization table",
            method="public_proxy",
            provider="ANP SIMP",
            companyMatch=matched_company,
            caveat=caveat,
            sourceUrl=ANP_LIQUID_FUELS_PAGE,
        ))

    for product, numerator in sorted(issuer_products.items(), key=lambda item: item[1], reverse=True)[:max_products]:
        denominator = market_products.get(product, 0.0)
        if numerator <= 0 or denominator <= 0:
            continue
        share = min(100.0, numerator / denominator * 100)
        metrics.append(MarketShareMetric(
            label=f"{product} distribution volume share proxy",
            valuePercent=round(share, 2),
            numerator=round(numerator, 3),
            denominator=round(denominator, 3),
            unit=unit,
            period=period,
            geography="Brazil",
            productScope=product,
            method="public_proxy",
            provider="ANP SIMP",
            companyMatch=matched_company,
            caveat=caveat,
            sourceUrl=ANP_LIQUID_FUELS_PAGE,
        ))

    return MarketShareSnapshot(
        status="complete" if metrics else "partial",
        provider="ANP SIMP",
        companyName=company_name,
        matchedCompany=matched_company,
        period=period,
        metrics=metrics,
        warnings=[] if metrics else ["Company rows were matched, but no positive denominator could be established."],
        sourceUrl=ANP_LIQUID_FUELS_PAGE,
    )


async def enrich_anp_market_share(
    company_name: str,
    cnpj: str | None = None,
    max_products: int = 4,
) -> MarketShareSnapshot:
    raw = await _download_dataset()
    return calculate_market_share_from_zip(raw, company_name, cnpj, max_products)
