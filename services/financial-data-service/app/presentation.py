from __future__ import annotations
from io import BytesIO
from typing import Any
from pptx import Presentation
from pptx.chart.data import ChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt

BG = RGBColor(8, 16, 29)
PANEL = RGBColor(17, 28, 48)
PANEL_2 = RGBColor(12, 22, 40)
BORDER = RGBColor(43, 59, 86)
WHITE = RGBColor(248, 250, 252)
MUTED = RGBColor(148, 163, 184)
CYAN = RGBColor(34, 211, 238)
BLUE = RGBColor(96, 165, 250)
GREEN = RGBColor(52, 211, 153)
AMBER = RGBColor(251, 191, 36)
ROSE = RGBColor(251, 113, 133)
VIOLET = RGBColor(167, 139, 250)
FONT = "Aptos"


def _clean(value: Any, fallback: str = "—") -> str:
    if value is None or value == "": return fallback
    return str(value)


def _series_latest(values: Any) -> float | None:
    if not isinstance(values, list): return None
    for value in reversed(values):
        if isinstance(value, (int, float)): return float(value)
    return None


def _money(value: float | None, jurisdiction: str) -> str:
    if value is None: return "—"
    prefix = "R$" if jurisdiction == "br" else "$"
    abs_value = abs(value)
    if abs_value >= 1_000_000_000:
        return f"{prefix}{value/1_000_000_000:,.1f}B"
    if abs_value >= 1_000_000:
        return f"{prefix}{value/1_000_000:,.1f}M"
    if abs_value >= 1_000:
        return f"{prefix}{value/1_000:,.1f}K"
    return f"{prefix}{value:,.1f}"


def _blank(prs: Presentation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.background.fill
    bg.solid(); bg.fore_color.rgb = BG
    return slide


def _textbox(slide, x, y, w, h, text, size=14, color=WHITE, bold=False, align=PP_ALIGN.LEFT, valign=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame; tf.clear(); tf.word_wrap = True; tf.vertical_anchor = valign
    p = tf.paragraphs[0]; p.text = str(text); p.alignment = align
    r = p.runs[0]; r.font.name = FONT; r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = color
    return box


def _rect(slide, x, y, w, h, fill=PANEL, line=BORDER, radius=True):
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    shp = slide.shapes.add_shape(shape_type, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = line
    if radius:
        try: shp.adjustments[0] = 0.08
        except Exception: pass
    return shp


def _title(slide, kicker, title, page=None):
    rule = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(0.05))
    rule.fill.solid(); rule.fill.fore_color.rgb = CYAN; rule.line.fill.background()
    _textbox(slide, .65, .28, 11.6, .25, kicker.upper(), 8.5, CYAN, True)
    _textbox(slide, .65, .60, 11.9, .55, title, 25, WHITE, True)
    if page is not None: _textbox(slide, 12.1, .34, .55, .25, str(page), 8, MUTED, False, PP_ALIGN.RIGHT)


def _footer(slide, text="Source: uploaded filing bundle and validated regulatory data."):
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(.65), Inches(7.04), Inches(12), Inches(.01))
    line.fill.solid(); line.fill.fore_color.rgb = BORDER; line.line.fill.background()
    _textbox(slide, .65, 7.08, 12, .18, text, 7, MUTED)


def _metric_card(slide, x, y, w, label, value, detail="", accent=CYAN):
    _rect(slide, x, y, w, 1.05, PANEL, BORDER)
    accent_shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(.05), Inches(1.05))
    accent_shape.fill.solid(); accent_shape.fill.fore_color.rgb = accent; accent_shape.line.fill.background()
    _textbox(slide, x+.18, y+.13, w-.30, .18, label.upper(), 7.5, MUTED, True)
    _textbox(slide, x+.18, y+.38, w-.30, .30, value, 18, WHITE, True)
    if detail: _textbox(slide, x+.18, y+.77, w-.30, .15, detail, 7, MUTED)


