from __future__ import annotations

import httpx
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from .providers import cvm_facts
from .sec_policy import sec_access_status
from fastapi.responses import Response

from .models import RegulatoryRequest, RegulatorySnapshot, MarketShareRequest, MarketShareSnapshot, PresentationRequest
from .providers.sec_edgar import enrich_sec, resolve_sec_identifier
from .providers.cvm import enrich_cvm, resolve_cvm_identifier
from .providers.anp import enrich_anp_market_share
from .presentation import build_presentation
from .documents import AcquisitionRequest, acquire
from .research_deck import ResearchDeck, build_research_deck
from .ocr import OCRRequest, extract_ocr
from pypdf.errors import PdfReadError
import binascii
import os
import secrets
import asyncio
from .skills import run_ratios, run_statements, validate_timeline, status as skill_status

app = FastAPI(title="FilingLens Data Tools", version="1.3.0")

def corpus_auth(authorization):
    token=os.getenv('FILINGLENS_CORPUS_TOKEN','')
    if len(token)<32 or not secrets.compare_digest(authorization or '', 'Bearer '+token):
        raise HTTPException(status_code=401,detail='unauthorized')

@app.post('/v1/documents/acquire')
async def acquire_documents(req: AcquisitionRequest, authorization: str | None = Header(default=None)):
    corpus_auth(authorization)
    try: return await asyncio.wait_for(acquire(req),timeout=70)
    except asyncio.TimeoutError: return {'documents':[],'gaps':['Acquisition budget exhausted; retry a narrower year range.']}

@app.post('/v1/documents/ocr')
async def ocr_document(req: OCRRequest, authorization: str | None = Header(default=None)):
    corpus_auth(authorization)
    try:
        return await asyncio.wait_for(asyncio.to_thread(extract_ocr, req), timeout=80)
    except (ValueError, TimeoutError, OSError, PdfReadError, binascii.Error):
        raise HTTPException(status_code=422, detail='ocr_unavailable_or_insufficient') from None

@app.post('/v1/documents/presentation')
async def research_presentation(req: ResearchDeck, authorization: str | None = Header(default=None)):
    corpus_auth(authorization)
    raw=await asyncio.to_thread(build_research_deck,req)
    return Response(raw,media_type='application/vnd.openxmlformats-officedocument.presentationml.presentation')


def _provider_warning(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"Regulatory provider returned HTTP {exc.response.status_code} after bounded retries."
    if isinstance(exc, httpx.TimeoutException):
        return "Regulatory provider timed out after bounded retries."
    if isinstance(exc, httpx.TransportError):
        return "Regulatory provider had a transport failure after bounded retries."
    return f"Regulatory provider unavailable: {type(exc).__name__}"


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "filinglens-data-tools",
        "version": "1.3.0",
        "providers": {
            "sec": sec_access_status(),
            "cvm": "configured",
            "presentation": "configured",
            "anpMarketShare": "configured",
            "historyYears": 5,
            "httpRetryAttempts": 3,
            "staleCacheFallback": True,
        },
        "skills": skill_status(),
    }


@app.post("/v1/regulatory/enrich", response_model=RegulatorySnapshot)
async def regulatory_enrich(req: RegulatoryRequest):
    try:
        if req.jurisdiction == "us":
            cik = req.cik or await resolve_sec_identifier(req.ticker, req.companyName)
            if not cik:
                return RegulatorySnapshot(
                    status="identifier_missing",
                    jurisdiction="us",
                    provider="sec_edgar",
                    warnings=["CIK could not be resolved from the filing, ticker, or issuer name."],
                    historyRequested=req.historyYears,
                )
            return await enrich_sec(cik, req.filingType, req.historyYears)

        cnpj = req.cnpj or await resolve_cvm_identifier(req.companyName)
        if not cnpj:
            return RegulatorySnapshot(
                status="identifier_missing",
                jurisdiction="br",
                provider="cvm_open_data",
                warnings=["CNPJ could not be resolved from the filing or issuer name."],
                historyRequested=req.historyYears,
            )
        return await enrich_cvm(cnpj, req.reportingPeriod, req.filingType, req.historyYears)
    except HTTPException:
        raise
    except Exception as exc:
        return RegulatorySnapshot(
            status="unavailable",
            jurisdiction=req.jurisdiction,
            provider="sec_edgar" if req.jurisdiction == "us" else "cvm_open_data",
            warnings=[_provider_warning(exc)],
            historyRequested=req.historyYears,
        )


@app.post("/v1/market-share/anp", response_model=MarketShareSnapshot)
async def anp_market_share(req: MarketShareRequest):
    try:
        return await enrich_anp_market_share(req.companyName, req.cnpj, req.maxProducts)
    except Exception as exc:
        return MarketShareSnapshot(
            status="unavailable",
            provider="ANP SIMP",
            companyName=req.companyName,
            warnings=[f"ANP market-share provider unavailable: {type(exc).__name__}"],
            sourceUrl="https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp/paineis-dinamicos-do-abastecimento/painel-dinamico-do-mercado-brasileiro-de-combustiveis-liquidos",
        )


@app.post("/v1/skills/ratios")
async def ratios(payload: dict):
    try:
        return await run_ratios(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"ratios_skill_failed:{type(exc).__name__}") from exc


@app.post("/v1/skills/statements")
async def statements(payload: dict):
    try:
        return await run_statements(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"statements_skill_failed:{type(exc).__name__}") from exc


@app.post("/v1/skills/timeline")
async def timeline(payload: dict):
    try:
        return await validate_timeline(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"timeline_skill_failed:{type(exc).__name__}") from exc


@app.post("/v1/presentation")
async def presentation(req: PresentationRequest):
    try:
        raw, filename, quality = build_presentation(req.analysis, req.lang)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"presentation_generation_failed:{type(exc).__name__}") from exc
    return Response(
        raw,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-FilingLens-Presentation-Engine": "ppt-agent-planner/python-pptx",
            "X-FilingLens-Presentation-QA": f"{quality.verdict}; score={quality.score}",
        },
    )


class CvmFactsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["issuers", "facts", "screen"]
    cnpj: str | None = Field(default=None, max_length=18)
    form: Literal["DFP", "ITR"] = "DFP"
    year: int = Field(default=2025, ge=2010, le=2100)
    scope: Literal["consolidated", "standalone"] = "consolidated"
    offset: int = Field(default=0, ge=0, le=100000)
    limit: int = Field(default=50, ge=1, le=100)
    activeOnly: bool = True


@app.post("/v1/fundamentals/br")
async def brazil_fundamentals(req: CvmFactsQuery, authorization: str | None = Header(default=None)):
    corpus_auth(authorization)
    try:
        if req.operation == "issuers":
            return await asyncio.wait_for(cvm_facts.issuer_registry(req.offset, req.limit, req.activeOnly), 65)
        if req.operation == "facts":
            if not req.cnpj:
                raise ValueError("cnpj_required")
            return await asyncio.wait_for(cvm_facts.company_facts(req.cnpj, req.form, req.year, req.scope, req.offset, req.limit), 65)
        return await asyncio.wait_for(cvm_facts.screen(req.form, req.year, req.scope, req.offset, req.limit), 65)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="cvm_invalid_request_or_source") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=503, detail=f"cvm_http_{exc.response.status_code}") from None
    except (OSError, asyncio.TimeoutError, httpx.HTTPError):
        raise HTTPException(status_code=503, detail="cvm_source_unavailable") from None


@app.get("/v1/regulatory/access-status")
async def regulatory_access_status():
    return {"sec": sec_access_status(), "cvm": {"status": "available_adapter", "liveCoverageVerified": False}}
