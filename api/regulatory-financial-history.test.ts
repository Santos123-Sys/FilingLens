import { describe, expect, it } from "vitest";
import { buildRegulatoryAnnualHistory } from "./regulatory-financial-history";
import type { RegulatoryDataSnapshot } from "../contracts/regulatory-data";

describe("regulatory annual history", () => {
  it("builds a five-year USD history in millions without overwriting filing periods", () => {
    const snapshot: RegulatoryDataSnapshot = {
      status: "complete",
      jurisdiction: "us",
      provider: "sec_edgar",
      company: {},
      warnings: [],
      raw: {},
      sources: [],
      coverageYears: ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"],
      historyRequested: 5,
      metrics: Array.from({ length: 5 }, (_, index) => {
        const year = 2021 + index;
        return {
          key: "revenue",
          value: (100 + index * 10) * 1_000_000,
          unit: "USD",
          period: `FY${year}`,
          fiscalYear: year,
          statementType: "annual" as const,
          status: "single_source" as const,
          source: {
            provider: "sec_edgar",
            sourceType: "regulatory_api",
            url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json",
            retrievedAt: "2026-10-07T00:00:00Z",
            form: "10-K",
            period: `FY${year}`,
          },
        };
      }),
    };
    const history = buildRegulatoryAnnualHistory(snapshot);
    expect(history?.years).toEqual(["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]);
    expect(history?.revenue).toEqual([100, 110, 120, 130, 140]);
    expect(history?.unit).toBe("USD millions");
    expect(history?.status).toBe("complete");
    expect(history?.sources[0]?.publisher).toBe("SEC EDGAR");
  });
});
