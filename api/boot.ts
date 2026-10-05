import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { extractFilingText, BadFiling } from "./analyze";
import { agentManager } from "./agent-manager";
import { buildPrebuiltDashboardData } from "./dashboard-manager";
import { classifyFiling, metadataFallback } from "./classification";
import { modelRuntimeConfig } from "./ai/provider";
import type {
  AgentName,
  FilingAnalysis,
  FilingClassification,
  Market,
  MarketResult,
} from "../contracts/analysis";
import {
  AiUnavailable,
  ContentRejected,
  AiMisconfigured,
  AiTransient,
} from "./lib/ai-client";

const app = new Hono();

app.use(bodyLimit({ maxSize: 21 * 1024 * 1024 }));

function errStatus(err: unknown): { body: { error: string }; status: 400 | 403 | 422 | 500 | 503 } {
  if (err instanceof BadFiling) return { body: { error: err.message }, status: 422 };
  if (err instanceof AiUnavailable) return { body: { error: "ai_unavailable" }, status: 403 };
  if (err instanceof ContentRejected) return { body: { error: "content_rejected" }, status: 403 };
  if (err instanceof AiMisconfigured) return { body: { error: "ai_misconfigured" }, status: 500 };
  if (err instanceof AiTransient) return { body: { error: "ai_transient" }, status: 503 };
  console.error("request failed:", err);
  return { body: { error: "internal" }, status: 500 };
}

app.get("/api/status", (c) => c.json({
  configured: Boolean(process.env.OPENAI_API_KEY),
  ai: modelRuntimeConfig(),
}));

app.post("/api/extract", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    const preferredMarket: Market | undefined = form.get("market") === "br"
      ? "br"
      : form.get("market") === "us" ? "us" : undefined;
    if (!(file instanceof File)) return c.json({ error: "no_file" }, 400);
    if (file.size > 20 * 1024 * 1024) return c.json({ error: "file_too_large" }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return c.json({ error: "unreadable_pdf" }, 422);
    const text = await extractFilingText(Buffer.from(bytes));
    const classification = classifyFiling(text, preferredMarket);
    return c.json({ text, classification });
  } catch (err) {
    const { body, status } = errStatus(err);
    return c.json(body, status);
  }
});

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
      if (
        error instanceof AiTransient
        || error instanceof AiMisconfigured
        || error instanceof AiUnavailable
        || error instanceof ContentRejected
      ) throw error;
      return c.json({
        result: { metadata: metadataFallback(classification) },
        diagnostic: { status: "failed", reason: "metadata_agent_failed", confidence: classification.confidence },
        manager: { stage: 0, totalStages: 7, agent: "metadata", excerptChars: Math.min(text.length, 50_000), attempts: 1 },
        evaluation: { schemaValid: true, completeness: "failed" },
      });
    }
  } catch (err) {
    const { body: eb, status } = errStatus(err);
    return c.json(eb, status);
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

app.post("/api/market-research", async (c) => {
  try {
    const body = await c.req.json();
    const jurisdiction: Market = body.jurisdiction === "br" ? "br" : "us";
    const text = String(body.text || "");
    const marketResult = body.marketResult as MarketResult;
    if (text.length < 2000 || !marketResult?.market) {
      return c.json({ error: "bad_request" }, 400);
    }
    return c.json(await agentManager.runMarketResearch(jurisdiction, text, marketResult));
  } catch (err) {
    const { body, status } = errStatus(err);
    return c.json(body, status);
  }
});

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

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;
