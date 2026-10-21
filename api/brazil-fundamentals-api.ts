import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { dataToolsJson } from "./data-tools-client";
import accessPolicy from "../config/sec-acquisition-access.json";

const query = z.object({
  operation: z.enum(["issuers", "facts", "screen"]),
  cnpj: z.string().regex(/^[0-9]{14}$/).optional(),
  form: z.enum(["DFP", "ITR"]).default("DFP"),
  year: z.number().int().min(2010).max(new Date().getUTCFullYear()).default(new Date().getUTCFullYear()-1),
  scope: z.enum(["consolidated", "standalone"]).default("consolidated"),
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  activeOnly: z.boolean().default(true),
}).strict().refine(q => q.operation !== "facts" || Boolean(q.cnpj), "cnpj_required");

type Dependencies = { token?: () => string | undefined; retrieve?: (payload: z.infer<typeof query>) => Promise<unknown> };
export function registerBrazilFundamentalsApi(app: Hono, dependencies: Dependencies = {}) {
  const token = dependencies.token ?? (() => process.env.FILINGLENS_READ_API_TOKEN);
  const retrieve = dependencies.retrieve ?? ((payload) => dataToolsJson("/v1/fundamentals/br", payload, 70_000));
  app.get("/api/integration/v1/regulatory-access", c => c.json({
    schemaVersion: "regulatory-access.v1",
    sec: { status: accessPolicy.state, reason: accessPolicy.reason, evidence: accessPolicy.evidence,
      liveRetrievalVerified: false, cachedEvidenceMayBeAvailable: true },
    brazil: { fundamentals: "CVM DFP/ITR", prices: "separate_provider_contract", allStocksCertified: false },
  }));
  app.post("/api/integration/v1/brazil/fundamentals", async c => {
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Authorization");
    const secret = token();
    if (!secret || secret.length < 32) return c.json({ error: "integration_disabled" }, 503);
    const expected = Buffer.from("Bearer " + secret), actual = Buffer.from(c.req.header("Authorization") ?? "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return c.json({ error: "unauthorized" }, 401);
    if (Number(c.req.header("Content-Length")) > 4096) return c.json({ error: "request_too_large" }, 413);
    let raw: unknown;
    try {
      const reader = c.req.raw.body?.getReader();
      if (!reader) return c.json({ error: "invalid_query" }, 400);
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 4096) { await reader.cancel(); return c.json({ error: "request_too_large" }, 413); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return c.json({ error: "invalid_query" }, 400); }
    const parsed = query.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    try { return c.json(await retrieve(parsed.data)); }
    catch { return c.json({ error: "cvm_source_unavailable" }, 503); }
  });
}
