# FilingLens — Recreate This Project

Full-stack web app: attach a financial filing PDF (10-K/10-Q for US companies, FRE/DFP/ITR for Brazilian companies) and the site itself analyzes it with six specialized LLM agents and renders an interactive dashboard. Bilingual EN/PT.

## Architecture

```
Browser (React SPA)
  └─ src/pages/Home.tsx          client orchestrator: extract → 6 sequential POST /api/agent
                                  calls, retries each up to 3×, graceful degradation
  └─ src/components/Dashboard.tsx interactive dashboard (ECharts) from assembled JSON
  └─ api/ (Hono server, serverless-style, fully stateless)
       boot.ts                    POST /api/extract (PDF → text), POST /api/agent (one LLM call)
       analyze.ts                 extractFilingText (pdf-parse), buildAgentInput (per-agent
                                  section slicer), runAgent (single-attempt generateObject)
       engines.ts                 the six agent definitions (system prompts + token budgets)
       ai/provider.ts + lib/ai-client.ts   gateway client (model list, error classification)
       contracts/analysis.ts      zod schemas shared front/back — the JSON contract
```

Key design rules (learned from production failures):

1. **Never run long work in the background on a hosted runtime.** Every unit of work happens inside a short HTTP request; the server holds no state and the browser orchestrates.
2. **Per-request duration limit is real** (~60–120s on ingress). Each LLM call must stay well under it: send each agent only a *focused excerpt* of the filing (20–70K chars), keep output budgets tight, and make **one attempt per request** — retries live at the client, not inside the request.
3. **Graceful degradation**: a failed agent is skipped; the dashboard renders with the modules that succeeded plus a warning banner.
4. Terminal errors (quota exhausted, content rejected, misconfigured) abort early — they will fail every agent.
5. Section detection handles 10-K (Item 1/7/8) and 10-Q (Item 1/2/3) layouts and skips table-of-contents entries via `(?!\s*\d)` lookaheads.

## Agent pipeline (all calls through the LLM gateway, schema-validated JSON out)

| # | Agent | Input excerpt | Output schema |
|---|-------|---------------|---------------|
| 1 | profiler | Item 1 Business / cover (~45K) | company + KPIs |
| 2 | market | business section (~45K) | industry, competitors, geographies, segments |
| 3 | risks | Item 1A risk factors (~70K) | up to 15 ranked risks |
| 4 | financials | MD&A + statements (~75K) | revenue/income/margins/cash flows/debt, 3–4 periods |
| 5 | historian | business + MD&A (~50K) | timeline + material events |
| 6 | synthesizer | cover + MD&A (~40K) | executive summary bullets |

## Tools / stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind + shadcn/ui, ECharts, react-router
- **Backend**: Hono + tRPC (base scaffold), plain REST endpoints for the pipeline
- **LLM**: AI SDK (`ai` + `@ai-sdk/openai-compatible`, pinned versions) against an OpenAI-compatible gateway; credentials via server-side env (`KIMI_AGENTGW_BASE_URL`, `KIMI_AGENTGW_API_KEY`) — never exposed to the browser
- **PDF**: pdf-parse v1.1.1 — import from `pdf-parse/lib/pdf-parse.js` (the package entry has a debug-mode bug); a `.d.ts` shim is included
- **Validation**: zod v4 schemas in `contracts/analysis.ts`
- Structured output via `generateObject` + `supportsStructuredOutputs`; per-agent `max_completion_tokens` in `engines.ts`

## Setup in a new environment

```bash
npm install
# provide gateway env vars (server-side only):
#   KIMI_AGENTGW_BASE_URL, KIMI_AGENTGW_API_KEY
npm run build
NODE_ENV=production PORT=3000 node dist/boot.js
```

If you scaffold with the Kimi webapp/backend skills instead: init webapp-building, graft backend-building (`--features db` is not required by the pipeline — plain Hono endpoints suffice), copy `api/`, `contracts/`, `src/pages/Home.tsx`, `src/components/Dashboard.tsx` from this archive.

## The prompts

The production prompts live in `api/engines.ts` (six agent system prompts, EN+PT variants, terse-output rules, token budgets). The original standalone prompt documents this work started from are included in `prompts/`:

- `prompts/us-filing-analyzer-prompt.md` — US 10-K/10-Q analyzer
- `prompts/prompt-analisador-cvm-brasil.md` — Brazilian CVM analyzer (Portuguese)
- `prompts/filing-to-dashboard-prompt.md` — original prototype (P&G dashboard)

## Testing

`test-agents.sh` runs all six agents against an extracted filing text on a local server (expects `/tmp/extract.json` from `POST /api/extract`). Observed runtimes on a 150-page 10-Q: 17–57s per agent.
