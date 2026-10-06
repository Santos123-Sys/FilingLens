from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field

Jurisdiction = Literal["us", "br"]

class RegulatoryRequest(BaseModel):
    jurisdiction: Jurisdiction
    filingType: str | None = None
    reportingPeriod: str | None = None
    cik: str | None = None
    cnpj: str | None = None
    companyName: str | None = None
    ticker: str | None = None

class SourceRef(BaseModel):
    provider: str
    sourceType: str = "regulatory_api"
    url: str
    retrievedAt: str
    form: str | None = None
    period: str | None = None

class Metric(BaseModel):
    key: str
    value: float | None = None
    unit: str | None = None
    period: str | None = None
    status: Literal["verified", "single_source", "conflict", "missing"] = "single_source"
    source: SourceRef | None = None
    rawLabel: str | None = None
    rawCode: str | None = None

class RegulatorySnapshot(BaseModel):
    status: Literal["complete", "partial", "unavailable", "identifier_missing", "not_applicable"]
    jurisdiction: Jurisdiction
    provider: str
    company: dict[str, Any] = Field(default_factory=dict)
    metrics: list[Metric] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)

class PresentationRequest(BaseModel):
    analysis: dict[str, Any]
    lang: Literal["en", "pt"] = "en"
