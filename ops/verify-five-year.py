"""Independent, offline Python oracle for v3 paths, vintage cutoffs, bands and gates."""
from collections import defaultdict
from decimal import Decimal
from datetime import date,timedelta
import hashlib
import json
import math
from pathlib import Path
from statistics import mean,median

ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads((ROOT/path).read_text())
def sha(path):return hashlib.sha256((ROOT/path).read_bytes()).hexdigest()
dev=read("public/evaluations/forecast-cohort-cvm.json")
test=read("public/evaluations/five-year-cohort-cvm-v3.json")
report=read("public/evaluations/five-year-evaluation-v3.json")
outcome_cutoff=(date.fromisoformat(test["acquiredOn"])+timedelta(days=1)).isoformat()
assert report["protocolSha256"]==sha("docs/five-year-forecast-protocol-v3.md")
assert report["engineSha256"]==sha("contracts/five-year-forecast.ts")
assert report["datasetSha256"]==sha("public/evaluations/five-year-cohort-cvm-v3.json")
assert report["developmentDatasetSha256"]==sha("public/evaluations/forecast-cohort-cvm.json")
assert len(dev["cohort"])==60 and len(test["cohort"])==120
assert not {i["code"] for i in dev["cohort"]}.intersection(i["code"] for i in test["cohort"])
assert len(report["cases"])==120*3*5
assert [i["selectionHash"] for i in test["cohort"]]==sorted(i["selectionHash"] for i in test["cohort"])
for i in test["cohort"]:
    assert i["selectionHash"]==hashlib.sha256(f"filinglens-forecast-v2:{i['code']}".encode()).hexdigest()
for o in test["observations"]:
    raw,receipt=o["sourceRow"],o["receipt"]
    assert int(raw["VERSAO"])==int(receipt["VERSAO"])==o["version"]
    assert o["publishedOn"]==receipt["DT_RECEB"][:10]
    assert int(raw["CD_CVM"])==int(o["issuer"])
    assert raw["ORDEM_EXERC"] in ("ÚLTIMO","ULTIMO")
    scale={"MIL":Decimal("0.001"),"UNIDADE":Decimal("0.000001"),"MILHÃO":Decimal(1)}[raw["ESCALA_MOEDA"]]
    assert float(Decimal(raw["VL_CONTA"].replace(",","."))*scale)==o["value"]
    canonical=json.dumps(raw,ensure_ascii=False,sort_keys=True,separators=(",",":"))
    assert hashlib.sha256(canonical.encode()).hexdigest()==o["sourceRowSha256"]
    assert o["sourceSha256"]==next(a["sha256"] for a in test["archives"] if a["year"]==o["fiscalYear"])


def close(a,b):
    assert (a is None)==(b is None),(a,b)
    if a is not None:assert math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-6),(a,b)


def available(rows,year,cutoff):
    eligible=[r for r in rows if r["fiscalYear"]==year and r["publishedOn"]<cutoff and r["periodEnd"]<cutoff]
    return max(eligible,key=lambda r:r["publishedOn"]) if eligible else None


def training(rows,origin):
    out=[]
    for year in range(int(origin[:4])-1,1999,-1):
        row=available(rows,year,origin)
        if not row or row["value"]<=0 or (out and (row["currency"],row["definition"])!=(out[0]["currency"],out[0]["definition"])):break
        out.insert(0,row)
    return out


def path(values):
    recent=values[-6:]
    growth=median(math.log(b)-math.log(a) for a,b in zip(recent,recent[1:]))
    growth=min(math.log(1.25),max(math.log(.8),growth))
    revenue=values[-1];out=[]
    for h in range(5):
        rate=float(f"{math.expm1(growth*.8**h)*100:.6f}")
        revenue*=1+rate/100;out.append(revenue)
    return out


development={i["code"]:[r for r in dev["observations"] if r["issuer"]==i["code"]] for i in dev["cohort"]}
calibration=[]
for issuer,rows in development.items():
    for year in range(min(r["fiscalYear"] for r in rows)+5,max(r["fiscalYear"] for r in rows)+2):
        origin=f"{year}-07-01";train=training(rows,origin)
        if len(train)<5:continue
        for h,prediction in enumerate(path([r["value"] for r in train]),1):
            calibration.append({"id":f"{issuer}:{origin}:h{h}","issuer":issuer,"origin":origin,"horizon":h,"target":year+h-1,"prediction":prediction,"base":train[-1]["value"],"currency":train[-1]["currency"],"definition":train[-1]["definition"]})
