"""CVM bulk account API. Reported observations are distinct from approved metrics.

One immutable archive can serve every issuer. Current CVM archives are revised:
retrieval time is NOT filing availability and cannot prove point-in-time history.
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import os
import re
import time
import unicodedata
import zipfile
from collections import OrderedDict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath

import httpx

BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA"
MAPPING_VERSION = "cvm-accounts.v1"
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
TTL = 6 * 3600
# Bound process memory; disk receipts survive process restarts when a volume is mounted.
_cache: OrderedDict[str, tuple[float, bytes, str]] = OrderedDict()
_locks: dict[str, asyncio.Lock] = {}
_DOWNLOAD_LIMIT = asyncio.Semaphore(2)


def text(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower().strip()


def cnpj_id(value: str) -> str:
    value = re.sub(r"[./-]", "", value)
    if not re.fullmatch(r"[0-9]{14}", value) or len(set(value)) == 1:
        raise ValueError("invalid_cnpj")
    for length in (12, 13):
        weights = ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if length == 12
                   else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
        remainder = sum(int(value[i]) * weight for i, weight in enumerate(weights)) % 11
        if int(value[length]) != (0 if remainder < 2 else 11 - remainder):
            raise ValueError("invalid_cnpj")
    return value


def source_url(form: str, year: int) -> str:
    if form not in ("DFP", "ITR") or not 2010 <= year <= datetime.now(timezone.utc).year:
        raise ValueError("invalid_archive")
    return f"{BASE}/DOC/{form}/DADOS/{form.lower()}_cia_aberta_{year}.zip"


def _cache_root() -> Path:
    return Path(os.getenv("CVM_ARCHIVE_CACHE_DIR", "/tmp/filinglens-cvm-archives"))


def _save(url: str, raw: bytes, retrieved: str) -> None:
    root = _cache_root()
    root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(raw).hexdigest()
    blob = root / (digest + ".bin")
    if not blob.exists():
        with blob.open("xb") as handle:
            handle.write(raw)
    receipt = {"sourceUrl": url, "sha256": digest, "retrievedAt": retrieved, "bytes": len(raw)}
    # An immutable receipt per acquisition, plus an atomically replaced current pointer.
    key = hashlib.sha256(url.encode()).hexdigest()
    receipt_name = key + "-" + retrieved.replace(":", "") + ".json"
    (root / receipt_name).write_text(json.dumps(receipt), encoding="utf8")
    pending = root / (key + ".pending")
    pending.write_text(json.dumps(receipt), encoding="utf8")
    pending.replace(root / (key + ".json"))


def _saved(url: str) -> tuple[bytes, str] | None:
    try:
        root = _cache_root()
        receipt = json.loads((root / (hashlib.sha256(url.encode()).hexdigest() + ".json")).read_text())
        digest = receipt["sha256"]
        if receipt["sourceUrl"] != url or not re.fullmatch("[a-f0-9]{64}", digest):
            return None
        path = root / (digest + ".bin")
        if path.stat().st_size > MAX_ARCHIVE:
            return None
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            return None
        return raw, receipt["retrievedAt"]
    except (OSError, KeyError, ValueError, TypeError):
        return None


async def acquire(url: str) -> tuple[bytes, dict]:
    # URLs are built internally; never accept an arbitrary URL from an API client.
    if not re.fullmatch(re.escape(BASE) + r"/(CAD/DADOS/cad_cia_aberta.csv|DOC/(DFP|ITR)/DADOS/(dfp|itr)_cia_aberta_20[0-9]{2}.zip)", url):
        raise ValueError("invalid_source")
    lock = _locks.setdefault(url, asyncio.Lock())
    async with lock:
        cached = _cache.get(url)
        if cached and time.monotonic() - cached[0] < TTL:
            _cache.move_to_end(url)
            raw, retrieved, mode = cached[1], cached[2], "memory"
        else:
            saved = await asyncio.to_thread(_saved, url)
            if saved and 0 <= (datetime.now(timezone.utc) - datetime.fromisoformat(saved[1])).total_seconds() < TTL:
                raw, retrieved, mode = *saved, "disk"
            else:
                async with _DOWNLOAD_LIMIT, httpx.AsyncClient(timeout=httpx.Timeout(50, connect=10), follow_redirects=False) as client:
                    async with client.stream("GET", url, headers={"User-Agent": "FilingLens/1.0", "Accept": "*/*"}) as response:
                        response.raise_for_status()
                        chunks, size = [], 0
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if size > MAX_ARCHIVE:
                                raise ValueError("archive_too_large")
                            chunks.append(chunk)
                        raw = b"".join(chunks)
                retrieved, mode = datetime.now(timezone.utc).isoformat(), "network"
                await asyncio.to_thread(_save, url, raw, retrieved)
            _cache[url] = (time.monotonic(), raw, retrieved)
            while len(_cache) > 3:
                _cache.popitem(last=False)
        return raw, {"sourceUrl": url, "archiveSha256": hashlib.sha256(raw).hexdigest(),
                     "retrievedAt": retrieved, "cache": mode, "stale": False}


def _iso(value: str | None) -> str | None:
    try:
        return date.fromisoformat(value or "").isoformat()
    except ValueError:
        return None


# Exact fixed codes AND semantic labels. Unknown/sector-specific accounts stay reported.
SPECS = {
    ("BPA", "1"): ("totalAssets", ("ativo total",)),
    ("BPA", "1.01.01"): ("cash", ("caixa e equivalentes",)),
    ("BPP", "2.01"): ("currentLiabilities", ("passivo circulante",)),
    ("BPP", "2.02"): ("nonCurrentLiabilities", ("passivo nao circulante",)),
    ("BPP", "2.03"): ("totalEquity", ("patrimonio liquido",)),
    ("BPP", "2.01.04"): ("shortTermDebt", ("emprestimos e financiamentos",)),
    ("BPP", "2.02.01"): ("longTermDebt", ("emprestimos e financiamentos",)),
    ("DRE", "3.01"): ("revenue", ("receita de venda", "receita liquida de venda", "receita operacional liquida")),
    ("DRE", "3.03"): ("grossProfit", ("resultado bruto", "lucro bruto")),
    ("DRE", "3.05"): ("ebit", ("resultado antes do resultado financeiro",)),
    ("DRE", "3.11"): ("netIncome", ("lucro/prejuizo consolidado do periodo", "lucro/prejuizo do periodo")),
    ("DFC_MI", "6.01"): ("operatingCashFlow", ("caixa liquido atividades operacionais", "caixa liquido das atividades operacionais")),
    ("DFC_MD", "6.01"): ("operatingCashFlow", ("caixa liquido atividades operacionais", "caixa liquido das atividades operacionais")),
}


def parse_archive(raw: bytes, form: str, year: int, receipt: dict, requested: str | set[str] | None = None) -> tuple[list[dict], list[str]]:
    facts, issues, seen = [], [], set()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        if len(members) > 100 or sum(m.file_size for m in members) > MAX_EXPANDED:
            raise ValueError("archive_expansion_limit")
        for member in members:
            path = PurePosixPath(member.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in member.filename or member.flag_bits & 1:
                raise ValueError("unsafe_archive_member")
            match = re.fullmatch(rf"{form.lower()}_cia_aberta_(BPA|BPP|DRE|DFC_MI|DFC_MD)_(con|ind)_{year}\.csv", member.filename, re.I)
            if not match:
                continue
            statement, scope = match[1].upper(), "consolidated" if match[2].lower() == "con" else "standalone"
            with archive.open(member) as handle, io.TextIOWrapper(handle, encoding="latin1", newline="") as stream:
                for row_number, row in enumerate(csv.DictReader(stream, delimiter=";"), 2):
                    identity = re.sub(r"\D", "", row.get("CNPJ_CIA", ""))
                    if requested is not None and (identity not in requested if isinstance(requested, set) else identity != requested):
                        continue
                    if text(row.get("ORDEM_EXERC", "")) != "ultimo":
                        continue
                    try:
                        cnpj_id(identity)
                        value = Decimal(row["VL_CONTA"])
                        scale_label = text(row["ESCALA_MOEDA"])
                        scale = {"mil": 1000, "unidade": 1}.get(scale_label)
                        version = int(row["VERSAO"])
                        reference = _iso(row.get("DT_REFER"))
                        end = _iso(row.get("DT_FIM_EXERC"))
                        start = _iso(row.get("DT_INI_EXERC")) if row.get("DT_INI_EXERC") else None
                        if not value.is_finite() or scale is None or not reference or not end or version < 1 or not reference.startswith(str(year)):
                            raise ValueError()
                        currency = "BRL" if text(row.get("MOEDA", "")) in ("real", "reais", "brl") else row.get("MOEDA", "")
                        if not currency or (statement in ("DRE", "DFC_MI", "DFC_MD") and (not start or start > end)):
                            raise ValueError()
                    except (ValueError, KeyError, InvalidOperation):
                        if len(issues) < 100:
                            issues.append(f"{member.filename}:{row_number}:invalid_observation")
                        continue
                    code, label = row.get("CD_CONTA", ""), row.get("DS_CONTA", "")
                    if not code:
                        continue
                    spec = SPECS.get((statement, code))
                    canonical = spec[0] if spec and currency == "BRL" and any(s in text(label) for s in spec[1]) else None
                    fact = {"cnpj": identity, "issuerName": row.get("DENOM_CIA", ""), "form": form,
                            "referenceDate": reference, "periodStart": start, "periodEnd": end,
                            "periodKind": "instant" if statement in ("BPA", "BPP") else "duration",
                            "statement": statement, "scope": scope, "filingVersion": version,
                            "accountCode": code, "accountLabel": label, "currency": currency,
                            "reportedValue": str(value), "reportedScale": row["ESCALA_MOEDA"],
                            "value": str(value * scale), "canonicalMetric": canonical,
                            "mappingVersion": MAPPING_VERSION, "status": "single_source",
                            "availableAt": None, "availabilityBasis": "not_in_account_table",
                            "source": {**{k: v for k, v in receipt.items() if k != "cache"}, "member": member.filename, "row": row_number}}
                    fingerprint = hashlib.sha256(json.dumps(fact, sort_keys=True).encode()).hexdigest()
                    if fingerprint not in seen:
                        facts.append({"id": fingerprint, **fact})
                        seen.add(fingerprint)
    financial = {f["cnpj"] for f in facts if f["statement"] == "DRE" and any(
        token in text(f["accountLabel"]) for token in ("intermediacao financeira", "operacoes de seguros", "premios de seguros"))}
    for fact in facts:
        fact["sectorModel"] = "financial_review_required" if fact["cnpj"] in financial else "account_semantics_only"
        if fact["cnpj"] in financial and fact["canonicalMetric"] in {"revenue", "grossProfit", "ebit", "shortTermDebt", "longTermDebt"}:
            fact["canonicalMetric"] = None
        fact["id"] = hashlib.sha256(json.dumps({k: v for k, v in fact.items() if k != "id"}, sort_keys=True).encode()).hexdigest()
    return facts, issues


def select_facts(facts: list[dict], scope: str) -> tuple[list[dict], list[str]]:
    """Latest filing version per reference, not maximum across different quarters."""
    scoped = [f for f in facts if f["scope"] == scope]
    versions: dict[tuple, int] = {}
    for f in scoped:
        key = (f["cnpj"], f["form"], f["referenceDate"])
        versions[key] = max(versions.get(key, 0), f["filingVersion"])
    groups: dict[tuple, list[dict]] = {}
    for f in scoped:
        if f["filingVersion"] != versions[(f["cnpj"], f["form"], f["referenceDate"])]:
            continue
        key = (f["cnpj"], f["referenceDate"], f["statement"], f["accountCode"], f["periodStart"], f["periodEnd"])
        groups.setdefault(key, []).append(f)
    selected, conflicts = [], []
    for group in groups.values():
        if len({(f["value"], f["currency"]) for f in group}) > 1:
            conflicts.append(group[0]["cnpj"] + ":" + group[0]["accountCode"] + ":conflicting_facts")
        else:
            selected.append(group[0])
    return selected, conflicts


async def issuer_registry(offset: int = 0, limit: int = 100, active_only: bool = True) -> dict:
    raw, receipt = await acquire(f"{BASE}/CAD/DADOS/cad_cia_aberta.csv")
    issuers = {}
    for row in csv.DictReader(io.StringIO(raw.decode("latin1")), delimiter=";"):
        try:
            cnpj = cnpj_id(row.get("CNPJ_CIA", ""))
        except ValueError:
            continue
        active = text(row.get("SIT", "")) == "ativo"
        if active_only and not active:
            continue
        issuers[cnpj] = {"cnpj": cnpj, "cvmCode": row.get("CD_CVM"), "name": row.get("DENOM_SOCIAL"),
                         "active": active, "registryStatus": row.get("SIT"), "sector": row.get("SETOR_ATIV")}
    rows = sorted(issuers.values(), key=lambda row: row["cnpj"])
    return {"schemaVersion": "cvm-issuers.v1", "total": len(rows), "offset": offset,
            "nextOffset": offset + limit if offset + limit < len(rows) else None,
            "issuers": rows[offset:offset + limit], "source": receipt,
            "universe": "CVM registered issuers, not a B3 instrument/share-class directory"}


async def company_facts(cnpj: str, form: str, year: int, scope: str, offset: int = 0, limit: int = 500) -> dict:
    identity = cnpj_id(cnpj)
    url = source_url(form, year)
    raw, receipt = await acquire(url)
    all_facts, issues = await asyncio.to_thread(parse_archive, raw, form, year, receipt, identity)
    facts, conflicts = select_facts(all_facts, scope)
    facts.sort(key=lambda f: (f["referenceDate"], f["statement"], f["accountCode"], f["periodStart"] or ""))
    return {"schemaVersion": "cvm-companyfacts.v1", "issuer": {"cnpj": identity}, "form": form, "archiveYear": year,
            "scope": scope, "vintage": "latest_in_current_archive", "status": "conflict" if conflicts else "available" if facts else "missing",
            "total": len(facts), "nextOffset": offset + limit if offset + limit < len(facts) else None,
            "facts": facts[offset:offset + limit], "source": receipt, "issues": issues + conflicts,
            "pointInTimeSupported": False, "riskPriceCertification": "not_applicable"}


async def screen(form: str, year: int, scope: str, offset: int, limit: int) -> dict:
    """All archived issuers are counted, including those without approved mappings."""
    url = source_url(form, year)
    raw, receipt = await acquire(url)
    issuers = await asyncio.to_thread(archive_issuers, raw, form, year)
    selected = set(issuers[offset:offset + limit])
    all_facts, issues = await asyncio.to_thread(parse_archive, raw, form, year, receipt, selected)
    facts, conflicts = select_facts(all_facts, scope)
    by_issuer: dict[str, list[dict]] = {}
    for fact in facts:
        by_issuer.setdefault(fact["cnpj"], []).append(fact)
    rows = []
    for cnpj in issuers[offset:offset + limit]:
        owned = by_issuer.get(cnpj, [])
        latest = max((f["referenceDate"] for f in owned), default=None)
        current = [f for f in owned if f["referenceDate"] == latest]
        metrics = {}
        for f in current:
            if f["canonicalMetric"]:
                metrics.setdefault(f["canonicalMetric"], []).append({"value": f["value"], "unit": f["currency"],
                    "periodStart": f["periodStart"], "periodEnd": f["periodEnd"], "sourceFactId": f["id"]})
        # Multiple duration contexts remain ambiguous, never picked by row order.
        rows.append({"cnpj": cnpj, "referenceDate": latest, "status": "available" if current else "scope_missing",
                     "metrics": metrics, "reportedFacts": len(current), "ambiguousMetrics": [k for k, v in metrics.items() if len(v) > 1]})
        issuer_conflicts = [issue for issue in conflicts if issue.startswith(cnpj + ":")]
        rows[-1]["conflicts"] = issuer_conflicts
        if issuer_conflicts:
            rows[-1]["status"] = "conflict"
    return {"schemaVersion": "cvm-screen.v1", "source": receipt, "form": form, "archiveYear": year, "scope": scope,
            "universe": "issuers_in_selected_cvm_archive", "totalIssuers": len(issuers), "offset": offset,
            "nextOffset": offset + limit if offset + limit < len(issuers) else None, "issuers": rows,
            "issues": issues + conflicts[:100], "mappingVersion": MAPPING_VERSION,
            "limitations": ["CVM issuer coverage is not B3 listing certification.", "ITR flows retain their reported duration; they are not automatically standalone quarters.",
                            "Bank/insurer accounts without an approved semantic mapping remain unmapped.", "No price, corporate-action, or point-in-time certification."]}


def archive_issuers(raw: bytes, form: str, year: int) -> list[str]:
    issuers = set()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if len(archive.infolist()) > 100 or sum(m.file_size for m in archive.infolist()) > MAX_EXPANDED:
            raise ValueError("archive_expansion_limit")
        for member in archive.infolist():
            path = PurePosixPath(member.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in member.filename or member.flag_bits & 1:
                raise ValueError("unsafe_archive_member")
            if not re.fullmatch(rf"{form.lower()}_cia_aberta_(BPA|BPP|DRE|DFC_MI|DFC_MD)_(con|ind)_{year}\.csv", member.filename, re.I):
                continue
            with archive.open(member) as handle, io.TextIOWrapper(handle, encoding="latin1", newline="") as stream:
                for row in csv.DictReader(stream, delimiter=";"):
                    try:
                        issuers.add(cnpj_id(row.get("CNPJ_CIA", "")))
                    except ValueError:
                        continue
    return sorted(issuers)