def _bullet_list(slide, items, x, y, w, max_items=5, color=WHITE, accent=CYAN, size=12):
    items = [str(i).strip() for i in (items or []) if str(i).strip()][:max_items]
    for idx, item in enumerate(items):
        top = y + idx*.67
        dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(top+.12), Inches(.08), Inches(.08))
        dot.fill.solid(); dot.fill.fore_color.rgb = accent; dot.line.fill.background()
        _textbox(slide, x+.20, top, w-.20, .55, item, size, color)


def _add_chart(slide, x, y, w, h, title, categories, series, chart_type=XL_CHART_TYPE.COLUMN_CLUSTERED):
    _rect(slide, x, y, w, h, PANEL_2, BORDER)
    _textbox(slide, x+.20, y+.15, w-.4, .25, title, 11, WHITE, True)
    if not categories or not series:
        _textbox(slide, x+.3, y+1.0, w-.6, .4, "No comparable series available", 10, MUTED, False, PP_ALIGN.CENTER)
        return
    normalized = []
    for name, values in series:
        if not isinstance(values, list) or len(values) != len(categories):
            continue
        normalized.append((name, [float(v) if isinstance(v, (int, float)) else 0 for v in values]))
    if not normalized:
        _textbox(slide, x+.3, y+1.0, w-.6, .4, "No comparable series available", 10, MUTED, False, PP_ALIGN.CENTER)
        return
    data = ChartData(); data.categories = [str(c) for c in categories]
    for name, values in normalized:
        data.add_series(name, values)
    chart = slide.shapes.add_chart(chart_type, Inches(x+.2), Inches(y+.55), Inches(w-.4), Inches(h-.75), data).chart
    chart.has_legend = len(normalized) > 1
    if chart.has_legend and chart.legend is not None:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
    chart.has_title = False
    chart.value_axis.has_major_gridlines = True
    chart.value_axis.major_gridlines.format.line.color.rgb = BORDER
    chart.category_axis.tick_labels.font.name = FONT; chart.category_axis.tick_labels.font.size = Pt(8); chart.category_axis.tick_labels.font.color.rgb = MUTED
    chart.value_axis.tick_labels.font.name = FONT; chart.value_axis.tick_labels.font.size = Pt(8); chart.value_axis.tick_labels.font.color.rgb = MUTED
    palette = [CYAN, BLUE, GREEN, VIOLET, AMBER]
    for idx, s in enumerate(chart.series):
        s.format.fill.solid(); s.format.fill.fore_color.rgb = palette[idx % len(palette)]
        s.format.line.color.rgb = palette[idx % len(palette)]


