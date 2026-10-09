# Retrieval evidence coverage and source binding

Baseline: `d2671a69939076bc353176fd7b2e62338c3f89cd` (main inspected 2026-10-09). This change improves the existing request-local excerpt selector and quote validation. It does not introduce a persistent document knowledge base, vector service, embedding model, database migration, or extra analysis agent.

## Current architecture and confirmed defects

`api/boot.ts` accepts up to six text-based PDFs, 20 MB each / 60 MB combined. `api/pdf.ts` extracts text; `api/analyze.ts` compacts each long document to 320,000 characters, then constructs bounded module-specific windows from SEC/CVM headings. The browser coordinates metadata and six modules through `api/agent-manager.ts`. `contracts/analysis.ts` validates typed outputs; financial and segment validators provide deterministic reconciliation. React/Vite dashboards and exports consume those contracts. Optional private MySQL history stores selected analysis data; it is not a retained PDF/embedding corpus. Railway serves the Node/Hono build; the repository also produces a Worker artifact.

Confirmed selector defects:

1. First-N matching headings can use all windows on early contents aliases and omit the actual late body section.
2. Selected windows were joined before the family's quota was applied, so the final truncation discarded later windows even if they had been retrieved.
3. Deduplication used only the first 240 characters, so distinct source families with a shared prefix could be dropped.
4. Bundle body quotas did not reserve document-label/separator overhead. The final joined slice could clip the final document's tail.
5. Short documents could duplicate overlapping cover, statement and tail text unnecessarily.

Confirmed evidence-validation limitation: `validateMarketOutput` required a nonempty quote and section but did not check that the quote occurred in the actual excerpt. The managed filing lane now supplies that excerpt for deterministic whitespace-normalized quote resolution. This validates quote existence, **not** claim entailment, issuer association, or the financial interpretation of a quote.

## Architecture decision

| Option | Decision | Rationale |
|---|---|---|
| Existing section-window optimization | Selected | Recovers demonstrated missing evidence inside existing contracts and deployment |
| Existing DB/lexical retrieval | Deferred | No persistent filing corpus or ranked-query requirement was established for this change |
| Dense/lexical hybrid + Qdrant | Deferred | Missing evidence is explained by bounded selection, not demonstrated semantic matching failures |
| Local Sentence Transformers / cross-encoder | Deferred | No labeled bilingual ranking baseline or measured hosting benefit justifies a new inference component |

The reusable `filinglens-rag-architect-executor` skill independently covers those alternatives, conditional Qdrant and Sentence Transformers integration, financial integrity, provenance, privacy, evaluation, delivery and recovery. It was structurally validated, its ranking helper executed on valid/invalid inputs, independently forward-tested, and published to the user's Skills workspace.

## Implemented behavior and compatibility

Preserve selected windows as separate units until quota allocation; distribute oversubscribed heading positions across the document, retaining the first and last positions. Preserve the previous latest-N selection for explicitly tail-focused searches. Deduplicate complete parts. Allocate bundle header/separator overhead first, and then allocate remaining source text fairly. Use a direct single copy when a document fits its module quota.

Application-generated document labels now include a SHA-256 identity for the normalized text supplied to that selector. This is a stable derivative identity, **not** an original PDF hash, authentication proof, PDF page locator, chunk index or cross-tenant authorization. The selector continues to process only request-supplied text and does not persist or transmit embeddings. Headers and hashes are returned within that same request scope and are not logged.

The common instructions used by every module identify source text as untrusted evidence, prohibit following embedded instructions, and distinguish application source labels from filing facts. This is prompt hardening; it is not proof of model-level injection resistance. Financial values continue through existing deterministic validators and issuer/SEC source distinctions. No schema migration or ratio formula change is required. Dashboard, bilingual and export contracts remain intact.

## Baseline and results

Acceptance for this slice: recover every expected evidence string in the frozen stress cases; preserve the public issuer table strings; remain within existing hard character budgets; reject fabricated market quotes; keep existing numerical/source guards passing. These are observable regression criteria, not invented production SLOs.

