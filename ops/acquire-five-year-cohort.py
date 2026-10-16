"""Fresh issuer cohort for frozen protocol v3. Reuses exact-version CVM extraction."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import csv
import importlib.util
import io
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location("cvm_acquisition",Path(__file__).with_name("acquire-forecast-cohort.py"))
cvm=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cvm)


def collapse_identical_vintages(rows):
    unique={}
    for row in rows:
        existing=unique.get(row["id"])
        if existing is None:
            unique[row["id"]]={**row,"sourceDuplicateCount":1}
        elif all(existing[k]==row[k] for k in ("sourceRowSha256","sourceSha256","publishedOn","receipt")):
            existing["sourceDuplicateCount"]+=1
        else:
            raise ValueError("Conflicting retained vintage: "+row["id"])
    return list(unique.values())


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--cache",type=Path,required=True)
    args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    previous=json.loads(Path("public/evaluations/forecast-cohort-cvm.json").read_text())
    def acquire(year):
        filename=f"dfp_cia_aberta_{year}.zip"
        raw=cvm.download(f"{cvm.BASE}/DOC/DFP/DADOS/{filename}",args.cache/filename)
        result=cvm.extract_year(raw,year)
        print(f"Acquired official FY{year}",flush=True)
        return result
    base,manifest=acquire(2018)
    expected=next(m for m in previous["archives"] if m["year"]==2018)["sha256"]
    if manifest["sha256"]!=expected:raise ValueError("2018 archive changed; cannot silently alter the frozen eligibility universe")
    eligible=sorted({r["issuer"] for r in base if r["value"]>0 and r["publishedOn"]<="2019-06-30"},key=lambda code:cvm.digest(f"filinglens-forecast-v2:{code}".encode()))
    old={i["code"] for i in previous["cohort"]}
    if set(eligible[:60])!=old:raise ValueError("Development cohort identity changed")
    cohort=eligible[60:180]
    if len(cohort)!=120 or old.intersection(cohort):raise ValueError("Fresh 120-issuer holdout required")
    registry_url=f"{cvm.BASE}/CAD/DADOS/cad_cia_aberta.csv"
    raw_registry=cvm.download(registry_url,args.cache/"cad_cia_aberta.csv")
    registry={}
    for r in csv.DictReader(io.StringIO(raw_registry.decode("latin1")),delimiter=";"):
        code=str(int(r["CD_CVM"])) if r["CD_CVM"] else ""
        if code in cohort:registry[code]={"sector":r["SETOR_ATIV"] or "Unclassified","registryStatus":r["SIT"]}
    with ThreadPoolExecutor(max_workers=2) as executor:
        acquired=list(executor.map(acquire,[y for y in range(2010,2026) if y!=2018]))
    acquired.append((base,manifest))
    extracted=[r for rows,_ in acquired for r in rows if r["issuer"] in cohort]
    observations=collapse_identical_vintages(extracted)
    issuers=[]
    for code in cohort:
        row=next(r for r in base if r["issuer"]==code)
        issuers.append({"code":code,"name":row["name"],"selectionHash":cvm.digest(f"filinglens-forecast-v2:{code}".encode()),**registry.get(code,{"sector":"Unclassified","registryStatus":"Unknown"})})
    result={"schemaVersion":"forecast-cohort.cvm.v3-held-out","protocolCommit":"1d83c38","acquiredOn":date.today().isoformat(),
      "eligible2018Count":len(eligible),"selectionRange":[60,180],"cohort":issuers,
      "identicalDuplicateRowsCollapsed":len(extracted)-len(observations),
      "observations":sorted(observations,key=lambda r:(r["issuer"],r["fiscalYear"],r["publishedOn"])),
      "archives":sorted([m for _,m in acquired],key=lambda m:m["year"]),
      "registry":{"sourceUrl":registry_url,"sha256":cvm.digest(raw_registry),"labelsAsOf":date.today().isoformat()},
      "attribution":previous["attribution"]}
    output=Path("public/evaluations/five-year-cohort-cvm-v3.json")
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(f"Saved {len(observations)} observations for {len(issuers)} untouched issuers")


if __name__=="__main__":main()
