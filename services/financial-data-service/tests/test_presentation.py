from io import BytesIO

from pptx import Presentation

from app.presentation import build_presentation

SAMPLE = {
    "jurisdiction": "us",
    "company": {
        "name": "NVIDIA Corporation",
        "ticker": "NVDA",
        "filingType": "10-Q",
        "periodEnd": "2026-07-26",
        "description": "Accelerated computing platform company.",
    },
    "metadata": {"reportingPeriod": "2026-07-26"},
    "financials": {
        "unit": "USD millions",
        "years": ["Q1", "Q2"],
        "revenue": [44000, 46743],
        "netIncome": [25000, 26422],
        "operatingCashFlow": [18000, 21000],
        "capex": [3000, 3500],
        "cash": [32000, 34800],
        "totalDebt": [9000, 8500],
        "totalAssets": [190000, 206803],
        "totalEquity": [90000, 100000],
    },
    "market": {
        "industry": "AI infrastructure",
        "competitors": ["AMD", "Broadcom"],
        "segments": [],
        "geographies": [],
    },
    "risks": [{"title": "Supply concentration", "summary": "Advanced packaging capacity remains concentrated."}],
    "events": [{"date": "2026-08-26", "title": "Quarterly filing", "impact": "Updated financial and risk disclosures."}],
    "summary": ["Revenue expanded year over year.", "Cash generation remained strong."],
    "diagnostics": {
        "metadata": {"status": "complete"},
        "profiler": {"status": "complete"},
        "financials": {"status": "complete"},
        "market": {"status": "complete"},
        "risks": {"status": "complete"},
        "historian": {"status": "complete"},
        "synthesizer": {"status": "complete"},
    },
    "missingData": [],
    "regulatoryData": {"provider": "sec_edgar", "status": "complete", "warnings": []},
}


def _slide_text(slide) -> str:
    return "\n".join(shape.text for shape in slide.shapes if hasattr(shape, "text_frame") and shape.has_text_frame)


def test_pptx_roundtrip_and_financial_units():
    raw, filename = build_presentation(SAMPLE, "en")
    assert raw[:2] == b"PK"
    assert filename.endswith(".pptx")
    prs = Presentation(BytesIO(raw))
    assert len(prs.slides) == 10
    financial_snapshot = _slide_text(prs.slides[2])
    assert "$46.7B" in financial_snapshot
    assert "$46.7K" not in financial_snapshot
    assert "USD millions" in financial_snapshot


def test_pptx_portuguese_labels():
    raw, _ = build_presentation(SAMPLE, "pt")
    prs = Presentation(BytesIO(raw))
    overview = _slide_text(prs.slides[1])
    quality = _slide_text(prs.slides[8])
    assert "VISÃO EXECUTIVA" in overview
    assert "PRINCIPAIS CONCLUSÕES" in overview
    assert "QUALIDADE DOS DADOS E CONTROLES" in quality
