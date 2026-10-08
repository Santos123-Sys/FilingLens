import { executionRuntimeStatus, withExecutionScope, safeErrorName } from "./ai/execution";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { extractFilingText, BadFiling } from "./analyze";
import { agentManager } from "./agent-manager";
import { buildPrebuiltDashboardData } from "./dashboard-manager";
import { classifyFiling, metadataFallback } from "./classification";
import { modelRuntimeConfig } from "./ai/provider";
import { marketResearchSkillStatus } from "./market-research-skill";
import { dataToolsBinary, dataToolsConfigured, dataToolsJson } from "./data-tools-client";
import { persistPublicRegulatorySnapshot, readPublicRegulatorySnapshots } from "./regulatory-snapshot-store";
import { calculateValuation, prepareValuation, reconcileValuations, ValuationGateError, ValuationInputError } from "./valuation-manager";
import type {
  AgentName,
  FilingAnalysis,
  FilingClassification,
  Market,
  MarketResult,
  ValuationAssumption,
  ValuationMethod,
  DcfValuationResult,
  CompsValuationResult,
} from "../contracts/analysis";
import type { RegulatoryDataSnapshot } from "../contracts/regulatory-data";
import {
  AiUnavailable,
  ContentRejected,
  AiMisconfigured,
  AiInvalidRequest,
  AiTransient,
} from "./lib/ai-client";

const app = new Hono();

app.use(bodyLimit({ maxSize: 65 * 1024 * 1024 }));

const MODEL_ROUTES = new Set(["/api/metadata", "/api/agent", "/api/market-research", "/api/valuation/propose"]);
app.use("/api/*", async (c, next) => {
  if (!MODEL_ROUTES.has(c.req.path)) return next();
  const body = await c.req.json().catch(() => ({})) as { agent?: unknown };
  const stage = c.req.path === "/api/agent" && typeof body.agent === "string"
    ? body.agent : c.req.path.slice("/api/".length);
  return withExecutionScope(stage, c.req.header("X-FilingLens-Run-Id"), c.req.raw.signal, next);
});

const MAX_DOCUMENTS = 6;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;

function errStatus(err: unknown): { body: { error: string }; status: 400 | 403 | 422 | 500 | 503 } {
  if (err instanceof BadFiling) return { body: { error: err.message }, status: 422 };
  if (err instanceof AiUnavailable) return { body: { error: "ai_unavailable" }, status: 403 };
  if (err instanceof ContentRejected) return { body: { error: "content_rejected" }, status: 403 };
  if (err instanceof AiMisconfigured) return { body: { error: "ai_misconfigured" }, status: 500 };
  if (err instanceof AiInvalidRequest) return { body: { error: "ai_invalid_request" }, status: 422 };
  if (err instanceof AiTransient) return { body: { error: "ai_transient" }, status: 503 };
  console.error("request failed:", safeErrorName(err));
  return { body: { error: "internal" }, status: 500 };
}

function safeDocumentName(name: string): string {
  return name.replace(/[\r\n[\]]+/g, " ").trim().slice(0, 180) || "filing.pdf";
}

function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

