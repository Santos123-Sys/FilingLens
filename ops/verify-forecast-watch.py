"""Independent offline check of the fixed forward cohort and every frozen path."""
import hashlib
import json
import math
from pathlib import Path
from statistics import median

root=Path(__file__).resolve().parents[1]
def read(path):return json.loads((root/path).read_text())
record=read('public/evaluations/forecast-watch-v1.json')['payload']
source=read('public/evaluations/five-year-cohort-cvm-v3.json')
score=read('public/evaluations/forecast-watch-score-v1.json')
policy=read('src/data/forecast-reliability-policy.json')
assert record['sourceDatasetSha256']==hashlib.sha256((root/'public/evaluations/five-year-cohort-cvm-v3.json').read_bytes()).hexdigest()
assert record['predictorSha256']==hashlib.sha256((root/'contracts/five-year-forecast.ts').read_bytes()).hexdigest()
assert record['cohort']==[i['code'] for i in source['cohort']]
assert len(record['cohort'])==120
forecasts={f['issuer']:f for f in record['forecasts']}
excluded={e['issuer']:e for e in record['exclusions']}
assert not forecasts.keys()&excluded.keys()
assert forecasts.keys()|excluded.keys()==set(record['cohort'])
count=0
for issuer in record['cohort']:
    rows=[r for r in source['observations'] if r['issuer']==issuer]
    training=[]
    for year in range(2025,1999,-1):
        available=[r for r in rows if r['fiscalYear']==year and r['publishedOn']<record['sourceCutoff'] and r['periodEnd']<record['sourceCutoff']]
        last=max(available,key=lambda r:r['publishedOn']) if available else None
        if not last or last['value']<=0 or (training and (last['currency'],last['definition'])!=(training[0]['currency'],training[0]['definition'])):break
        training.insert(0,last)
    if len(training)<5:
        assert excluded[issuer]['reason']=='five_consecutive_available_positive_annuals_required'
        continue
    f=forecasts[issuer]
    assert f['trainingIds']==[r['id'] for r in training]
    assert f['base']==training[-1]['value'] and f['currency']==training[-1]['currency']
    recent=[r['value'] for r in training[-6:]]
    log_growth=max(math.log(.8),min(math.log(1.25),median(math.log(b)-math.log(a) for a,b in zip(recent,recent[1:]))))
    revenue=recent[-1]
    for i,row in enumerate(f['rows']):
        rate=float(f'{math.expm1(log_growth*.8**i)*100:.6f}')
        revenue*=1+rate/100
        assert math.isclose(row['prediction'],revenue,rel_tol=1e-10)
        assert row['horizon']==i+1 and row['targetYear']==2026+i
        if i>=2:assert row['interval'] is None
        count+=1
assert count==455 and len(forecasts)==91 and len(excluded)==29
assert len(score['cases'])==455 and all(r['status']=='pending_outcome' for r in score['cases'])
assert all(s['fixedAttempts']==120 and s['scored']==0 and s['macroScaledAbsoluteErrorPercent'] is None for s in score['summaries'])
assert score['futureAccuracyProven'] is False
assert [r['horizon'] for r in policy['summaries'] if r['intervalUsefulness']=='passes_project_precision_gate']==[1,2]
print(json.dumps({'independentFrozenPaths':count,'fixedIssuers':120,'eligible':91,'excluded':29,'pendingOutcomes':455,'qualifiedFutureAccuracy':False}))
