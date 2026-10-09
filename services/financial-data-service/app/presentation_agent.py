from __future__ import annotations

from enum import Enum
from math import isfinite
from typing import Any

from pydantic import BaseModel, Field, model_validator


class SlideType(str, Enum):
    TITLE = "title"
    KEY_TAKEAWAY = "key_takeaway"
    CONTENT = "content"
    CHART = "chart"
    TWO_COLUMN = "two_column"
    TIMELINE = "timeline"
    QUALITY = "quality"
    SOURCES = "sources"


class SlidePlan(BaseModel):
    slide_number: int = Field(ge=1)
    section: str = Field(min_length=1)
    slide_type: SlideType
    title: str = Field(min_length=1, max_length=140)
    purpose: str = Field(min_length=1)
    source_note: str = Field(min_length=1)
    speaker_notes: str = ""


class PresentationPlan(BaseModel):
    title: str = Field(min_length=1)
    subtitle: str = ""
    narrative_arc: str = Field(min_length=1)
    slides: list[SlidePlan] = Field(min_length=8, max_length=14)

    @model_validator(mode="after")
    def validate_sequence(self) -> "PresentationPlan":
        numbers = [slide.slide_number for slide in self.slides]
        sections = [slide.section for slide in self.slides]
        if numbers != list(range(1, len(self.slides) + 1)):
            raise ValueError("presentation_slide_numbers_must_be_sequential")
        if len(sections) != len(set(sections)):
            raise ValueError("presentation_sections_must_be_unique")
        return self

    def by_section(self, section: str) -> SlidePlan:
        return next(slide for slide in self.slides if slide.section == section)


class PresentationQualityReport(BaseModel):
    verdict: str
    score: int = Field(ge=0, le=100)
    checks: list[str]
    issues: list[str]


def _clip(value: Any, limit: int = 120) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _finite_series(values: Any) -> list[float]:
    if not isinstance(values, list):
        return []
    result: list[float] = []
    for value in values:
        if isinstance(value, (int, float)) and isfinite(float(value)):
            result.append(float(value))
    return result


def _trend_title(financials: dict[str, Any], lang: str) -> str:
    annual = financials.get("annualHistory") or {}
    years = annual.get("years") or financials.get("years") or []
    values = _finite_series(annual.get("revenue") or financials.get("revenue"))
    if len(years) >= 2 and len(values) == len(years) and values[0] != 0:
        change = (values[-1] / values[0] - 1) * 100
        direction = ("cresceu" if change >= 0 else "recuou") if lang == "pt" else ("rose" if change >= 0 else "fell")
        if lang == "pt":
            return f"A receita {direction} {abs(change):.1f}% entre {years[0]} e {years[-1]}"
        return f"Revenue {direction} {abs(change):.1f}% from {years[0]} to {years[-1]}"
    return "A trajetória financeira permanece vinculada aos períodos reportados" if lang == "pt" else "Financial trajectory remains tied to reported periods"


def _capital_title(financials: dict[str, Any], lang: str) -> str:
    annual = financials.get("annualHistory") or {}
    cash = _finite_series(annual.get("cash") or financials.get("cash"))
    debt = _finite_series(annual.get("totalDebt") or financials.get("totalDebt"))
    if cash and debt:
        if cash[-1] >= debt[-1]:
            return "O caixa reportado cobre a dívida total reportada" if lang == "pt" else "Reported cash covers reported total debt"
        return "A dívida total reportada excede o caixa reportado" if lang == "pt" else "Reported total debt exceeds reported cash"
    return "Liquidez, dívida e conversão de caixa em uma visão" if lang == "pt" else "Liquidity, debt and cash conversion in one view"


