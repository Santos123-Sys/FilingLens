import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { buildPublicFinanceSnapshot, buildSecPublicFinanceSnapshot, type PublicFinanceSnapshot } from "../contracts/public-finance";
import { cachedSecCompanyFacts } from "./sec-bulk-cache";
import { readPublicRegulatorySnapshots } from "./regulatory-snapshot-store";

const registry = z.object({
  jurisdiction: z.enum(["us", "br"]),
  registryId: z.string().regex(/^\d+$/),
}).strict();

const storedMetric = z.object({
  key: z.string().min(1).max(100),
  year: z.number().int().min(2000).max(2200),
  value: z.number().finite(),
  unit: z.string().min(1).max(100).nullable(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  status: z.enum(["verified", "single_source"]),
  source: z.object({
    provider: z.string().min(1).max(100),
    url: z.string().url(),
    form: z.string().max(64).nullable(),
    period: z.string().max(64).nullable(),
    retrievedAt: z.string().max(64).nullable(),
  }).strict(),
}).strict();

const storedSnapshot = z.object({
  snapshotDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  jurisdiction: z.enum(["us", "br"]),
  registryId: z.string(),
  provider: z.enum(["sec_edgar", "cvm_open_data"]),
  metrics: z.array(storedMetric).min(1).max(1000),
}).passthrough();

function authorized(header: string | undefined, token: string | undefined): boolean {
  if (!token || token.length < 32 || /[\r\n]/.test(token)) return false;
  const expected = Buffer.from(token);
  const received = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function normalizedIdentity(jurisdiction: "us" | "br", registryId: string) {
  if (!/^\d+$/.test(registryId) || /^0+$/.test(registryId)) return null;
  if (jurisdiction === "us") return registryId.length <= 10 ? registryId.padStart(10, "0") : null;
  return registryId.length === 14 ? registryId : null;
}

function currencyFromUnit(unit: string | null): string | null {
  if (!unit) return null;
  const match = /\b([A-Z]{3})\b/.exec(unit);
  return match?.[1] ?? null;
}

async function loadPublicFinanceSnapshot(jurisdiction: "us" | "br", registryId: string): Promise<PublicFinanceSnapshot | null> {
  if (jurisdiction === "us") {
    const cached = await cachedSecCompanyFacts(registryId, process.env.DATABASE_URL, { maxAgeDays: 730 });
    if (cached) return buildSecPublicFinanceSnapshot({ cik: registryId, facts: cached.facts, retrievedDay: cached.retrievedDay });
  }
  const candidates = await readPublicRegulatorySnapshots(jurisdiction, registryId);
  for (const candidate of candidates) {
    const parsed = storedSnapshot.safeParse(candidate);
    if (!parsed.success || parsed.data.jurisdiction !== jurisdiction ||
      normalizedIdentity(jurisdiction, parsed.data.registryId) !== registryId) continue;
    return buildPublicFinanceSnapshot({
      issuer: { jurisdiction, registryId },
      provider: parsed.data.provider,
      archivedOn: parsed.data.snapshotDay,
      facts: parsed.data.metrics.map(metric => ({
        metric: metric.key,
        value: String(metric.value),
        unit: metric.unit,
        currency: currencyFromUnit(metric.unit),
        fiscalYear: metric.year,
        periodEnd: metric.period,
        periodLabel: metric.period ?? `FY ${metric.year}`,
        status: metric.status,
        sources: [{
          url: metric.source.url,
          provider: metric.source.provider,
          form: metric.source.form,
          retrievedAt: metric.source.retrievedAt,
        }],
      })),
    });
  }
  return null;
}

export type PublicFinanceApiDependencies = {
  load?: (jurisdiction: "us" | "br", registryId: string) => Promise<PublicFinanceSnapshot | null>;
  token?: () => string | undefined;
  enabled?: () => boolean;
};

export function registerPublicFinanceApi(app: Hono, dependencies: PublicFinanceApiDependencies = {}) {
  const load = dependencies.load ?? loadPublicFinanceSnapshot;
  const token = dependencies.token ?? (() => process.env.FILINGLENS_READ_API_TOKEN);
  const enabled = dependencies.enabled ?? (() => Boolean(process.env.DATABASE_URL && token()));

  app.get("/api/integration/v1/capabilities", c => {
    c.header("Cache-Control", "no-store");
    return c.json({
      service: "FilingLens",
      schemaVersion: "filinglens-public-finance-v1",
      mode: "read_only",
      jurisdictions: ["us", "br"],
      operations: ["public_regulatory_financial_snapshot"],
      consumers: ["global_portfolio_intelligence", "portfolio_risk_return"],
      sharedIntelligence: ["company_identity", "financial_facts", "screening_kpis", "source_provenance"],
      configured: Boolean(enabled() && token() && token()!.length >= 32),
    });
  });

  app.get("/api/integration/v1/issuers/:jurisdiction/:registryId/financial-snapshot", async c => {
    if (!enabled() || !token()) return c.json({ error: "integration_disabled" }, 503);
    if (!authorized(c.req.header("Authorization"), token())) return c.json({ error: "unauthorized" }, 401);
    const params = registry.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "invalid_issuer" }, 400);
    const registryId = normalizedIdentity(params.data.jurisdiction, params.data.registryId);
    if (!registryId) return c.json({ error: "invalid_issuer" }, 400);
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Authorization");
    c.header("X-Content-Type-Options", "nosniff");
    try {
      const snapshot = await load(params.data.jurisdiction, registryId);
      return snapshot ? c.json(snapshot) : c.json({ error: "snapshot_not_found" }, 404);
    } catch (error) {
      console.warn("[public-finance] snapshot unavailable", error instanceof Error ? error.name : "unknown");
      return c.json({ error: "snapshot_unavailable" }, 503);
    }
  });
}

