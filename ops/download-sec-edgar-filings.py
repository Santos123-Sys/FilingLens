"""Bounded SEC filing download into ticker/form/accession folders.

The workflow installs sec-edgar-downloader 5.1.0. This wrapper validates the
committed watchlist, downloads serially, and writes a checksum manifest. It is
not a proxy, does not retry denied requests, and never commits downloaded data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from sec_edgar_downloader import Downloader

SCHEMA = "filinglens.sec_edgar_watchlist.v1"
TICKER = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")
CIK = re.compile(r"^\d{10}$")
FORMS = {"10-K", "10-Q", "8-K"}


def load_watchlist(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    issuers = value.get("issuers") if isinstance(value, dict) else None
    if (
        value.get("schema") != SCHEMA
        or not isinstance(value.get("lookbackDays"), int)
        or not 1 <= value["lookbackDays"] <= 31
        or not isinstance(value.get("limitPerForm"), int)
        or not 1 <= value["limitPerForm"] <= 5
        or not isinstance(issuers, list)
        or not 1 <= len(issuers) <= 12
    ):
        raise ValueError("invalid SEC EDGAR watchlist")
    tickers: set[str] = set()
    ciks: set[str] = set()
    for issuer in issuers:
        forms = issuer.get("forms") if isinstance(issuer, dict) else None
        ticker = issuer.get("ticker") if isinstance(issuer, dict) else None
        cik = issuer.get("cik") if isinstance(issuer, dict) else None
        if (
            not isinstance(ticker, str)
            or not TICKER.fullmatch(ticker)
            or not isinstance(cik, str)
            or not CIK.fullmatch(cik)
            or not isinstance(forms, list)
            or not 1 <= len(forms) <= 3
            or any(not isinstance(form, str) or form not in FORMS for form in forms)
            or len(set(forms)) != len(forms)
            or ticker in tickers
            or cik in ciks
        ):
            raise ValueError("invalid SEC EDGAR issuer")
        tickers.add(ticker)
        ciks.add(cik)
    return value


def file_manifest(root: Path, acquisition: dict[str, Any]) -> dict[str, Any]:
    files = []
    filing_root = root / "sec-edgar-filings"
    for path in sorted(p for p in filing_root.rglob("*") if p.is_file()):
        raw = path.read_bytes()
        files.append(
            {
                "path": path.relative_to(filing_root).as_posix(),
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    return {
        "schema": "filinglens.sec_edgar_folder_manifest.v1",
        "source": "sec-edgar-downloader@5.1.0",
        "acquisition": acquisition,
        "files": files,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--watchlist", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--lookback-days", type=int)
    args = parser.parse_args()
    contact = os.environ.get("SEC_CONTACT_EMAIL", "")
    if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", contact):
        raise ValueError("SEC_CONTACT_EMAIL must be a genuine operator contact")
    plan = load_watchlist(args.watchlist)
    lookback = args.lookback_days or plan["lookbackDays"]
    if not 1 <= lookback <= 31:
        raise ValueError("lookback days must be between 1 and 31")
    args.output.mkdir(parents=True, exist_ok=True)
    today = date.today()
    after = (today - timedelta(days=lookback)).isoformat()
    before = (today + timedelta(days=1)).isoformat()
    downloader = Downloader("FilingLens", contact, args.output)
    results = []
    for issuer in plan["issuers"]:
        for form in issuer["forms"]:
            count = downloader.get(
                form,
                issuer["ticker"],
                after=after,
                before=before,
                limit=plan["limitPerForm"],
                include_amends=False,
                download_details=True,
            )
            results.append({"ticker": issuer["ticker"], "cik": issuer["cik"], "form": form, "downloaded": count})
    acquisition = {"after": after, "before": before, "results": results}
    manifest = file_manifest(args.output, acquisition)
    manifest_path = args.output / "sec-edgar-filings" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"after": after, "before": before, "files": len(manifest["files"]), "results": results}))


if __name__ == "__main__":
    main()