def plan_presentation(analysis: dict[str, Any], lang: str = "en") -> PresentationPlan:
    lang = "pt" if lang == "pt" else "en"
    company = analysis.get("company") or {}
    financials = analysis.get("financials") or {}
    market = analysis.get("market") or {}
    summary = [item for item in (analysis.get("summary") or []) if isinstance(item, str) and item.strip()]
    risks = [item for item in (analysis.get("risks") or []) if isinstance(item, dict)]
    events = [item for item in (analysis.get("events") or []) if isinstance(item, dict)]
    diagnostics = analysis.get("diagnostics") or {}
    incomplete = sum(1 for value in diagnostics.values() if isinstance(value, dict) and value.get("status") not in ("complete", "not_applicable"))
    name = _clip(company.get("name") or "Company", 80)
    form = _clip(company.get("filingType") or "Filing", 24)
    period = _clip(company.get("periodEnd") or (analysis.get("metadata") or {}).get("reportingPeriod") or "", 24)
    overview_title = _clip(summary[0], 130) if summary else ("O filing define a visão executiva disponível" if lang == "pt" else "The filing defines the available executive view")
    peers = [peer for peer in (market.get("competitors") or []) if isinstance(peer, str) and peer.strip()]
    segments = [item for item in (market.get("segments") or []) if isinstance(item, dict) and item.get("name")]
    competitive = market.get("competitiveAnalysis") or {}
    peer_profiles = len(competitive.get("peerProfiles") or [])

    if lang == "pt":
        if segments and peers:
            market_title = f"A operação abrange {len(segments)} segmentos e {len(peers)} pares verificados"
        elif segments:
            market_title = f"A operação abrange {len(segments)} segmento validado" if len(segments) == 1 else f"A operação abrange {len(segments)} segmentos validados"
        elif peers:
            market_title = f"A análise identifica {len(peers)} pares verificados enquanto faltam dados de segmentos"
        else:
            market_title = "Mercado e operação permanecem limitados à evidência validada"
        competition_title = f"A análise competitiva documenta {peer_profiles} perfil de par" if peer_profiles == 1 else f"A análise competitiva documenta {peer_profiles} perfis de pares"
        risk_title = f"O filing identifica {len(risks)} risco material estruturado" if len(risks) == 1 else f"O filing identifica {len(risks)} riscos materiais estruturados"
        event_title = f"A cronologia reúne {len(events)} evento validado" if len(events) == 1 else f"A cronologia reúne {len(events)} eventos validados"
        quality_title = f"{incomplete} módulos exigem atenção de qualidade" if incomplete else "Todos os módulos reportam conclusão ou não aplicabilidade"
        source = "Filings enviados e fontes validadas do FilingLens"
        narrative = "situação da companhia → desempenho → posição competitiva → riscos → qualidade da evidência"
    else:
        if segments and peers:
            market_title = f"Operations cover {len(segments)} segments and name {len(peers)} verified peers"
        elif segments:
            market_title = f"Operations cover {len(segments)} validated segment" if len(segments) == 1 else f"Operations cover {len(segments)} validated segments"
        elif peers:
            market_title = f"The analysis names {len(peers)} verified peers while segment data remains unavailable"
        else:
            market_title = "Market and operating context remains bounded by validated evidence"
        competition_title = f"Competitive analysis documents {peer_profiles} peer profile" if peer_profiles == 1 else f"Competitive analysis documents {peer_profiles} peer profiles"
        risk_title = f"The filing identifies {len(risks)} structured material risk" if len(risks) == 1 else f"The filing identifies {len(risks)} structured material risks"
        event_title = f"The chronology contains {len(events)} validated event" if len(events) == 1 else f"The chronology contains {len(events)} validated events"
        quality_title = f"{incomplete} modules require data-quality attention" if incomplete else "All modules report completion or non-applicability"
        source = "Uploaded filings and FilingLens-validated sources"
        narrative = "company situation → performance → competitive position → risks → evidence quality"

    definitions = [
        ("cover", SlideType.TITLE, name, "Identify the issuer, filing and period."),
        ("overview", SlideType.KEY_TAKEAWAY, overview_title, "State the supported executive message."),
        ("financial", SlideType.CONTENT, "Reported metrics establish the latest financial snapshot" if lang == "en" else "As métricas reportadas estabelecem o retrato financeiro mais recente", "Present latest reported metrics and evidence controls."),
        ("performance", SlideType.CHART, _trend_title(financials, lang), "Show comparable reported financial history."),
        ("cashflow", SlideType.CHART, _capital_title(financials, lang), "Explain liquidity, leverage and cash conversion."),
        ("market", SlideType.TWO_COLUMN, market_title, "Map operating segments, geographies and verified peers."),
        ("competition", SlideType.TWO_COLUMN, competition_title, "Summarize citation-backed peer positioning."),
        ("risks", SlideType.CONTENT, risk_title, "Present filing-derived risk factors."),
        ("events", SlideType.TIMELINE, event_title, "Order validated material events."),
        ("quality", SlideType.QUALITY, quality_title, "Expose completeness, conflicts and unavailable data."),
        ("sources", SlideType.SOURCES, "Evidence provenance remains visible throughout the deck" if lang == "en" else "A proveniência das evidências permanece visível em todo o deck", "Document source hierarchy and quality controls."),
    ]
    slides = [
        SlidePlan(
            slide_number=index,
            section=section,
            slide_type=slide_type,
            title=_clip(title, 140),
            purpose=purpose,
            source_note=source,
            speaker_notes=f"{purpose} Source: {source}. No unsupported facts may be added.",
        )
        for index, (section, slide_type, title, purpose) in enumerate(definitions, 1)
    ]
    return PresentationPlan(
        title=name,
        subtitle=" · ".join(value for value in (form, period) if value),
        narrative_arc=narrative,
        slides=slides,
    )


def evaluate_presentation(prs: Any, plan: PresentationPlan, raw: bytes) -> PresentationQualityReport:
    issues: list[str] = []
    checks = ["pptx_signature", "package_roundtrip", "slide_count", "action_titles", "quality_disclosure", "source_disclosure"]
    if raw[:2] != b"PK" or len(raw) < 5_000:
        issues.append("invalid_pptx_package")
    if len(prs.slides) != len(plan.slides):
        issues.append("slide_count_mismatch")
    for index, planned in enumerate(plan.slides):
        if index >= len(prs.slides):
            break
        text = "\n".join(shape.text for shape in prs.slides[index].shapes if hasattr(shape, "text"))
        if planned.title not in text:
            issues.append(f"missing_action_title:{planned.section}")
    sections = {slide.section for slide in plan.slides}
    if "quality" not in sections:
        issues.append("missing_quality_disclosure")
    if "sources" not in sections:
        issues.append("missing_source_disclosure")
    score = max(0, 100 - len(issues) * 20)
    return PresentationQualityReport(verdict="pass" if not issues else "fail", score=score, checks=checks, issues=issues)
