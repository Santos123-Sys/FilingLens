"""Reproduce the frozen CVM cohort; public DFP data only, no SEC acquisition.

Usage: python ops/acquire-forecast-cohort.py --cache ../forecast-cohort-raw
The cache is deliberately outside git. Values are retained regulatory vintages,
not reconstructed original releases. No receipt is borrowed from another version.
"""
import argparse
import csv
import hashlib
import io
import json
import unicodedata
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from pathlib import Path

BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA"
MAX_BYTES = 80_000_000


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).strip().upper()


def download(url, path):
    if path.exists():
        data = path.read_bytes()
    else:
        request = urllib.request.Request(url, headers={"User-Agent": "FilingLens forecast evaluation (public CVM DFP archives)"})
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("Archive exceeds bounded acquisition size")
        path.write_bytes(data)
    if len(data) > MAX_BYTES:
        raise ValueError("Cached archive exceeds bounded acquisition size")
    return data


def records(archive, member):
    info = archive.getinfo(member)
    if info.file_size > 120_000_000:
        raise ValueError("CSV exceeds uncompressed size limit")
    with archive.open(member) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="latin1"), delimiter=";")


def extract_year(data, year):
    archive_sha = digest(data)
    source = f"{BASE}/DOC/DFP/DADOS/dfp_cia_aberta_{year}.zip"
    rows, exclusions = [], {}
    def exclude(reason):
        exclusions[reason] = exclusions.get(reason, 0) + 1
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        receipts = {}
        for r in records(archive, f"dfp_cia_aberta_{year}.csv"):
            key = (str(int(r["CD_CVM"])), r["DT_REFER"], int(r["VERSAO"]))
            receipts.setdefault(key, []).append(r)
        member = f"dfp_cia_aberta_DRE_con_{year}.csv"
        for r in records(archive, member):
            if r["CD_CONTA"] != "3.01" or normalized(r["ORDEM_EXERC"]) != "ULTIMO":
                continue
            if r["DT_INI_EXERC"] != f"{year}-01-01" or r["DT_FIM_EXERC"] != f"{year}-12-31" or r["DT_REFER"] != f"{year}-12-31":
                exclude("not_calendar_annual"); continue
            code = str(int(r["CD_CVM"]))
            matches = receipts.get((code, r["DT_REFER"], int(r["VERSAO"])), [])
            if len(matches) != 1:
                exclude("missing_or_ambiguous_exact_version_receipt"); continue
            receipt = matches[0]
            filed = receipt["DT_RECEB"][:10]
            try:
                date.fromisoformat(filed)
                if filed < r["DT_FIM_EXERC"]:
                    raise ValueError("Publication predates period")
                scales = {"MIL": Decimal("0.001"), "UNIDADE": Decimal("0.000001"), "MILHAO": Decimal(1)}
                if normalized(r["MOEDA"]) not in ("REAL", "REAIS"):
                    raise ValueError("Unsupported currency")
                value = Decimal(r["VL_CONTA"].replace(",", ".")) * scales[normalized(r["ESCALA_MOEDA"])]
                if not value.is_finite():
                    raise ValueError("Nonfinite value")
            except (ValueError, KeyError, ArithmeticError):
                exclude("invalid_value_unit_or_receipt"); continue
            canonical = json.dumps(r, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            rows.append({
                "id": f"CVM-{code}-{year}-v{int(r['VERSAO'])}", "issuer": code,
                "name": r["DENOM_CIA"], "fiscalYear": year,
                "periodEnd": r["DT_FIM_EXERC"], "publishedOn": filed,
                "value": float(value), "currency": "BRL", "unit": "millions",
                "definition": normalized(r["DS_CONTA"]), "account": "3.01",
                "version": int(r["VERSAO"]), "documentId": receipt["ID_DOC"],
                "sourceUrl": source, "sourceSha256": archive_sha,
                "member": member, "sourceRowSha256": digest(canonical.encode()),
                "sourceRow": r, "receipt": {k: receipt[k] for k in ("CD_CVM", "DT_REFER", "VERSAO", "ID_DOC", "DT_RECEB", "LINK_DOC")},
            })
    return rows, {"year": year, "sourceUrl": source, "sha256": archive_sha, "bytes": len(data), "exclusions": exclusions}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/evaluations/forecast-cohort-cvm.json"))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    def acquire(year):
        filename = f"dfp_cia_aberta_{year}.zip"
        data = download(f"{BASE}/DOC/DFP/DADOS/{filename}", args.cache / filename)
        result = extract_year(data, year)
        print(f"Acquired FY{year}: {len(result[0])} annual consolidated revenue rows", flush=True)
        return result
    base_rows, base_manifest = acquire(2018)
    eligible = sorted({r["issuer"] for r in base_rows if r["value"] > 0 and r["publishedOn"] <= "2019-06-30"}, key=lambda code: digest(f"filinglens-forecast-v2:{code}".encode()))
    cohort = eligible[:60]
    if len(cohort) != 60:
        raise ValueError("Frozen cohort requires 60 eligible issuers")
    print(f"Cohort frozen: {len(cohort)} of {len(eligible)} eligible issuers", flush=True)
    registry_url = f"{BASE}/CAD/DADOS/cad_cia_aberta.csv"
    registry_bytes = download(registry_url, args.cache / "cad_cia_aberta.csv")
    registry = {}
    for r in csv.DictReader(io.StringIO(registry_bytes.decode("latin1")), delimiter=";"):
        code = str(int(r["CD_CVM"])) if r["CD_CVM"] else ""
        if code in cohort:
            registry[code] = {"sector": r["SETOR_ATIV"] or "Unclassified", "registryStatus": r["SIT"]}
    # Bounded two-request concurrency. All raw archives stay in the local cache.
    with ThreadPoolExecutor(max_workers=2) as pool:
        acquired = list(pool.map(acquire, [y for y in range(2010, 2026) if y != 2018]))
    acquired.append((base_rows, base_manifest))
    observations = [r for rows, _ in acquired for r in rows if r["issuer"] in cohort]
    issuers = []
    for code in cohort:
        base = next(r for r in base_rows if r["issuer"] == code)
        issuers.append({"code": code, "name": base["name"], "selectionHash": digest(f"filinglens-forecast-v2:{code}".encode()), **registry.get(code, {"sector": "Unclassified", "registryStatus": "Unknown"})})
    output = {
        "schemaVersion": "forecast-cohort.cvm.v2", "acquiredOn": date.today().isoformat(),
        "protocolCommit": "e787863", "eligible2018Count": len(eligible),
        "cohort": issuers, "observations": sorted(observations, key=lambda r: (r["issuer"], r["fiscalYear"], r["publishedOn"])),
        "archives": sorted([m for _, m in acquired], key=lambda m: m["year"]),
        "registry": {"sourceUrl": registry_url, "sha256": digest(registry_bytes), "labelsAsOf": date.today().isoformat()},
        "attribution": "Comissão de Valores Mobiliários (CVM), DFP and public issuer register. Derivative database: Open Database License (ODbL) 1.0. See data/LICENSE-CVM.md.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {len(observations)} observations for {len(issuers)} fixed issuers to {args.output}")


if __name__ == "__main__":
    main()
