from __future__ import annotations
import io
import re
import zipfile
from datetime import datetime, timezone
from typing import Any
import httpx
import pandas as pd
from ..models import Metric, RegulatorySnapshot, SourceRef

CVM_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC"


def normalize_cnpj(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def year_from_period(period: str | None) -> int:
    if period:
        match = re.search(r"(20\d{2})", period)
        if match:
            return int(match.group(1))
    return datetime.now(timezone.utc).year


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


def _pick_account(df: pd.DataFrame, codes: list[str], label_contains: list[str] | None = None) -> tuple[float | None, str | None, str | None, str | None]:
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
    return float(value), str(row.get("CD_CONTA") or ""), str(row.get("DS_CONTA") or ""), str(row.get("DT_REFER") or row.get("DT_FIM_EXERC") or "")


async def enrich_cvm(cnpj: str, reporting_period: str | None, filing_type: str | None) -> RegulatorySnapshot:
    cnpj_digits = normalize_cnpj(cnpj)
    if len(cnpj_digits) != 14:
        raise ValueError("invalid_cnpj")
    year = year_from_period(reporting_period)
    doc = "ITR" if (filing_type or "").upper().startswith("ITR") else "DFP"
    prefix = "itr" if doc == "ITR" else "dfp"
    url = f"{CVM_BASE}/{doc}/DADOS/{prefix}_cia_aberta_{year}.zip"
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0), follow_redirects=True) as client:
        response = await client.get(url)
    response.raise_for_status()
    raw = response.content
    dre = _filter_company(_read_csv_from_zip(raw, ("DRE",)), cnpj_digits)
    bpa = _filter_company(_read_csv_from_zip(raw, ("BPA",)), cnpj_digits)
    bpp = _filter_company(_read_csv_from_zip(raw, ("BPP",)), cnpj_digits)
    dfc = _filter_company(_read_csv_from_zip(raw, ("DFC_MI",)), cnpj_digits)
    if dfc.empty:
        dfc = _filter_company(_read_csv_from_zip(raw, ("DFC_MD",)), cnpj_digits)

    retrieved = datetime.now(timezone.utc).isoformat()
    source = SourceRef(provider="cvm_open_data", url=url, retrievedAt=retrieved, form=doc, period=str(year))
    spec = [
        ("revenue", dre, ["3.01"], ["Receita"]),
        ("grossProfit", dre, ["3.03"], ["Resultado Bruto", "Lucro Bruto"]),
        ("netIncome", dre, ["3.11"], ["Lucro", "Prejuízo", "Resultado Líquido"]),
        ("totalAssets", bpa, ["1"], ["Ativo Total"]),
        ("cash", bpa, ["1.01.01"], ["Caixa", "Equivalentes de Caixa"]),
        ("totalEquity", bpp, ["2.03"], ["Patrimônio Líquido"]),
        ("currentLiabilities", bpp, ["2.01"], ["Passivo Circulante"]),
        ("longTermDebt", bpp, ["2.02.01"], ["Empréstimos", "Financiamentos"]),
        ("operatingCashFlow", dfc, ["6.01"], ["Atividades Operacionais"]),
    ]
    metrics: list[Metric] = []
    for key, frame, codes, labels in spec:
        value, code, label, period = _pick_account(frame, codes, labels)
        if value is not None:
            metrics.append(Metric(key=key, value=value, unit="BRL", period=period or str(year), status="single_source", source=source, rawLabel=label, rawCode=code))

    company_name = ""
    for frame in (dre, bpa, bpp):
        if not frame.empty and "DENOM_CIA" in frame.columns:
            company_name = str(frame.iloc[-1].get("DENOM_CIA") or "")
            if company_name:
                break
    raw_summary: dict[str, Any] = {
        "document": doc,
        "year": year,
        "statementRows": {"DRE": len(dre), "BPA": len(bpa), "BPP": len(bpp), "DFC": len(dfc)},
    }
    return RegulatorySnapshot(
        status="complete" if metrics else "partial",
        jurisdiction="br",
        provider="cvm_open_data",
        company={"name": company_name, "cnpj": cnpj_digits, "document": doc, "year": year},
        metrics=metrics,
        sources=[source],
        warnings=[] if metrics else ["No mapped CVM statement accounts were found for this CNPJ/year/document."],
        raw=raw_summary,
    )
