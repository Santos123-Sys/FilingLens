"""Independent Python arithmetic/provenance oracle for the published TS replay.

No network and no fitting. Fails if a forecast, selector, band, source conversion,
source hash, training cutoff or declared score disagrees. Run after forecast:evaluate.
"""
import hashlib
import json
import math
from decimal import Decimal
from pathlib import Path
from statistics import mean, median

ROOT = Path(__file__).resolve().parents[1]
data_bytes = (ROOT / "public/evaluations/forecast-cohort-cvm.json").read_bytes()
data = json.loads(data_bytes)
report = json.loads((ROOT / "public/evaluations/forecast-qualification-v2.json").read_text())
models = ["filinglens_growth_v1", "naive", "drift", "three_year_cagr", "median_ensemble"]
assert hashlib.sha256(data_bytes).hexdigest() == report["datasetSha256"]
assert hashlib.sha256((ROOT / "contracts/forecast-qualification.ts").read_bytes()).hexdigest() == report["engineSha256"]
assert hashlib.sha256((ROOT / "docs/forecast-qualification-protocol.md").read_bytes()).hexdigest() == report["protocolSha256"]
assert len(data["cohort"]) == 60
assert [i["selectionHash"] for i in data["cohort"]] == sorted(i["selectionHash"] for i in data["cohort"])
for o in data["observations"]:
    raw, receipt = o["sourceRow"], o["receipt"]
    assert int(raw["VERSAO"]) == int(receipt["VERSAO"]) == o["version"]
    assert receipt["DT_RECEB"][:10] == o["publishedOn"]
    assert receipt["ID_DOC"] == o["documentId"]
    assert raw["ORDEM_EXERC"] in ("ÚLTIMO", "ULTIMO")
    scale = {"MIL": Decimal("0.001"), "UNIDADE": Decimal("0.000001"), "MILHÃO": Decimal(1)}[raw["ESCALA_MOEDA"]]
    assert float(Decimal(raw["VL_CONTA"].replace(",", ".")) * scale) == o["value"]
    canonical = json.dumps(raw, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    assert hashlib.sha256(canonical.encode()).hexdigest() == o["sourceRowSha256"]


def same(a, b):
    assert (a is None) == (b is None), (a, b)
    if a is not None:
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-7), (a, b)


def candidates(values, h):
    last = values[-1]
    drift = last + h * (last - values[0]) / (len(values) - 1)
    cagr = last * (last / values[max(0, len(values)-4)]) ** (h / min(3, len(values)-1))
    growth = (last / values[-2] - 1) * 100
    legacy = last
    for k in range(h):
        legacy *= 1 + float(f"{growth * (1 - k * 0.15):.2f}") / 100
    parts = [last, drift, cagr]
    result = [legacy, last, drift, cagr, median(parts) if all(v > 0 and math.isfinite(v) for v in parts) else None]
    return {m: (v if v is not None and v > 0 and math.isfinite(v) else None) for m, v in zip(models, result)}


verified = 0
for issuer in data["cohort"]:
    observations = [o for o in data["observations"] if o["issuer"] == issuer["code"]]
    past = []
    def available(year, origin):
        eligible = [o for o in observations if o["fiscalYear"] == year and o["publishedOn"] < origin and o["periodEnd"] < origin]
        return max(eligible, key=lambda o: o["publishedOn"]) if eligible else None
    for year in range(min(o["fiscalYear"] for o in observations)+3, 2026):
        origin = f"{year}-07-01"
        training = []
        for y in range(year-1, 1999, -1):
            o = available(y, origin)
            if not o or o["value"] <= 0 or (training and (o["currency"], o["definition"]) != (training[0]["currency"], training[0]["definition"])):
                break
            training.insert(0, o)
        if len(training) < 3:
            continue
        base = training[-1]
        for h in range(1, 6):
            predictions = candidates([o["value"] for o in training], h)
            known = []
            for p in past:
                actual = available(p["target"], origin)
                if p["h"] == h and p["origin"] < origin and actual and (actual["currency"], actual["definition"]) == (base["currency"], base["definition"]) == (p["currency"], p["definition"]):
                    known.append((p, actual["value"]))
            selected, best = "naive", math.inf
            for model in models:
                if model == "naive" or predictions[model] is None:
                    continue
                pairs = [(p, a) for p, a in known if p["predictions"][model] is not None]
                if len(pairs) < 3:
                    continue
                e = mean(abs(p["predictions"][model] - a) / p["base"] for p, a in pairs)
                n = mean(abs(p["predictions"]["naive"] - a) / p["base"] for p, a in pairs)
                if e < best and e <= n * .9 and e < n:
                    selected, best = model, e
            adaptive = predictions[selected]
            errors = sorted(abs(p["adaptive"] - a) / p["base"] for p, a in known)
            rank = math.ceil((len(errors)+1)*.8)
            band = None if len(errors) < 5 or rank > len(errors) else (max(0, adaptive-errors[rank-1]*base["value"]), adaptive+errors[rank-1]*base["value"])
            row = next((r for r in report["cases"] if (r["issuer"],r["origin"],r["horizon"]) == (issuer["code"], origin, h)), None)
            if row and row["status"] == "scored":
                assert row["trainingIds"] == [o["id"] for o in training]
                assert row["selectedModel"] == selected
                assert row["calibrationErrors"] == len(errors)
                for model in models:
                    same(row["predictions"][model], predictions[model]); verified += 1
                same(row["predictions"]["adaptive_v2"], adaptive); verified += 1
                assert (row["interval"] is None) == (band is None)
                if band:
                    same(row["interval"]["lower"],band[0]); same(row["interval"]["upper"],band[1])
            past.append({"origin":origin,"h":h,"target":year+h-1,"base":base["value"],"predictions":predictions,"adaptive":adaptive,"currency":base["currency"],"definition":base["definition"]})

test = [r for r in report["cases"] if r["split"] == "locked_test" and r["horizon"] == 1 and r["status"] == "scored" and all(r["predictions"][m] is not None for m in ("adaptive_v2","naive","filinglens_growth_v1"))]
for model, key in [("adaptive_v2","adaptiveMacroErrorPercent"),("naive","naiveMacroErrorPercent"),("filinglens_growth_v1","legacyMacroErrorPercent")]:
    errors = {i: [abs(r["predictions"][model] - r["actual"]) / r["scale"] for r in test if r["issuer"] == i] for i in {r["issuer"] for r in test}}
    same(mean(mean(e) for e in errors.values())*100, report["qualification"][key])
print(json.dumps({"sourceObservationsVerified":len(data["observations"]),"forecastValuesVerified":verified,"pairedTestCases":len(test),"provenanceAndMacroScores":"passed"}))