function deterministicCik(text: string): string | null {
  const value = firstCapture(text.slice(0, 120_000), [
    /CENTRAL\s+INDEX\s+KEY\s*[:#]?\s*0*(\d{6,10})/i,
    /\bCIK\s*[:#]?\s*0*(\d{6,10})\b/i,
  ]);
  return value ? value.padStart(10, "0") : null;
}

function deterministicCnpj(text: string): string | null {
  const value = firstCapture(text.slice(0, 120_000), [
    /\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/,
    /\bCNPJ\s*[:#]?\s*(\d{14})\b/i,
  ]);
  return value ? value.replace(/\D/g, "") : null;
}

type PublicMarketShareSnapshot = {
  status: "complete" | "partial" | "unavailable" | "company_not_found" | "not_applicable";
  provider: string;
  companyName: string;
  matchedCompany?: string | null;
  period?: string | null;
  metrics: Array<{
    label: string;
    valuePercent: number;
    numerator: number;
    denominator: number;
    unit: string;
    period: string;
    geography: string;
    productScope: string;
    method: "direct_public_data" | "public_proxy";
    provider: string;
    companyMatch: string;
    caveat?: string | null;
    sourceUrl: string;
  }>;
  warnings: string[];
  sourceUrl: string;
};

function isBrazilFuelContext(
  jurisdiction: Market,
  text: string,
  marketResult: MarketResult,
  company?: FilingAnalysis["company"],
): boolean {
  if (jurisdiction !== "br") return false;
  const haystack = [
    marketResult.market.industry,
    company?.description ?? "",
    text.slice(0, 140_000),
  ].join("\n").toLowerCase();
  return /(combust[ií]ve|gasolina|diesel|etanol|lubrificant|distribui.{0,30}petr[oó]leo|posto[s]?\s+revendedor)/i.test(haystack);
}

function unavailableRegulatoryData(jurisdiction: Market, warning: string): RegulatoryDataSnapshot {
  return {
    status: "unavailable",
    jurisdiction,
    provider: jurisdiction === "us" ? "sec_edgar" : "cvm_open_data",
    company: {},
    metrics: [],
    sources: [],
    warnings: [warning],
    raw: {},
  };
}

/* ---- Step 0: extract text (CPU only, fast) ---- */
app.get("/api/status", (c) => c.json({
  configured: Boolean(process.env.OPENAI_API_KEY),
  ai: modelRuntimeConfig(),
  execution: executionRuntimeStatus(),
  dataTools: { configured: dataToolsConfigured() },
  skills: { marketResearch: marketResearchSkillStatus() },
  intake: { maxDocuments: MAX_DOCUMENTS, maxFileMb: 20, maxBundleMb: 60 },
}));

app.post("/api/extract", async (c) => {
  try {
    const form = await c.req.formData();
    const preferredMarket: Market | undefined = form.get("market") === "br"
      ? "br"
      : form.get("market") === "us" ? "us" : undefined;
    const files = form.getAll("file").filter((item): item is File => item instanceof File);
    if (files.length === 0) return c.json({ error: "no_file" }, 400);
    if (files.length > MAX_DOCUMENTS) return c.json({ error: "too_many_files" }, 400);
    const bundleBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (bundleBytes > MAX_BUNDLE_BYTES) return c.json({ error: "bundle_too_large" }, 413);

    const documents: Array<{ name: string; size: number; textChars: number; classification: FilingClassification }> = [];
    const texts: string[] = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (file.size > MAX_FILE_BYTES) return c.json({ error: "file_too_large" }, 413);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return c.json({ error: "unreadable_pdf" }, 422);
      const text = await extractFilingText(Buffer.from(bytes));
      const classification = classifyFiling(text, preferredMarket);
      const name = safeDocumentName(file.name);
      documents.push({ name, size: file.size, textChars: text.length, classification });
      texts.push(`\n[FILINGLENS_DOCUMENT ${index + 1}/${files.length}: ${name}]\n${text}\n[/FILINGLENS_DOCUMENT ${index + 1}]\n`);
    }

    const text = texts.join("\n");
    const classification = classifyFiling(text, preferredMarket);
    const crossJurisdiction = documents.some(doc => doc.classification.jurisdiction !== classification.jurisdiction);
    if (crossJurisdiction) classification.needsConfirmation = true;
    return c.json({ text, classification, documents, documentCount: documents.length });
  } catch (err) {
    const { body, status } = errStatus(err);
    return c.json(body, status);
  }
});

/* ---- Agent Manager: source slicing, agent order and output validation. ---- */
app.get("/api/analysis-plan", (c) => c.json(agentManager.plan()));

app.post("/api/metadata", async (c) => {
  try {
    const body = await c.req.json();
    const text = String(body.text || "");
    const classification = body.classification as FilingClassification;
    if (text.length < 2000 || !classification || !["br", "us"].includes(classification.jurisdiction)) {
      return c.json({ error: "bad_request" }, 400);
    }
    try {
      return c.json(await agentManager.runMetadata(classification.jurisdiction, text, classification));
    } catch (error) {
      if (error instanceof AiMisconfigured || error instanceof AiUnavailable || error instanceof ContentRejected) {
        throw error;
      }
      const reason = error instanceof AiTransient ? "metadata_ai_transient_fallback" : "metadata_agent_failed";
      console.warn(`[agent:metadata] degraded to deterministic fallback: ${reason}`);
      return c.json({
        result: { metadata: metadataFallback(classification) },
        diagnostic: {
          status: "incomplete",
          reason,
          confidence: classification.confidence,
          missing: ["model-derived metadata fields"],
        },
        manager: { stage: 0, totalStages: 7, agent: "metadata", excerptChars: Math.min(text.length, 50_000), attempts: 1 },
        evaluation: { schemaValid: true, completeness: "incomplete" },
      });
    }
  } catch (err) {
    const { body: eb, status } = errStatus(err);
    return c.json(eb, status);
  }
});

/* Deterministic authoritative cross-check. This never blocks filing analysis. */
app.post("/api/regulatory-data", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const jurisdiction: Market = body.jurisdiction === "br" ? "br" : "us";
  if (!dataToolsConfigured()) {
    return c.json(unavailableRegulatoryData(jurisdiction, "Private regulatory-data service is not configured; filing analysis continued."));
  }
  const text = typeof body.text === "string" ? body.text : "";
  const cik = typeof body.cik === "string" && body.cik.trim() ? body.cik : deterministicCik(text);
  const cnpj = typeof body.cnpj === "string" && body.cnpj.trim() ? body.cnpj : deterministicCnpj(text);
  try {
    const result = await dataToolsJson<RegulatoryDataSnapshot>("/v1/regulatory/enrich", {
      jurisdiction,
      filingType: typeof body.filingType === "string" ? body.filingType : undefined,
      reportingPeriod: typeof body.reportingPeriod === "string" ? body.reportingPeriod : undefined,
      cik,
      cnpj,
      companyName: typeof body.companyName === "string" ? body.companyName : undefined,
      ticker: typeof body.ticker === "string" ? body.ticker : undefined,
      historyYears: typeof body.historyYears === "number" ? Math.max(1, Math.min(5, Math.floor(body.historyYears))) : 5,
    });
    const registryFromFiling = jurisdiction === "us" ? deterministicCik(text) : deterministicCnpj(text);
    if (registryFromFiling) {
      try {
        await persistPublicRegulatorySnapshot(result,registryFromFiling);
      } catch (error) {
        console.warn("[regulatory-history] snapshot archive unavailable",safeErrorName(error));
      }
    }
    return c.json(result);
  } catch (error) {
    console.warn("[regulatory-data] enrichment unavailable; preserving filing-only analysis", safeErrorName(error));
    return c.json(unavailableRegulatoryData(jurisdiction, "Authoritative structured-data lookup was unavailable; filing evidence was preserved."));
  }
});

app.post("/api/agent", async (c) => {
  try {
    const body = await c.req.json();
    const agent = body.agent as AgentName;
    const market: Market = body.market === "br" ? "br" : "us";
    const text = String(body.text || "");
    const filingType = String(body.filingType || "");
    const filingDate = typeof body.filingDate === "string" ? body.filingDate : null;
    const priorResults = body.priorResults && typeof body.priorResults === "object" && !Array.isArray(body.priorResults)
      ? body.priorResults as Record<string, unknown> : undefined;
    if (!agentManager.plan().agents.includes(agent) || text.length < 2000) {
      return c.json({ error: "bad_request" }, 400);
    }
    const run = await agentManager.run(agent, market, text, {
      jurisdiction: market,
      filingType,
      filingDate,
      priorResults,
    });
    const { diagnostic } = run;
    if (diagnostic.status === "incomplete") {
      console.warn(`[agent:${agent}] returned incomplete data: ${diagnostic.reason}`);
    }
    return c.json(run);
  } catch (err) {
    const { body: eb, status } = errStatus(err);
    return c.json(eb, status);
  }
});

/* Optional stage: one bounded web-search model call, never nested inside /api/agent. */
app.post("/api/market-research", async (c) => {
  try {
    const body = await c.req.json();
    const jurisdiction: Market = body.jurisdiction === "br" ? "br" : "us";
    const text = String(body.text || "");
    const marketResult = body.marketResult as MarketResult;
    const company = body.company && typeof body.company === "object" ? body.company as FilingAnalysis["company"] : undefined;
    if (text.length < 2000 || !marketResult?.market) {
      return c.json({ error: "bad_request" }, 400);
    }

    const run = await agentManager.runMarketResearch(jurisdiction, text, marketResult, company);

    // Sector-specific public-data resolvers run independently from the LLM web
    // research lane. For Brazilian liquid fuels, ANP/SIMP provides a directly
    // auditable denominator and issuer numerator, so market share is computed
    // deterministically rather than inferred from prose.
    if (
      dataToolsConfigured()
      && company?.name
      && isBrazilFuelContext(jurisdiction, text, run.result, company)
    ) {
      try {
        const snapshot = await dataToolsJson<PublicMarketShareSnapshot>("/v1/market-share/anp", {
          companyName: company.name,
          cnpj: typeof body.cnpj === "string" ? body.cnpj : undefined,
          maxProducts: 4,
        });
        if (snapshot.metrics.length) {
          const anpShares = snapshot.metrics.map(metric => ({
            label: metric.label,
            valuePercent: metric.valuePercent,
            numerator: metric.numerator,
            denominator: metric.denominator,
            unit: metric.unit,
            period: metric.period,
            geography: metric.geography,
            productScope: metric.productScope,
            method: metric.method,
            provider: metric.provider,
            companyMatch: metric.companyMatch,
            caveat: metric.caveat ?? null,
            source: {
              section: "Public market-share proxy",
              kind: "citation" as const,
              url: metric.sourceUrl,
              publisher: "ANP",
              accessed: new Date().toISOString().slice(0, 10),
            },
          }));
          run.result.market.marketShares = [
            ...anpShares,
            ...(run.result.market.marketShares ?? []),
          ].slice(0, 8);
          run.diagnostic.warnings = [
            ...(run.diagnostic.warnings ?? []),
            "anp_public_volume_share_proxy",
          ];
          if (run.diagnostic.status !== "complete") {
            run.diagnostic.status = "complete";
            run.diagnostic.confidence = 0.88;
            run.diagnostic.reason = undefined;
          }
          run.manager.subtools.push("anp-simp-public-market-share");
        } else if (snapshot.warnings.length) {
          run.diagnostic.warnings = [
            ...(run.diagnostic.warnings ?? []),
            ...snapshot.warnings.map(() => "anp_market_share_unavailable"),
          ];
        }
      } catch (error) {
        console.warn("[market-share] ANP public-data proxy unavailable; preserving other market evidence", safeErrorName(error));
        run.diagnostic.warnings = [
          ...(run.diagnostic.warnings ?? []),
          "anp_market_share_provider_unavailable",
        ];
      }
    }

    // Promote independently verified generic public proxies found by web
    // research into the same auditable market-share contract.
    const publicProxies = run.result.market.competitiveAnalysis?.marketShareProxies ?? [];
    if (publicProxies.length) {
      const genericShares = publicProxies.map(proxy => ({
        label: proxy.label,
        valuePercent: proxy.valuePercent,
        numerator: proxy.numerator,
        denominator: proxy.denominator,
        unit: proxy.unit,
        period: proxy.period,
        geography: proxy.geography,
        productScope: proxy.productScope,
        method: "public_proxy" as const,
        provider: proxy.source.publisher ?? "Public source",
        companyMatch: company?.name ?? "Issuer",
        caveat: proxy.basis,
        source: proxy.source,
      }));
      run.result.market.marketShares = [
        ...(run.result.market.marketShares ?? []),
        ...genericShares,
      ].slice(0, 8);
    }

    return c.json(run);
  } catch (err) {
    const { body, status } = errStatus(err);
    return c.json(body, status);
  }
});

/* PowerPoint is generated by the private presentation-native Python service. */
app.post("/api/presentation", async (c) => {
  try {
    const body = await c.req.json();
    const analysis = body.analysis as FilingAnalysis;
    const lang = body.lang === "pt" ? "pt" : "en";
    if (!analysis?.company || !analysis?.financials) return c.json({ error: "bad_request" }, 400);
    if (!dataToolsConfigured()) return c.json({ error: "presentation_service_unavailable" }, 503);
    const upstream = await dataToolsBinary("/v1/presentation", { analysis, lang });
    if (!upstream.ok) {
      console.error("[presentation] data-tools rejected generation", upstream.status, await upstream.text().catch(() => ""));
      return c.json({ error: "presentation_generation_failed" }, 503);
    }
    const bytes = await upstream.arrayBuffer();
    const disposition = upstream.headers.get("Content-Disposition") ?? 'attachment; filename="FilingLens-Analysis.pptx"';
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
        "X-FilingLens-Presentation-Engine": upstream.headers.get("X-FilingLens-Presentation-Engine") ?? "python-pptx",
      },
    });
  } catch (error) {
    console.error("[presentation] generation failed", error);
    return c.json({ error: "presentation_generation_failed" }, 503);
  }
});

