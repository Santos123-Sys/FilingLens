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
        "annualHistory": {
            "years": ["FY2022", "FY2023", "FY2024", "FY2025", "FY2026"],
            "unit": "USD millions",
            "provider": "sec_edgar",
            "status": "complete",
            "revenue": [26974, 26974, 60922, 130497, 208000],
            "grossProfit": [17475, 15356, 44301, 97858, 150000],
            "ebit": [10041, 4224, 32972, 81453, 125000],
            "netIncome": [9752, 4368, 29760, 72880, 110000],
            "operatingCashFlow": [9108, 5641, 28090, 64089, 99000],
            "capex": [976, 1072, 1069, 3247, 5000],
            "totalAssets": [44187, 41182, 65728, 111601, 180000],
            "totalLiabilities": [17575, 19081, 22750, 32274, 50000],
            "totalEquity": [26612, 22101, 42978, 79327, 130000],
            "totalDebt": [10946, 10953, 9709, 8463, 8000],
            "cash": [21208, 13296, 25984, 43210, 60000],
            "sources": [],
        },
    },
    "market": {
        "industry": "AI infrastructure",
        "competitors": ["AMD", "Broadcom"],
        "segments": [],
        "geographies": [],
        "competitiveAnalysis": {
            "status": "complete",
            "methodology": "market-research-brief",
            "peerProfiles": [
                {
                    "name": "AMD",
                    "relationship": "Direct accelerated-computing competitor",
                    "positioning": "Competes across data-center accelerators and platform software.",
                    "strengths": ["Broad CPU/GPU portfolio"],
                    "vulnerabilities": ["Smaller accelerator ecosystem"],
                    "source": {"section": "Independent competitive research", "kind": "citation", "url": "https://example.com/amd", "publisher": "Example", "accessed": "2026-10-07"},
                }
            ],
            "findings": [
                {
                    "insight": "Competition is increasingly platform-led rather than chip-only.",
                    "implication": "Software ecosystem depth is a durable competitive variable.",
                    "source": {"section": "Independent competitive research", "kind": "citation", "url": "https://example.com/platform", "publisher": "Example", "accessed": "2026-10-07"},
                }
            ],
            "marketStructure": {
                "summary": "The market is concentrated among a small number of scaled accelerator vendors.",
                "hhi": None,
                "basis": None,
                "source": {"section": "Independent competitive research", "kind": "citation", "url": "https://example.com/market", "publisher": "Example", "accessed": "2026-10-07"},
            },
        },
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
    assert len(prs.slides) == 11
    financial_snapshot = _slide_text(prs.slides[2])
    assert "$46.7B" in financial_snapshot
    assert "$46.7K" not in financial_snapshot
    assert "USD millions" in financial_snapshot
    performance = _slide_text(prs.slides[3])
    competitive = _slide_text(prs.slides[6])
    assert "FY2022" in performance and "FY2026" in performance
    assert "AMD" in competitive
    assert "Competition is increasingly platform-led" in competitive


def test_pptx_portuguese_labels():
    raw, _ = build_presentation(SAMPLE, "pt")
    prs = Presentation(BytesIO(raw))
    overview = _slide_text(prs.slides[1])
    quality = _slide_text(prs.slides[9])
    assert "VISÃO EXECUTIVA" in overview
    assert "PRINCIPAIS CONCLUSÕES" in overview
    assert "QUALIDADE DOS DADOS E CONTROLES" in quality
