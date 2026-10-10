import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPublicFinanceSnapshot,
  buildSecPublicFinanceSnapshot,
  publicFinanceSnapshotSchema,
} from "./public-finance";
import type { SecCompanyFacts } from "./sec-peer-proof";

const secFacts: SecCompanyFacts = {
  cik: 320193,
  entityName: "Apple Inc.",
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        units: {
          USD: [
            { val: 100_000_000, start: "2023-10-01", end: "2024-09-28", form: "10-K", fp: "FY", fy: 2024, accn: "0000320193-24-000080" },
            { val: 120_000_000, start: "2024-09-29", end: "2025-09-27", form: "10-K", fp: "FY", fy: 2025, accn: "0000320193-25-000079" },
          ],
        },
      },
    },
  },
};

describe("public finance producer contract", () => {
  it("builds the exact digest-verified contract consumed by GPI", () => {
    const snapshot = buildSecPublicFinanceSnapshot({
      cik: "0000320193",
      facts: secFacts,
      retrievedDay: "2026-10-10",
    });
    expect(snapshot).not.toBeNull();
    expect(publicFinanceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot?.screening.revenueGrowthYoYPct).toBe(20);
    expect(snapshot?.screening.inputFactIds).toHaveLength(2);
    expect(snapshot?.snapshotId).toBe(`flpub1_${snapshot?.archiveHash}`);
    const { contentHash, ...content } = snapshot!;
    expect(createHash("sha256").update(JSON.stringify(content)).digest("hex")).toBe(contentHash);
    expect(snapshot?.facts.every(fact => fact.sources.every(source => new URL(source.url).hostname.endsWith("sec.gov")))).toBe(true);
  });

  it("fails closed for unofficial evidence and mismatched provider ownership", () => {
    const common = {
      issuer: { jurisdiction: "us" as const, registryId: "0000320193" },
      provider: "sec_edgar" as const,
      archivedOn: "2026-10-10",
      facts: [{
        metric: "revenue", value: "100", unit: "USD millions", currency: "USD", fiscalYear: 2025,
        periodEnd: "2025-09-27", periodLabel: "FY 2025", status: "single_source" as const,
        sources: [{ url: "https://example.com/not-sec", provider: "scraper", form: "10-K", retrievedAt: "2026-10-10" }],
      }],
    };
    expect(() => buildPublicFinanceSnapshot(common)).toThrow("unofficial_regulatory_source");
    expect(() => buildPublicFinanceSnapshot({ ...common, facts: [{ ...common.facts[0], sources: [{ ...common.facts[0].sources[0], url: "https://data.sec.gov/fixture" }] }], provider: "cvm_open_data" })).toThrow("provider_jurisdiction_mismatch");
  });

  it("does not invent growth when annual periods are not comparable", () => {
    const changed = structuredClone(secFacts);
    changed.facts!["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units!.USD![0].end = "2023-09-30";
    changed.facts!["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units!.USD![0].fy = 2023;
    const snapshot = buildSecPublicFinanceSnapshot({ cik: "0000320193", facts: changed, retrievedDay: "2026-10-10" });
    expect(snapshot?.screening).toMatchObject({ revenueGrowthYoYPct: null, inputFactIds: [], periodEnd: null });
  });
});