/* Valuation assumptions are prepared first and must be explicitly validated before calculation. */
app.post("/api/valuation/propose", async (c) => {
  try {
    const body = await c.req.json();
    const analysis = body.analysis as FilingAnalysis;
    const method = body.method as ValuationMethod;
    if (!analysis?.company || !analysis?.financials || !["dcf", "comps"].includes(method)) {
      return c.json({ error: "bad_request" }, 400);
    }
    return c.json({ proposal: await prepareValuation(analysis, method) });
  } catch (err) {
    if (err instanceof ValuationInputError) return c.json({ error: err.message }, 422);
    const { body, status } = errStatus(err);
    return c.json(body, status);
  }
});

app.post("/api/valuation/calculate", async (c) => {
  try {
    const body = await c.req.json();
    const analysis = body.analysis as FilingAnalysis;
    const method = body.method as ValuationMethod;
    const assumptions = Array.isArray(body.assumptions) ? body.assumptions as ValuationAssumption[] : [];
    if (!analysis?.company || !analysis?.financials || !["dcf", "comps"].includes(method) || !assumptions.length) {
      return c.json({ error: "bad_request" }, 400);
    }
    return c.json({ result: calculateValuation(analysis, method, assumptions) });
  } catch (err) {
    if (err instanceof ValuationGateError) {
      return c.json({ error: err.message, pending: err.pending }, 409);
    }
    if (err instanceof ValuationInputError) return c.json({ error: err.message }, 422);
    const { body, status } = errStatus(err);
    return c.json(body, status);
  }
});

