# GPI document integration

GPI owns the authenticated company/year document library. FilingLens extracts
full text without applying the analysis excerpt cap and accepts single-use
handoffs into the existing analysis confirmation screen. The existing six-module
analysis and financial PowerPoint export remain unchanged.

Server endpoints under `/api/integration/v1/documents/` require the dedicated
`FILINGLENS_CORPUS_TOKEN`: `extract`, `acquire` and `presentation`. The token must
match GPI and the private data-tools service. `GPI_API_URL` is the configured HTTPS
GPI origin for resolving handoffs; it is not selected by document text or users.
POST `/api/gpi-handoff` resolves an unguessable single-use ticket, never a raw owner
identifier. The ticket travels in a browser URL fragment and is removed before
the fetch. GPI atomically consumes it and scopes the document query to its owner.

Extraction: PDF, HTML, CSV or plain text; 8 MB input, 2 million characters, 1,000
PDF pages. Image-only PDFs with insufficient selectable text fall back to the
private OCRmyPDF/Tesseract service (English and Portuguese, at most 30 pages,
75 seconds, one worker, no document/model text in subprocess arguments or logs).
OCR is a derivative, not an assertion that every number, table or footnote is
correct; mixed text/image PDFs may still require manual review. The original
PDF remains authoritative. Hashes refer
to original received bytes; locators refer to the named text derivative, not PDF
pages. Imported identity/period labels are user assertions.

The Python acquisition adapter uses fixed SEC submissions/archive URLs or CVM
FRE/ITR/DFP/IPE archives and official RAD links. It preserves headers and versions
in company-filtered CVM derivatives and records the original archive digest.
It rejects redirects and unapproved hosts, bounds compressed/uncompressed sizes,
and serializes requests at no more than four starts per second per service
process. The current production data service has one replica; a distributed
limiter is needed before horizontal scaling. Provider denials remain gaps.
Apple FY2025 has one explicitly labeled issuer-PDF fallback.

GPI research decks reuse the existing python-pptx runtime: typed inputs, original
outline/layout code, exact quote validation, source/locator appendices, human-review
labels, pagination and package reopen checks. This follows the typed-pipeline idea
reviewed in tobias-bettinger/ppt-agent; no unlicensed upstream source was copied.
Financial analysis decks remain at `/api/presentation`.

Tests: document authentication, full-text preservation after 320,000 characters,
script removal/table boundaries, malformed/binary rejection, real boot routing,
CNPJ row isolation/version preservation, SEC URL construction, blocked network
destinations, and cited PPTX round-trip. Synthetic fixtures test controls; they do
not certify real financial statements or model interpretations.

OCR selection: OCRmyPDF (MPL-2.0) adds a PDF OCR layer/sidecar using Tesseract
(Apache-2.0); this fits the existing private Python Docker service without a new
GPU service. PaddleOCR (Apache-2.0) offers richer document layout parsing but
adds model/deployment overhead not justified by a measured table benchmark.
The sidecar provides text but no guaranteed table structure or confidence score.
Inputs are untrusted PDFs; the OCR subprocess is request-local, time/size/page
bounded and receives no application secrets in its environment. Do not treat OCR
output as deterministic financial evidence without checking the source image.

Deploy together with GPI's corpus consumer and additive PostgreSQL migration 003.
No MySQL corpus migration or vector service is required. Rollback by disabling
GPI's corpus/model flags; do not delete the retained document library.
