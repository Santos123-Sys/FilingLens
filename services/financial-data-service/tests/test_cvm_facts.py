import asyncio
import csv
import hashlib
import io
import json
import zipfile

import pytest

from app.providers import cvm_facts as cvm
from app.providers import sec_edgar
from app.sec_policy import sec_access_status

CNPJ = "33000167000101"
OTHER = "60701190000104"
RECEIPT = {"sourceUrl": "https://dados.cvm.gov.br/archive.zip", "archiveSha256": "a" * 64, "retrievedAt": "2026-10-21T00:00:00+00:00", "cache": "network", "stale": False}


def row(**kw):
    return {"CNPJ_CIA": CNPJ, "DENOM_CIA": "Issuer", "DT_REFER": "2025-12-31", "VERSAO": "1", "ORDEM_EXERC": "ÚLTIMO",
            "DT_INI_EXERC": "2025-01-01", "DT_FIM_EXERC": "2025-12-31", "CD_CONTA": "3.01", "DS_CONTA": "Receita de Venda de Bens e/ou Serviços",
            "MOEDA": "REAL", "ESCALA_MOEDA": "MIL", "VL_CONTA": "123.45", **kw}


def archive(rows, form="DFP", scope="con", statement="DRE", year=2025):
    out, content = io.BytesIO(), io.StringIO()
    writer = csv.DictWriter(content, fieldnames=list(row()), delimiter=";")
    writer.writeheader()
    writer.writerows(rows)
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(f"{form.lower()}_cia_aberta_{statement}_{scope}_{year}.csv", content.getvalue().encode("latin1"))
    return out.getvalue()


def test_source_units_exact_decimal_and_provenance():
    raw = archive([row(), row(ORDEM_EXERC="PENÚLTIMO", VL_CONTA="1")])
    facts, issues = cvm.parse_archive(raw, "DFP", 2025, RECEIPT, CNPJ)
    assert not issues and len(facts) == 1
    fact = facts[0]
    assert fact["value"] == "123450.00"
    assert fact["reportedValue"] == "123.45"
    assert fact["canonicalMetric"] == "revenue"
    assert fact["availableAt"] is None
    assert fact["source"]["row"] == 2
    assert fact["source"]["archiveSha256"] == "a" * 64
    assert fact["id"] == cvm.parse_archive(raw, "DFP", 2025, {**RECEIPT, "cache": "disk"}, CNPJ)[0][0]["id"]


def test_scope_missing_currency_and_bank_accounts_never_become_industrial_revenue():
    facts, issues = cvm.parse_archive(archive([row(DS_CONTA="Receitas da Intermediação Financeira"), row(CD_CONTA="3.02", MOEDA="USD")]), "DFP", 2025, RECEIPT)
    assert not issues and facts[0]["canonicalMetric"] is None
    assert cvm.select_facts(facts, "standalone")[0] == []
    assert facts[1]["currency"] == "USD" and facts[1]["canonicalMetric"] is None


def test_versions_are_partitioned_by_quarter_and_conflicts_not_last_row_wins():
    raw = archive([row(DT_REFER="2025-03-31", DT_FIM_EXERC="2025-03-31", VERSAO="2"),
                   row(DT_REFER="2025-06-30", DT_FIM_EXERC="2025-06-30", VERSAO="1"),
                   row(DT_REFER="2025-03-31", DT_FIM_EXERC="2025-03-31", VERSAO="1", VL_CONTA="1")])
    facts, _ = cvm.parse_archive(raw, "DFP", 2025, RECEIPT)
    selected, conflicts = cvm.select_facts(facts, "consolidated")
    assert len(selected) == 2 and not conflicts
    bad = {**selected[0], "value": "999"}
    selected, conflicts = cvm.select_facts([*selected, bad], "consolidated")
    assert conflicts and len(selected) == 1


def test_invalid_scaling_and_nonfinite_values_are_excluded():
    facts, issues = cvm.parse_archive(archive([row(ESCALA_MOEDA="unknown"), row(VL_CONTA="NaN"), row(VL_CONTA="0")]), "DFP", 2025, RECEIPT)
    assert len(facts) == 1 and facts[0]["value"] == "0"
    assert len(issues) == 2


def test_archive_traversal_and_expansion_fail_closed(monkeypatch):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("../bad.csv", "unsafe")
    with pytest.raises(ValueError, match="unsafe_archive_member"):
        cvm.parse_archive(out.getvalue(), "DFP", 2025, RECEIPT)
    monkeypatch.setattr(cvm, "MAX_EXPANDED", 1)
    with pytest.raises(ValueError, match="expansion"):
        cvm.parse_archive(archive([row()]), "DFP", 2025, RECEIPT)


