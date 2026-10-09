# FilingLens Data Tools

Private Railway service for deterministic financial-data retrieval, normalization and PowerPoint generation.

## Responsibilities
- SEC EDGAR `submissions` + `companyfacts` enrichment for US issuers.
- CVM Dados Abertos DFP/ITR retrieval for Brazilian issuers.
- Normalized, provenance-carrying metric snapshots for FilingLens agents.
- Server-side `.pptx` generation with a typed PPT Agent-inspired planner, `python-pptx` rendering,
  speaker notes, action titles and an enforceable post-build quality report.
- Private execution boundary for the existing exact Python ratio, statement-analysis, and timeline skills.

## Endpoints
- `GET /health`
- `POST /v1/regulatory/enrich`
- `POST /v1/presentation`
- `POST /v1/skills/ratios`
- `POST /v1/skills/statements`
- `POST /v1/skills/timeline`

## Runtime variables
- `SEC_USER_AGENT` — identifies FilingLens to SEC EDGAR; default includes the FilingLens repository URL.
- `PORT` — Railway-provided port.

The service is intended to remain private on Railway. FilingLens proxies browser requests through its public Node API. In production the main Node service should set `FINANCIAL_DATA_SERVICE_URL` to the private Railway address for this service.