Results and exact CPU timings: [`evaluations/rag-excerpt-coverage.json`](evaluations/rag-excerpt-coverage.json).

| Case | Source category | Expected evidence retained before → after |
|---|---|---|
| Apple FY2025 public statement | Genuine issuer-published unaudited PDF, four pages | 5/5 → 5/5 |
| SEC-style late body after contents aliases | Synthetic English stress fixture | 0/2 → 2/2 |
| CVM-style late segment after contents aliases | Synthetic Portuguese stress fixture | 0/1 → 1/1 |
| Separated financial statements | Synthetic long filing fixture | 2/2 → 2/2 |
| Missing segment amounts | Synthetic negative input | No expected strings; not an abstention accuracy measurement |

Apple's text was extracted with `pdf-parse 1.1.1` from the fixed public URL in the fixture. The original PDF SHA-256 is retained. The existing deterministic verifier also matched annual revenue 416,161; gross profit 195,201; operating income 133,050; and net income 112,010 (USD millions), and rejected wrong amount, issuer and fiscal-year controls. These are issuer-published statement checks; none is SEC CompanyFacts verification. The fixture represents public financial facts, not a private upload.

Each case ran 100 selector iterations on this development container. The public statement prompt decreased from 17,389 to 9,477 characters. Long stress cases retain more evidence and generally require more CPU/context than the old truncated selector. Recorded p95 values are development measurements, not production latency or universal performance gains. No LLM calls were made by these tests, so actual inference tokens/cost, claim support and model abstention remain unmeasured. No real CVM or complete SEC-filed corpus, independent ranked relevance labels or held-out end-to-end model evaluation was established.

Reproduce current measurements:

```bash
RETRIEVAL_EVALUATION_OUTPUT=/tmp/retrieval-current.json npm test -- api/retrieval-evaluation.test.ts
npm test
npm run check
npm run lint
npm run build
```

To reproduce the baseline, run the same evaluation file/fixture against the baseline commit in a separate worktree, omitting only its post-change evidence-coverage assertion. Keep queries, source text, budgets and iteration count identical. `api/retrieval.test.ts` adds separate regression scenarios for eight aliases, shared-prefix families, all six document tails, stable identities, and short-source deduplication.

Local validation: 102 API tests pass across 23 files; typecheck and production build pass; changed/new retrieval test and validator files pass scoped lint. Full lint reports the same 33 error descriptions/rules as a detached baseline worktree. CI marks its existing lint baseline nonblocking. The build retains its existing large-client-bundle warning. These baseline issues were not expanded into unrelated refactoring.

## Rollout, deployment and rollback

Open a feature PR and verify CI at its exact head. Do not merge without authorization under this invocation's brief. Main production stays on its existing branch and deployed commit. If preview verification is possible, use the existing skill-preview service and record terminal status separately from runtime/HTTP evidence; its current lack of a public domain must not be solved by silently exposing it publicly.

No database or infrastructure change is required. Rollback consists of reverting this PR's code commit or restoring the previous app deployment; source corpus/history schema is unchanged. If preview source is changed, restore its previously observed branch `feature/full-skill-runtime-enrichment` when abandoning the preview. Future index/model integrations need an independent migration, privacy and rollback plan.

## Completion boundaries

| Brief phase | Status at PR preparation |
|---|---|
| 1: source/repository inspection | Completed for inspected retrieval integration |
| 2: baseline | Partial: real issuer statement and synthetic regressions; broader SEC/CVM relevance corpus absent |
| 3: architecture selection | Completed for measured excerpt defects |
| 4: reusable skill | Completed and published |
| 5: implementation | Completed for this selected retrieval/source-binding slice |
| 6: evaluation | Partial: deterministic/regression checks pass; full model/held-out/privacy adversarial evaluation unmeasured |
| 7: integration/deployment | Pending CI and preview evidence; merge/production rollout not performed |
| 8: reporting | This ADR and the PR provide reproducible evidence and explicit limitations |