def test_cache_hash_detects_tampering_and_never_changes_acquisition_date(tmp_path, monkeypatch):
    monkeypatch.setenv("CVM_ARCHIVE_CACHE_DIR", str(tmp_path))
    cvm._save("source", b"raw", RECEIPT["retrievedAt"])
    assert cvm._saved("source") == (b"raw", RECEIPT["retrievedAt"])
    (tmp_path / (hashlib.sha256(b"raw").hexdigest() + ".bin")).write_bytes(b"changed")
    assert cvm._saved("source") is None


def test_bulk_screen_denominator_includes_unmapped_issuers_and_paginates(monkeypatch):
    raw = archive([row(), row(CNPJ_CIA=OTHER, DS_CONTA="Unknown bank account")])
    async def acquire(_):
        return raw, RECEIPT
    monkeypatch.setattr(cvm, "acquire", acquire)
    result = asyncio.run(cvm.screen("DFP", 2025, "consolidated", 0, 1))
    assert result["totalIssuers"] == 2 and result["nextOffset"] == 1
    second = asyncio.run(cvm.screen("DFP", 2025, "consolidated", 1, 1))
    assert second["issuers"][0]["metrics"] == {}
    assert second["nextOffset"] is None


def test_itr_preserves_ytd_and_standalone_duration_candidates(monkeypatch):
    raw = archive([row(DT_REFER="2025-06-30", DT_FIM_EXERC="2025-06-30"),
                   row(DT_REFER="2025-06-30", DT_INI_EXERC="2025-04-01", DT_FIM_EXERC="2025-06-30", VL_CONTA="60")], form="ITR")
    async def acquire(_):
        return raw, RECEIPT
    monkeypatch.setattr(cvm, "acquire", acquire)
    result = asyncio.run(cvm.screen("ITR", 2025, "consolidated", 0, 1))
    assert result["issuers"][0]["ambiguousMetrics"] == ["revenue"]


def test_sec_pause_checked_before_any_http_call(tmp_path, monkeypatch):
    policy = tmp_path / "policy.json"
    policy.write_text(json.dumps({"schema": "filinglens.sec_acquisition_access.v1", "state": "paused", "reason": "official_http_403"}))
    monkeypatch.setenv("SEC_ACCESS_POLICY_PATH", str(policy))
    monkeypatch.setattr(sec_edgar, "_cache", {})
    def unexpected(*a, **kw):
        raise AssertionError("HTTP client must not be constructed")
    monkeypatch.setattr(sec_edgar.httpx, "AsyncClient", unexpected)
    assert sec_access_status()["status"] == "paused"
    with pytest.raises(ValueError, match="sec_access_review_required"):
        asyncio.run(sec_edgar._cached_json("https://data.sec.gov/example"))


def test_identity_never_truncated_and_per_share_units_not_dollar_facts():
    with pytest.raises(ValueError):
        sec_edgar.normalize_cik("123456789012")
    with pytest.raises(ValueError):
        cvm.cnpj_id("33000167000102")
    facts = {"facts": {"us-gaap": {"Revenues": {"units": {"USD/shares": [{"val": 5}], "USD": [{"val": 10}]}}}}}
    assert [f["val"] for f in sec_edgar._fact_entries(facts, ["Revenues"])] == [10]


def test_screen_never_calls_conflicting_issuer_available(monkeypatch):
    raw = archive([row(), row(VL_CONTA="999")])
    async def acquire(_):
        return raw, RECEIPT
    monkeypatch.setattr(cvm, "acquire", acquire)
    result = asyncio.run(cvm.screen("DFP", 2025, "consolidated", 0, 10))
    issuer = result["issuers"][0]
    assert issuer["status"] == "conflict"
    assert issuer["conflicts"] and issuer["metrics"] == {}


def test_data_tools_auth_and_source_failures_are_bounded(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setenv("FILINGLENS_CORPUS_TOKEN", "t" * 40)
    client = TestClient(app)
    calls = []
    async def registry(*args):
        calls.append(args)
        return {"schemaVersion": "cvm-issuers.v1", "issuers": []}
    monkeypatch.setattr(cvm, "issuer_registry", registry)
    assert client.post("/v1/fundamentals/br", json={"operation": "issuers"}).status_code == 401
    assert calls == []
    headers = {"Authorization": "Bearer " + "t" * 40}
    assert client.post("/v1/fundamentals/br", headers=headers, json={"operation": "issuers"}).status_code == 200
    assert len(calls) == 1
    assert client.post("/v1/fundamentals/br", headers=headers, json={"operation": "screen", "asOf": "2020-01-01"}).status_code == 422
    assert client.post("/v1/fundamentals/br", headers=headers, json={"operation": "screen", "limit": 10000}).status_code == 422
