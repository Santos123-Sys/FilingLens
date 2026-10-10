import { createHash } from "node:crypto";
import { z } from "zod";
import { collectSecHistoricalFacts } from "./sec-peer-history";
import { secProofUrl, type SecCompanyFacts } from "./sec-peer-proof";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const publicFinanceIssuerSchema = z.object({
  jurisdiction: z.enum(["us", "br"]),
  registryId: z.string().regex(/^\d{10}$|^\d{14}$/),
}).strict().superRefine((issuer, ctx) => {
  const expectedLength = issuer.jurisdiction === "us" ? 10 : 14;
  if (issuer.registryId.length !== expectedLength || /^0+$/.test(issuer.registryId)) {
    ctx.addIssue({ code: "custom", message: "Registry ID does not match jurisdiction" });
  }
});

export const publicFinanceSourceSchema = z.object({
  url: z.string().url(),
  provider: z.string().min(1).max(100),
  form: z.string().max(64).nullable(),
  retrievedAt: z.string().max(64).nullable(),
}).strict();

export const publicFinanceFactSchema = z.object({
  id: sha256,
  metric: z.string().min(1).max(100),
  value: z.string().regex(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/).refine(value => Number.isFinite(Number(value))).nullable(),
  unit: z.string().min(1).max(100).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  fiscalYear: z.number().int().min(2000).max(2200),
  periodKind: z.literal("FY"),
  periodEnd: isoDate.nullable(),
  periodLabel: z.string().max(150).nullable(),
  status: z.enum(["verified", "single_source", "conflicted", "missing"]),
  sources: z.array(publicFinanceSourceSchema).min(1).max(20),
}).strict().superRefine((fact, ctx) => {
  if ((fact.status === "conflicted" || fact.status === "missing") && fact.value !== null) {
    ctx.addIssue({ code: "custom", message: "Conflicted/missing values must remain null" });
  }
});

export const publicFinanceSnapshotSchema = z.object({
  schemaVersion: z.literal("filinglens-public-finance-v1"),
  snapshotId: z.string().regex(/^flpub1_[a-f0-9]{64}$/),
  contentHash: sha256,
  archiveHash: sha256,
  archivedOn: isoDate,
  visibility: z.literal("public_regulatory"),
  issuer: publicFinanceIssuerSchema,
  provider: z.enum(["sec_edgar", "cvm_open_data"]),
  facts: z.array(publicFinanceFactSchema).min(1).max(1000),
  screening: z.object({
    revenueGrowthYoYPct: z.number().finite().nullable(),
    basis: z.literal("annual_same_currency_unit"),
    inputFactIds: z.array(sha256).max(2),
    periodEnd: isoDate.nullable(),
    calculatorVersion: z.literal("revenue-yoy-v1"),
  }).strict(),
  limitations: z.array(z.string().max(500)).max(20),
}).strict();