app.post("/api/valuation/reconcile", async (c) => {
  try {
    const body = await c.req.json();
    const dcf = body.dcf as DcfValuationResult | undefined;
    const comps = body.comps as CompsValuationResult | undefined;
    return c.json({ reconciliation: reconcileValuations(dcf, comps) });
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
});

/* The template manager turns agent JSON into a fixed-dashboard binding only. */
app.post("/api/dashboard-data", async (c) => {
  try {
    const body = await c.req.json();
    const analysis = body.analysis as FilingAnalysis;
    if (!analysis?.company || !analysis?.financials) {
      return c.json({ error: "bad_request" }, 400);
    }
    return c.json({ dashboard: buildPrebuiltDashboardData(analysis) });
  } catch (err) {
    const { body, status } = errStatus(err);
    return c.json(body, status);
  }
});

/* Public access is restricted to verified SEC/CVM-derived structured facts only. */
app.get("/api/regulatory-history/:jurisdiction/:registryId",async c=>{
  const jurisdiction=c.req.param("jurisdiction");
  if(jurisdiction!=="us" && jurisdiction!=="br")return c.json({error:"invalid_jurisdiction"},400);
  try {
    const snapshots=await readPublicRegulatorySnapshots(jurisdiction,c.req.param("registryId"));
    c.header("Cache-Control","no-store");
    return c.json({jurisdiction,registryId:c.req.param("registryId"),snapshots});
  }catch(error){
    console.warn("[regulatory-history] retrieval unavailable",safeErrorName(error));
    return c.json({error:"regulatory_history_unavailable"},503);
  }
});
app.all("/api/*", async (c, next) => {
  // Railway registers internal history routes after importing this shared app.
  // Let only those requests continue to the Node-only handlers.
  if (c.req.path.startsWith("/api/internal/history/")) return next();
  return c.json({ error: "Not Found" }, 404);
});

export default app;