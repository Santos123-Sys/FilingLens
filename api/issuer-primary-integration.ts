import { createHash, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { APPLE_2025_DISCLOSURE, verifyIssuerApple2025Point, type IssuerDisclosureDocument } from "../contracts/issuer-statement-proof";
import { fetchAppleIssuerDisclosure } from "./issuer-pdf-proof";
import type { MarketResult } from "../contracts/analysis";

/**
 * Independently verified issuer-PUBLISHED financial statement.
 * This is deliberately a distinct route and schema from the SEC/CVM
 * regulatory-finance snapshot. An issuer's unaudited PDF is not SEC CompanyFacts.
 */
export const ISSUER_PRIMARY_SCHEMA = "filinglens-issuer-primary-v1" as const;
export const APPLE_2025_ACCEPTED_SHA256 =
  "43e7f0730b3cce0fc37301a2f43c29712bbde6ab299d97c6df345fd0c754508a";
const SEC_IDENTITY_URL =
  "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm";
const expected = [
  { metric: "revenue", label: "Revenue", value: 416161 },
  { metric: "grossProfit", label: "Gross profit", value: 195201 },
  { metric: "operatingIncome", label: "Operating income", value: 133050 },
  { metric: "netIncome", label: "Net income", value: 112010 },
] as const;
type Point = NonNullable<NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number]["dataPoints"]>[number];

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function authorized(value: string | undefined, token: string | undefined): boolean {
  if (!token || token.length < 32 || /[\r\n]/.test(token)) return false;
  const expectedBytes = Buffer.from(token);
  const candidateBytes = Buffer.from(value?.startsWith("Bearer ") ? value.slice(7) : "");
  return expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes);
}
export async function buildAppleIssuerPrimarySnapshot(doc: IssuerDisclosureDocument | null) {
  // Pin to the public source bytes accepted in the 2026-10-09 real-source run.
  // Fail closed if the issuer silently replaces its PDF.
  if (!doc || doc.url !== APPLE_2025_DISCLOSURE.url ||
      doc.sha256 !== APPLE_2025_ACCEPTED_SHA256) return null;
  const facts = [];
  for (const item of expected) {
    const point: Point = {
      label: item.label, value: `USD ${item.value} millions`, period: "FY2025",
      context: "consolidated US GAAP; period end 2025-09-27",
      source: { kind: "citation", section: "Apple FY2025 annual statement identity", url: SEC_IDENTITY_URL },
    };
    const proof = verifyIssuerApple2025Point("Apple Inc.", point, doc);
    if (proof.status !== "verified" || proof.pdfSha256 !== APPLE_2025_ACCEPTED_SHA256) return null;
    facts.push({
      metric: item.metric, value: String(item.value),
      unit: "USD millions", currency: "USD", fiscalYear: 2025,
      periodEnd: APPLE_2025_DISCLOSURE.periodEnd,
      proofStatus: "issuer_published_verified" as const,
    });
  }
  const payload = {
    schemaVersion: ISSUER_PRIMARY_SCHEMA,
    issuer: { jurisdiction: "us" as const, registryId: APPLE_2025_DISCLOSURE.cik },
    issuerName: APPLE_2025_DISCLOSURE.issuer,
    provenance: "issuer_published_unaudited_pdf" as const,
    secCompanyFactsVerified: false as const,
    source: {
      url: doc.url, sha256: doc.sha256, retrievedAt: doc.retrievedAt,
      periodEnd: APPLE_2025_DISCLOSURE.periodEnd,
    },
    facts,
    revenueGrowthYoYPct: null,
    limitations: [
      "Issuer-published, unaudited FY2025 disclosure; NOT SEC CompanyFacts.",
      "A single FY2025 period does not establish annual revenue growth.",
      "No regulatory-filing authenticity or audit opinion is asserted.",
    ],
  };
  return { ...payload, contentHash: hash(JSON.stringify(payload)) };
}

export function registerIssuerPrimaryIntegration(
  app: Hono,
  options: {
    token?: () => string | undefined;
    enabled?: () => boolean;
    load?: () => Promise<IssuerDisclosureDocument | null>;
  } = {},
) {
  const token = options.token ?? (() => process.env.FILINGLENS_ISSUER_PRIMARY_API_TOKEN);
  const enabled = options.enabled ?? (() => process.env.FILINGLENS_ISSUER_PRIMARY_ENABLED === "true");
  const load = options.load ?? fetchAppleIssuerDisclosure;
  app.get("/api/integration/v1/issuers/us/:cik/issuer-statement", async c => {
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Authorization");
    c.header("X-Content-Type-Options", "nosniff");
    if (!enabled() || !token()) return c.json({ error: "issuer_primary_disabled" }, 503);
    if (!authorized(c.req.header("Authorization"), token())) return c.json({ error: "unauthorized" }, 401);
    const cik = c.req.param("cik");
    if (!/^\d{1,10}$/.test(cik) || /^0+$/.test(cik)) return c.json({ error: "invalid_issuer" }, 400);
    if (cik.padStart(10, "0") !== APPLE_2025_DISCLOSURE.cik)
      return c.json({ error: "issuer_primary_not_supported" }, 404);
    try {
      const snapshot = await buildAppleIssuerPrimarySnapshot(await load());
      return snapshot ? c.json(snapshot) : c.json({ error: "issuer_primary_unavailable" }, 503);
    } catch {
      return c.json({ error: "issuer_primary_unavailable" }, 503);
    }
  });
}
