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
    historyYears: int = Field(default=5, ge=1, le=5)

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
    fiscalYear: int | None = None
    statementType: Literal["annual", "interim", "instant"] | None = None
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
    coverageYears: list[str] = Field(default_factory=list)
    historyRequested: int = 5
    resolvedIdentifier: str | None = None

class MarketShareRequest(BaseModel):
    companyName: str
    cnpj: str | None = None
    maxProducts: int = Field(default=4, ge=1, le=6)

class MarketShareMetric(BaseModel):
    label: str
    valuePercent: float
    numerator: float
    denominator: float
    unit: str
    period: str
    geography: str = "Brazil"
    productScope: str
    method: Literal["direct_public_data", "public_proxy"] = "direct_public_data"
    provider: str
    companyMatch: str
    caveat: str | None = None
    sourceUrl: str

class MarketShareSnapshot(BaseModel):
    status: Literal["complete", "partial", "unavailable", "company_not_found", "not_applicable"]
    provider: str
    companyName: str
    matchedCompany: str | None = None
    period: str | None = None
    metrics: list[MarketShareMetric] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    sourceUrl: str

class PresentationRequest(BaseModel):
    analysis: dict[str, Any]
    lang: Literal["en", "pt"] = "en"
