"""Reproducible primary-source coverage; public aggregates only, no SEC calls.
Run: PYTHONPATH=services/financial-data-service python ops/check-brazil-fundamentals.py --year 2025
"""
import argparse
import asyncio
import json
from collections import Counter
from app.providers.cvm_facts import screen


async def run(year):
    offset, total, states, metrics = 0, 0, Counter(), Counter()
    unique = set()
    issues = []
    while True:
        result = await screen("DFP", year, "consolidated", offset, 50)
        for issuer in result["issuers"]:
            unique.add(issuer["cnpj"])
            total += 1
            states[issuer["status"]] += 1
            metrics.update(k for k, v in issuer["metrics"].items() if len(v) == 1)
        issues.extend(result["issues"])
        if result["nextOffset"] is None:
            break
        offset = result["nextOffset"]
    if total != len(unique) or total != result["totalIssuers"]:
        raise ValueError("coverage_denominator_mismatch")
    print(json.dumps({"mode": "live_acquisition_then_full_archive_replay", "year": year, "form": "DFP", "scope": "consolidated",
        "totalIssuers": total, "states": states, "unambiguousMetricCoverage": metrics, "issues": issues[:100],
        "source": result["source"], "b3RiskCertified": False}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    args = parser.parse_args()
    asyncio.run(run(args.year))
