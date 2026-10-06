from io import BytesIO
from pptx import Presentation
from app.presentation import build_presentation

SAMPLE = {
    "jurisdiction": "us",
    "company": {"name":"NVIDIA Corporation","ticker":"NVDA","filingType":"10-Q","periodEnd":"2026-07-26","description":"Accelerated computing platform company."},
    "metadata": {"reportingPeriod":"2026-07-26"},
    "financials": {"years":["Q1","Q2"],"revenue":[44000,46743],"netIncome":[25000,26422],"operatingCashFlow":[18000,21000],"capex":[3000,3500],"cash":[32000,34800],"totalDebt":[9000,8500],"totalAssets":[190000,206803],"totalEquity":[90000,100000]},
    "market": {"industry":"AI infrastructure","competitors":["AMD","Broadcom"],"segments":[],"geographies":[]},
    "risks": [{"title":"Supply concentration","summary":"Advanced packaging capacity remains concentrated."}],
    "events": [{"date":"2026-08-26","title":"Quarterly filing","impact":"Updated financial and risk disclosures."}],
    "summary": ["Revenue expanded year over year.","Cash generation remained strong."],
    "diagnostics": {"metadata":{"status":"complete"},"profiler":{"status":"complete"},"financials":{"status":"complete"},"market":{"status":"complete"},"risks":{"status":"complete"},"historian":{"status":"complete"},"synthesizer":{"status":"complete"}},
    "missingData": [],
    "regulatoryData": {"provider":"sec_edgar","status":"complete","warnings":[]},
}

def test_pptx_roundtrip():
    raw, filename = build_presentation(SAMPLE, "en")
    assert raw[:2] == b"PK"
    assert filename.endswith(".pptx")
    prs = Presentation(BytesIO(raw))
    assert len(prs.slides) == 10