def build_presentation(analysis: dict[str, Any], lang: str = "en") -> tuple[bytes, str]:
    prs = Presentation()
    prs.slide_width = Inches(13.333333)
    prs.slide_height = Inches(7.5)
    while prs.slides:
        rId = prs.slides._sldIdLst[0].rId
        prs.part.drop_rel(rId); del prs.slides._sldIdLst[0]

    company = analysis.get("company") or {}
    financials = analysis.get("financials") or {}
    market = analysis.get("market") or {}
    risks = analysis.get("risks") or []
    events = analysis.get("events") or []
    summary = analysis.get("summary") or []
    diagnostics = analysis.get("diagnostics") or {}
    regulatory = analysis.get("regulatoryData") or {}
    jurisdiction = analysis.get("jurisdiction") or "us"
    name = _clean(company.get("name"), "Company")
    ticker = _clean(company.get("ticker"), "")
    form = _clean(company.get("filingType"), "Filing")
    period = _clean(company.get("periodEnd") or (analysis.get("metadata") or {}).get("reportingPeriod"), "")

    s = _blank(prs)
    _textbox(s, .75, .55, 3.4, .3, "FILINGLENS · COMPANY INTELLIGENCE", 9, CYAN, True)
    _textbox(s, .75, 1.35, 11.4, .8, name, 34, WHITE, True)
    _textbox(s, .75, 2.20, 11.0, .45, f"{ticker + ' · ' if ticker else ''}{form} · {period}", 15, MUTED)
    _rect(s, .75, 3.25, 11.85, 2.35, PANEL, BORDER)
    _textbox(s, 1.05, 3.55, 11.15, .3, "Decision-ready filing intelligence", 17, WHITE, True)
    _textbox(s, 1.05, 4.05, 10.9, 1.15, company.get("description") or "Regulatory filing analysis with authoritative structured-data cross-checks, source provenance, risk context, and financial validation.", 13, MUTED)
    _textbox(s, .75, 6.65, 11.8, .2, "Informational use only · filing-first · source-aware · generated by FilingLens", 8, MUTED)

    s = _blank(prs); _title(s, "Executive overview", "What matters from this filing", 2)
    _rect(s, .65, 1.35, 7.75, 5.2, PANEL, BORDER)
    _textbox(s, .9, 1.62, 7.2, .3, "KEY TAKEAWAYS", 9, CYAN, True)
    _bullet_list(s, summary or ["No supported executive summary was produced."], .95, 2.08, 7.05, 6, size=12)
    _rect(s, 8.65, 1.35, 4.05, 5.2, PANEL_2, BORDER)
    _textbox(s, 8.95, 1.62, 3.45, .3, "FILING SNAPSHOT", 9, BLUE, True)
    snapshot = [
        ("Jurisdiction", "CVM / Brazil" if jurisdiction == "br" else "SEC / United States"),
        ("Filing", form), ("Reporting period", period),
        ("Structured source", regulatory.get("provider") or "Not available"),
        ("Data status", regulatory.get("status") or "filing-only"),
    ]
    for i,(k,v) in enumerate(snapshot):
        _textbox(s, 8.95, 2.10+i*.70, 1.25, .18, k.upper(), 7, MUTED, True)
        _textbox(s, 10.20, 2.04+i*.70, 2.15, .28, v, 10, WHITE, True)
    _footer(s)

    years = financials.get("years") or []
    revenue = financials.get("revenue") or []
    net_income = financials.get("netIncome") or []
    ocf = financials.get("operatingCashFlow") or []
    cash = financials.get("cash") or []
    debt = financials.get("totalDebt") or []

    s = _blank(prs); _title(s, "Financial snapshot", "Latest reported metrics", 3)
    cards = [
        ("Revenue", _money(_series_latest(revenue), jurisdiction), "latest reported", CYAN),
        ("Net income", _money(_series_latest(net_income), jurisdiction), "latest reported", GREEN),
        ("Operating cash flow", _money(_series_latest(ocf), jurisdiction), "latest reported", BLUE),
        ("Cash", _money(_series_latest(cash), jurisdiction), "balance sheet", VIOLET),
        ("Total debt", _money(_series_latest(debt), jurisdiction), "balance sheet", AMBER),
    ]
    for i, card in enumerate(cards):
        _metric_card(s, .65+i*2.42, 1.45, 2.18, *card)
    _rect(s, .65, 2.85, 12.0, 3.6, PANEL_2, BORDER)
    _textbox(s, .9, 3.10, 11.4, .25, "Evidence discipline", 12, WHITE, True)
    evidence_copy = [
        "Regulatory structured data is treated as an authoritative cross-check, not an invisible overwrite.",
        "Uploaded filing evidence remains primary for narrative, risk and management-context interpretation.",
        "Conflicts and missing fields should remain visible instead of being silently reconciled by the model.",
    ]
    _bullet_list(s, evidence_copy, .95, 3.58, 11.1, 4, size=12, accent=GREEN)
    _footer(s)

    s = _blank(prs); _title(s, "Financial performance", "Scale, earnings and trajectory", 4)
    _add_chart(s, .65, 1.35, 6.0, 5.45, "Revenue", years, [("Revenue", revenue)], XL_CHART_TYPE.COLUMN_CLUSTERED)
    _add_chart(s, 6.85, 1.35, 5.8, 5.45, "Net income", years, [("Net income", net_income)], XL_CHART_TYPE.LINE_MARKERS)
    _footer(s)

    s = _blank(prs); _title(s, "Balance sheet & cash conversion", "Liquidity, leverage and cash generation", 5)
    _add_chart(s, .65, 1.35, 7.25, 5.45, "Cash flow profile", years, [("Operating cash flow", ocf), ("Capex", financials.get("capex") or [])], XL_CHART_TYPE.COLUMN_CLUSTERED)
    _rect(s, 8.15, 1.35, 4.5, 5.45, PANEL, BORDER)
    _metric_card(s, 8.42, 1.72, 3.95, "Cash", _money(_series_latest(cash), jurisdiction), "latest balance", GREEN)
    _metric_card(s, 8.42, 3.02, 3.95, "Debt", _money(_series_latest(debt), jurisdiction), "latest balance", AMBER)
    assets = _series_latest(financials.get("totalAssets") or [])
    equity = _series_latest(financials.get("totalEquity") or [])
    _metric_card(s, 8.42, 4.32, 3.95, "Assets / Equity", f"{_money(assets, jurisdiction)} / {_money(equity, jurisdiction)}", "capital structure", BLUE)
    _footer(s)

    s = _blank(prs); _title(s, "Market & operating context", "Where the company competes", 6)
    _rect(s, .65, 1.35, 4.0, 5.45, PANEL, BORDER)
    _textbox(s, .9, 1.62, 3.5, .25, "INDUSTRY", 9, CYAN, True)
    _textbox(s, .9, 2.00, 3.45, .7, market.get("industry") or "Not established from validated evidence", 15, WHITE, True)
    _textbox(s, .9, 3.0, 3.5, .25, "VERIFIED PEERS", 9, BLUE, True)
    _bullet_list(s, market.get("competitors") or ["No verified peers available"], .95, 3.35, 3.4, 5, size=10.5, accent=BLUE)
    _rect(s, 4.90, 1.35, 3.75, 5.45, PANEL_2, BORDER)
    _textbox(s, 5.15, 1.62, 3.25, .25, "OPERATING SEGMENTS", 9, GREEN, True)
    seg_items = [x.get("name") for x in (market.get("segments") or []) if isinstance(x, dict)]
    _bullet_list(s, seg_items or ["No validated segment series"], 5.2, 2.05, 3.1, 6, size=10.5, accent=GREEN)
    _rect(s, 8.90, 1.35, 3.75, 5.45, PANEL, BORDER)
    _textbox(s, 9.15, 1.62, 3.25, .25, "GEOGRAPHIES", 9, VIOLET, True)
    geo_items = [x.get("name") for x in (market.get("geographies") or []) if isinstance(x, dict)]
    _bullet_list(s, geo_items or ["No validated geographic series"], 9.2, 2.05, 3.1, 6, size=10.5, accent=VIOLET)
    _footer(s)

    s = _blank(prs); _title(s, "Principal risk factors", "Material risks disclosed in the filing", 7)
    risk_items = []
    for item in risks[:6]:
        if isinstance(item, dict): risk_items.append(f"{item.get('title','Risk')} — {item.get('summary','')}")
    _rect(s, .65, 1.35, 12.0, 5.45, PANEL, BORDER)
    _bullet_list(s, risk_items or ["No structured risk factors were captured."], .95, 1.75, 11.35, 6, size=11.5, accent=ROSE)
    _footer(s)

    s = _blank(prs); _title(s, "Timeline & material events", "Validated chronology", 8)
    _rect(s, .65, 1.35, 12.0, 5.45, PANEL_2, BORDER)
    if events:
        for i, item in enumerate(events[:7]):
            date = _clean(item.get("date"), "") if isinstance(item, dict) else ""
            title = _clean(item.get("title"), "Event") if isinstance(item, dict) else str(item)
            impact = _clean(item.get("impact"), "") if isinstance(item, dict) else ""
            _textbox(s, .95, 1.72+i*.67, 1.15, .25, date, 9, CYAN, True)
            _textbox(s, 2.05, 1.67+i*.67, 3.5, .30, title, 11, WHITE, True)
            _textbox(s, 5.55, 1.67+i*.67, 6.55, .42, impact, 9.5, MUTED)
    else:
        _textbox(s, .95, 2.1, 11.3, .4, "No validated events were captured.", 12, MUTED, False, PP_ALIGN.CENTER)
    _footer(s)

    s = _blank(prs); _title(s, "Data quality & controls", "What is complete, partial or unavailable", 9)
    module_names = ["metadata", "profiler", "financials", "market", "risks", "historian", "synthesizer"]
    for i, module in enumerate(module_names):
        diag = diagnostics.get(module) or {}
        status = diag.get("status") or "unknown"
        accent = GREEN if status in ("complete", "not_applicable") else AMBER if status == "incomplete" else ROSE
        x = .65 + (i % 4)*3.0; y = 1.45 + (i // 4)*1.50
        _rect(s, x, y, 2.75, 1.15, PANEL, BORDER)
        _textbox(s, x+.18, y+.18, 2.25, .22, module.upper(), 8, MUTED, True)
        _textbox(s, x+.18, y+.48, 2.25, .28, status.upper(), 12, accent, True)
        if diag.get("reason"): _textbox(s, x+.18, y+.80, 2.25, .22, str(diag.get("reason")).replace("_", " "), 7.5, MUTED)
    _rect(s, .65, 4.65, 12.0, 1.80, PANEL_2, BORDER)
    warnings = list(regulatory.get("warnings") or []) + list(analysis.get("missingData") or [])
    _bullet_list(s, warnings or ["No additional material data-quality warnings were reported."], .95, 4.95, 11.3, 3, size=10.5, accent=AMBER)
    _footer(s)

    s = _blank(prs); _title(s, "Sources & methodology", "Evidence hierarchy and presentation controls", 10)
    _rect(s, .65, 1.35, 5.85, 5.45, PANEL, BORDER)
    _textbox(s, .95, 1.68, 5.2, .25, "SOURCE HIERARCHY", 9, CYAN, True)
    hierarchy = [
        "1. SEC EDGAR / CVM structured regulatory data",
        "2. Uploaded regulatory filing bundle",
        "3. Optional citation-backed external research",
        "4. Derived metrics only when formulas and components are explicit",
    ]
    _bullet_list(s, hierarchy, 1.0, 2.05, 5.0, 5, size=11, accent=CYAN)
    _rect(s, 6.75, 1.35, 5.90, 5.45, PANEL_2, BORDER)
    _textbox(s, 7.05, 1.68, 5.3, .25, "POWERPOINT QA", 9, GREEN, True)
    qa = [
        "Generated server-side with python-pptx rather than handcrafted browser OOXML.",
        "Saved to a byte stream and reopened by python-pptx before delivery.",
        "Slide count, package readability and source provenance are checked deterministically.",
        "Microsoft PowerPoint visual rendering should still be validated on the recipient machine for consequential distribution.",
    ]
    _bullet_list(s, qa, 7.1, 2.05, 5.1, 5, size=10.8, accent=GREEN)
    _footer(s, "Method: filing-first extraction + authoritative structured-data cross-check + bounded specialist synthesis.")

    out = BytesIO(); prs.save(out); raw = out.getvalue()
    reopened = Presentation(BytesIO(raw))
    if len(reopened.slides) != len(prs.slides) or len(raw) < 5000 or raw[:2] != b"PK":
        raise RuntimeError("pptx_roundtrip_validation_failed")
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in name).strip("-") or "company"
    return raw, f"{safe}-FilingLens-Analysis.pptx"