export type PublicFinanceSnapshot = z.infer<typeof publicFinanceSnapshotSchema>;
export type PublicFinanceFactInput = Omit<z.input<typeof publicFinanceFactSchema>, "id" | "periodKind">;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function officialSource(url: string, jurisdiction: "us" | "br"): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
    return jurisdiction === "us"
      ? parsed.hostname === "sec.gov" || parsed.hostname.endsWith(".sec.gov")
      : ["dados.cvm.gov.br", "www.gov.br", "sistemas.cvm.gov.br"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function buildScreening(facts: Array<z.infer<typeof publicFinanceFactSchema>>) {
  const revenue = facts.filter(fact => fact.metric === "revenue" && fact.value !== null &&
      ["verified", "single_source"].includes(fact.status) && fact.periodEnd)
    .sort((a, b) => b.fiscalYear - a.fiscalYear || (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""));
  const latest = revenue[0];
  const previous = revenue.find(fact => latest && fact.fiscalYear === latest.fiscalYear - 1 &&
    fact.currency === latest.currency && fact.unit === latest.unit);
  const latestValue = latest?.value === null || latest?.value === undefined ? null : Number(latest.value);
  const previousValue = previous?.value === null || previous?.value === undefined ? null : Number(previous.value);
  const comparable = latest && previous && latestValue !== null && previousValue !== null && previousValue !== 0;
  const growth = comparable ? Number((((latestValue! / previousValue!) - 1) * 100).toFixed(6)) : null;
  return {
    revenueGrowthYoYPct: growth !== null && Number.isFinite(growth) ? growth : null,
    basis: "annual_same_currency_unit" as const,
    inputFactIds: growth !== null && latest && previous ? [latest.id, previous.id] : [],
    periodEnd: growth !== null && latest ? latest.periodEnd : null,
    calculatorVersion: "revenue-yoy-v1" as const,
  };
}

export function buildPublicFinanceSnapshot(input: {
  issuer: z.input<typeof publicFinanceIssuerSchema>;
  provider: "sec_edgar" | "cvm_open_data";
  archivedOn: string;
  facts: PublicFinanceFactInput[];
  limitations?: string[];
}): PublicFinanceSnapshot {
  const issuer = publicFinanceIssuerSchema.parse(input.issuer);
  const archivedOn = isoDate.parse(input.archivedOn);
  if (input.provider !== (issuer.jurisdiction === "us" ? "sec_edgar" : "cvm_open_data")) {
    throw new Error("provider_jurisdiction_mismatch");
  }
  const facts = input.facts.map(candidate => {
    if (candidate.sources.some(source => !officialSource(source.url, issuer.jurisdiction))) {
      throw new Error("unofficial_regulatory_source");
    }
    const content = { ...candidate, periodKind: "FY" as const };
    return publicFinanceFactSchema.parse({ id: digest(JSON.stringify(content)), ...content });
  }).sort((a, b) => a.fiscalYear - b.fiscalYear || a.metric.localeCompare(b.metric) || a.id.localeCompare(b.id));
  if (!facts.length) throw new Error("no_public_finance_facts");
  const screening = buildScreening(facts);
  const limitations = input.limitations ?? [
    "Public regulator evidence only; private uploads and valuation commands are excluded.",
  ];
  const archiveHash = digest(JSON.stringify({ archivedOn, issuer, provider: input.provider, facts, screening }));
  const snapshotId = `flpub1_${archiveHash}`;
  const withoutContentHash = {
    schemaVersion: "filinglens-public-finance-v1" as const,
    snapshotId,
    archiveHash,
    archivedOn,
    visibility: "public_regulatory" as const,
    issuer,
    provider: input.provider,
    facts,
    screening,
    limitations,
  };
  const snapshot = {
    schemaVersion: withoutContentHash.schemaVersion,
    snapshotId,
    contentHash: digest(JSON.stringify(withoutContentHash)),
    archiveHash,
    archivedOn,
    visibility: withoutContentHash.visibility,
    issuer,
    provider: input.provider,
    facts,
    screening,
    limitations,
  };
  return publicFinanceSnapshotSchema.parse(snapshot);
}

export function buildSecPublicFinanceSnapshot(input: {
  cik: string;
  facts: SecCompanyFacts;
  retrievedDay: string;
}): PublicFinanceSnapshot | null {
  const cik = input.cik.padStart(10, "0");
  if (!/^\d{10}$/.test(cik) || !input.facts.entityName) return null;
  const history = collectSecHistoricalFacts(input.facts.entityName, cik, input.facts);
  if (!history.length) return null;
  return buildPublicFinanceSnapshot({
    issuer: { jurisdiction: "us", registryId: cik },
    provider: "sec_edgar",
    archivedOn: input.retrievedDay,
    facts: history.map(fact => ({
      metric: fact.metric,
      value: String(fact.amountMillions),
      unit: "USD millions",
      currency: "USD",
      fiscalYear: fact.year,
      periodEnd: fact.periodEnd,
      periodLabel: `FY ${fact.year}`,
      status: "verified" as const,
      sources: [{
        url: secProofUrl(cik),
        provider: "sec_edgar",
        form: "10-K",
        retrievedAt: input.retrievedDay,
      }],
    })),
  });
}