known_cache={}
def known_at(origin,horizon):
    key=(origin,horizon)
    if key not in known_cache:
        known=[]
        for c in calibration:
            if c["origin"]>=origin or c["horizon"]!=horizon or c["currency"]!="BRL":continue
            target=available(development[c["issuer"]],c["target"],origin)
            if target and (target["currency"],target["definition"])==(c["currency"],c["definition"]):
                known.append({"id":c["id"],"issuer":c["issuer"],"error":abs(c["prediction"]-target["value"])/c["base"]})
        known_cache[key]=known
    return known_cache[key]


scored=0
for row in report["cases"]:
    rows=[r for r in test["observations"] if r["issuer"]==row["issuer"]]
    train=training(rows,row["origin"])
    target=available(rows,row["targetYear"],outcome_cutoff)
    reason="five_consecutive_available_positive_annuals_required" if len(train)<5 else "missing_retained_target" if not target else "changed_target_currency_or_definition" if (target["currency"],target["definition"])!=(train[-1]["currency"],train[-1]["definition"]) else None
    assert row["reason"]==reason
    if reason:assert row["status"]=="excluded";continue
    assert row["status"]=="scored";scored+=1
    assert row["trainingIds"]==[r["id"] for r in train]
    assert row["targetId"]==target["id"]
    close(row["base"],train[-1]["value"]);close(row["actual"],target["value"])
    prediction=path([r["value"] for r in train])[row["horizon"]-1]
    close(row["predictions"]["bounded_v3"],prediction)
    close(row["predictions"]["naive"],train[-1]["value"])
    legacy=train[-1]["value"];growth=(legacy/train[-2]["value"]-1)*100
    for h in range(row["horizon"]):legacy*=1+float(f"{growth*(1-h*.15):.2f}")/100
    close(row["predictions"]["legacy"],legacy)
    known=known_at(row["origin"],row["horizon"])
    recorded=report["calibrationPools"][row["calibrationPool"]]
    assert recorded["ids"]==[r["id"] for r in known]
    assert all(r["issuer"] in development for r in known)
    errors=sorted(r["error"] for r in known);rank=math.ceil((len(errors)+1)*.8)
    q=errors[rank-1] if len(errors)>=30 and len({r["issuer"] for r in known})>=10 and rank<=len(errors) else None
    assert (row["interval"] is None)==(q is None)
    if q is not None:
        close(row["interval"]["lower"],max(0,prediction-q*row["base"]))
        close(row["interval"]["upper"],prediction+q*row["base"])


qualified=[]
for summary in report["summaries"]:
    attempts=[r for r in report["cases"] if r["horizon"]==summary["horizon"]]
    valid=[r for r in attempts if r["status"]=="scored"]
    paired=[r for r in valid if all(p is not None for p in r["predictions"].values())]
    assert len(valid)==summary["scored"] and len(attempts)==summary["attempted"]
    macro={}
    for model in ("bounded_v3","naive","legacy","adaptive_v2"):
        groups=defaultdict(list)
        for r in paired:groups[r["issuer"]].append(abs(r["predictions"][model]-r["actual"])/r["base"])
        macro[model]=mean(mean(values) for values in groups.values())
        close(macro[model]*100,next(s["macroScaledAbsoluteErrorPercent"] for s in summary["scores"] if s["model"]==model))
    sectors=defaultdict(set)
    for r in paired:sectors[r["sector"]].add(r["issuer"])
    gates=[len({r["issuer"] for r in paired})>=30,len(paired)>=100,len(valid)/len(attempts)>=.6,sum(len(v)>=3 for v in sectors.values())>=6,macro["bounded_v3"]<=macro["legacy"]*.95,macro["bounded_v3"]<=macro["naive"]*1.05]
    assert gates==[g["pass"] for g in summary["gates"]]
    if all(gates):qualified.append(summary["horizon"])
    bands=[r for r in valid if r["interval"]]
    coverage=mean(r["interval"]["lower"]<=r["actual"]<=r["interval"]["upper"] for r in bands)
    width=median((r["interval"]["upper"]-r["interval"]["lower"])/r["base"]*100 for r in bands)
    close(coverage*100,summary["intervalCoveragePercent"]);close(width,summary["medianIntervalWidthPercent"])
    useful=len(bands)>=50 and coverage>=.75 and width<=200
    assert useful==(summary["intervalUsefulness"]=="passes_project_precision_gate")
assert qualified==report["qualifiedHorizons"]
print(json.dumps({"sourceObservationsVerified":len(test["observations"]),"attemptsVerified":len(report["cases"]),"scoredForecastsVerified":scored,"qualifiedHorizons":qualified,"bandsCutoffsAndGates":"passed"}))
