from __future__ import annotations

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

from .models import RegulatoryRequest, RegulatorySnapshot, MarketShareRequest, MarketShareSnapshot, PresentationRequest
from .providers.sec_edgar import enrich_sec, resolve_sec_identifier
from .providers.cvm import enrich_cvm, resolve_cvm_identifier
from .providers.anp import enrich_anp_market_share
from .presentation import build_presentation
from .skills import run_ratios, run_statements, validate_timeline, status as skill_status

app = FastAPI(title="FilingLens Data Tools", version="1.3.0")


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
            "sec": "configured",
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
