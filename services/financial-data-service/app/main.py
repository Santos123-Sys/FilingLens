from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from .models import RegulatoryRequest, RegulatorySnapshot, PresentationRequest
from .providers.sec_edgar import enrich_sec
from .providers.cvm import enrich_cvm
from .presentation import build_presentation
from .skills import run_ratios, run_statements, validate_timeline, status as skill_status

app = FastAPI(title="FilingLens Data Tools", version="1.0.0")

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "filinglens-data-tools",
        "providers": {"sec": "configured", "cvm": "configured", "presentation": "configured"},
        "skills": skill_status(),
    }

@app.post("/v1/regulatory/enrich", response_model=RegulatorySnapshot)
async def regulatory_enrich(req: RegulatoryRequest):
    try:
        if req.jurisdiction == "us":
            if not req.cik:
                return RegulatorySnapshot(status="identifier_missing", jurisdiction="us", provider="sec_edgar", warnings=["CIK was not available; SEC structured-data enrichment was skipped."])
            return await enrich_sec(req.cik, req.filingType)
        if not req.cnpj:
            return RegulatorySnapshot(status="identifier_missing", jurisdiction="br", provider="cvm_open_data", warnings=["CNPJ was not available; CVM structured-data enrichment was skipped."])
        return await enrich_cvm(req.cnpj, req.reportingPeriod, req.filingType)
    except HTTPException:
        raise
    except Exception as exc:
        return RegulatorySnapshot(status="unavailable", jurisdiction=req.jurisdiction, provider="sec_edgar" if req.jurisdiction == "us" else "cvm_open_data", warnings=[f"Regulatory provider unavailable: {type(exc).__name__}"])

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
        raw, filename = build_presentation(req.analysis, req.lang)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"presentation_generation_failed:{type(exc).__name__}") from exc
    return Response(
        raw,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-FilingLens-Presentation-Engine": "python-pptx",
        },
    )
