import { describe, expect, it } from "vitest";
import type { FilingAnalysis } from "../contracts/analysis";
import { buildPrebuiltDashboardData } from "./dashboard-manager";

function fixture(overrides: Partial<FilingAnalysis["financials"]> = {}): FilingAnalysis {
  return {
    schemaVersion: "2.0", jurisdiction: "br",
    metadata: { jurisdiction: "br", filingType: "DFP", reportingPeriod: "2025-12-31", filedAt: null, confidence: 1, cnpj: null, cvmDocumentClass: "DFP", registryData: null, cik: null, sicCode: null, fiscalYearEnd: null, stateOfIncorporation: null, sources: [] },
    company: { name: "Example S.A.", ticker: "EX", exchange: "B3", filingType: "DFP", periodEnd: "2025-12-31", filedAt: null, description: "", filingReference: null },
    kpis: [], market: { industry: "Manufacturing", competitors: [], geographies: [], segments: [] }, risks: [],
    financials: {
      unit: "R$ milhões", years: ["2024", "2025"], revenue: [100, 120], netIncome: [10, 15], eps: null,
      grossMargin: null, operatingMargin: null, operatingCashFlow: [20, 25], capex: null, freeCashFlow: null,
      dividends: null, buybacks: null, totalAssets: [200, 220], totalDebt: [50, 55], cash: [10, 12],
      ...overrides,
    },
    timeline: [], events: [], summary: [], confidenceNotes: [], missingData: [],
  };
}

describe("fixed dashboard data binding", () => {
  it("keeps the featured-map order, caps headline groups, and avoids a false total across unlike metrics", () => {
    const dashboard = buildPrebuiltDashboardData(fixture());
    expect(dashboard.template).toBe("featured-map");
    expect(dashboard.hero).toMatchObject({ state: "ready", label: "Receita líquida", value: 120 });
    expect(dashboard.combo.axis).toEqual(["2024", "2025"]);
    expect(dashboard.pivot.rows.length).toBeLessThanOrEqual(6);
    expect(dashboard.pivot.total).toBeNull();
  });

  it("does not bind mismatched series or invent values for the filing dashboard", () => {
    const dashboard = buildPrebuiltDashboardData(fixture({ revenue: [100], netIncome: [10] }));
    expect(dashboard.hero).toMatchObject({ state: "empty", value: null });
    expect(dashboard.combo.state).toBe("empty");
    expect(dashboard.pivot.state).toBe("ready");
    expect(dashboard.pivot.rows.some(row => row[0] === "Receita líquida")).toBe(false);
    expect(dashboard.pivot.total).toBeNull();
  });
});
