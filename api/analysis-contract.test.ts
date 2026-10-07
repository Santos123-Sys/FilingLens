import { describe, expect, it } from "vitest";
import { companySchema, type FilingAnalysis } from "../contracts/analysis";
import { buildAgentInput } from "./analyze";
import { agentManager, MANAGED_AGENT_ORDER } from "./agent-manager";
import { assessCompleteness } from "./completeness";
import { buildPrebuiltDashboardData } from "./dashboard-manager";
import { classifyFiling } from "./classification";
import { formatFilingNumber, formatKpiValue } from "../src/lib/number-format";
import { applyFinancialValidation } from "./financial-validation";

const legacyProfile = {
  company: {
    name: "Example Corp.",
    ticker: "EXM",
    exchange: "NYSE",
    filingType: "10-K",
    periodEnd: "2025-12-31",
    filedAt: "2026-02-20",
    description: "Example profile.",
  },
  kpis: [],
};

describe("company filing references", () => {
  it("keeps accepting profiles that predate filing reference extraction", () => {
    const parsed = companySchema.parse(legacyProfile);
    expect(parsed.company.filingReference).toBeUndefined();
  });

  it("preserves an explicitly supplied SEC or CVM filing identifier", () => {
    const parsed = companySchema.parse({
      ...legacyProfile,
      company: {
        ...legacyProfile.company,
        filingReference: "0000123456-26-000001",
      },
    });
    expect(parsed.company.filingReference).toBe("0000123456-26-000001");
  });
});

describe("analysis module completeness", () => {
  it("flags an empty financial response even when it satisfies the JSON schema", () => {
    expect(
      assessCompleteness("financials", {
        financials: { unit: "R$ milhões", years: [], revenue: [], netIncome: [] },
      }),
    ).toMatchObject({
      status: "incomplete",
      reason: "historical_financials_not_found",
    });
  });

  it("requires two periods and a core financial series", () => {
    expect(
      assessCompleteness("financials", {
        financials: {
          unit: "R$ milhões",
          years: ["2024", "2025"],
          revenue: [100, 120],
          netIncome: [8, 10],
        },
      }),
    ).toMatchObject({ status: "complete" });
  });

  it("treats narrative filings as not applicable to financial-table thresholds", () => {
    expect(
      assessCompleteness(
        "financials",
        { financials: { unit: "R$ milhões", years: [], revenue: [], netIncome: [] } },
        { jurisdiction: "br", filingType: "Formulário de Referência" },
      ),
    ).toMatchObject({ status: "not_applicable" });
  });
});

describe("jurisdiction classification", () => {
  it("routes a CVM DFP through the Brazil path", () => {
    const classification = classifyFiling(
      "COMISSÃO DE VALORES MOBILIÁRIOS CNPJ DEMONSTRAÇÕES FINANCEIRAS PADRONIZADAS DFP BALANÇO PATRIMONIAL",
    );
    expect(classification.jurisdiction).toBe("br");
    expect(classification.filingType).toBe("DFP");
  });

  it("routes an SEC 10-K through the US path", () => {
    const classification = classifyFiling(
      "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K CIK Item 1A Risk Factors Item 8 Financial Statements",
    );
    expect(classification.jurisdiction).toBe("us");
    expect(classification.filingType).toBe("10-K");
  });
});

describe("Brazilian filing excerpts", () => {
  it("keeps accent-free financial statement headings in the financial agent input", () => {
    const source = [
      "Capa do documento. ".repeat(200),
      "DEMONSTRACAO DO RESULTADO DO EXERCICIO\nReceita líquida 2024: 100\nReceita líquida 2025: 120",
      "BALANCO PATRIMONIAL\nAtivo total 2025: 500",
    ].join("\n");

    expect(buildAgentInput("financials", source)).toContain(
      "DEMONSTRACAO DO RESULTADO DO EXERCICIO",
    );
  });

  it("formats Brazilian financial values for dashboard display", () => {
    expect(formatFilingNumber(1234567.89, "pt-BR")).toBe("1.234.567,89");
    expect(formatKpiValue("R$ 1234567.89 milhões · 12.3%", "pt-BR"))
      .toBe("R$ 1.234.567,89 milhões · 12,3%");
  });
});

describe("Agent and dashboard managers", () => {
  it("keeps the manager’s six specialist stages in the expected order", () => {
    expect(MANAGED_AGENT_ORDER).toEqual([
      "profiler",
      "market",
      "risks",
      "financials",
      "historian",
      "synthesizer",
    ]);
  });

  it("keeps retries at the browser boundary while allowing bounded provider web tools inside profiler and historian", () => {
    expect(agentManager.plan()).toMatchObject({
      retryBoundary: "browser-per-stage",
      requestPolicy: "one_primary_model_invocation_per_agent_request; provider web-search tool may execute inside profiler/historian; deterministic Python skills do not call a model",
      executionMode: "dependency_aware_bounded_concurrency",
      webResearchStage: { endpoint: "/api/market-research", trigger: "always_after_market_agent" },
    });
  });

  it("returns a transparent empty financial state for a reference filing without series", () => {
    const analysis: FilingAnalysis = {
      schemaVersion: "2.0",
      jurisdiction: "br",
      metadata: {
        jurisdiction: "br", filingType: "Formulário de Referência",
        reportingPeriod: "2025-12-31", filedAt: null, confidence: 0.95,
        cnpj: null, cvmDocumentClass: "Formulário de Referência", registryData: null,
        cik: null, sicCode: null, fiscalYearEnd: null, stateOfIncorporation: null,
        sources: [],
      },
      company: {
        name: "Example S.A.", ticker: null, exchange: "B3",
        filingType: "Formulário de Referência", periodEnd: "2025-12-31",
        filedAt: null, description: "Example.",
      },
      kpis: [], market: { industry: "", competitors: [], geographies: [], segments: [] },
      risks: [],
      financials: {
        unit: "R$ milhões", years: [], revenue: [], netIncome: [], eps: null,
        grossMargin: null, operatingMargin: null, operatingCashFlow: null, capex: null,
        freeCashFlow: null, dividends: null, buybacks: null, totalAssets: null,
        totalDebt: null, cash: null,
      },
      timeline: [], events: [], summary: [],
      confidenceNotes: [], missingData: [],
      diagnostics: {
        financials: { status: "not_applicable", reason: "financial_tables_not_applicable_to_form" },
      },
    };

    const dashboard = buildPrebuiltDashboardData(analysis);
    expect(dashboard.hero.state).toBe("empty");
    expect(dashboard.combo.state).toBe("empty");
    expect(dashboard.pivot.state).toBe("empty");
  });

  it("calculates period-aligned financial relationships without replacing reported inputs", async () => {
    const result = await applyFinancialValidation({
      financials: {
        unit: "R$ milhões", years: ["2024", "2025"], revenue: [100, 120],
        grossProfit: [40, 54], ebit: [20, 30], ebitda: [25, 36],
        incomeBeforeTax: [16, 25], incomeTaxExpense: [4, 6.25], reportedRoic: null,
        netIncome: [10, 15], eps: null, grossMargin: null, operatingMargin: null,
        operatingCashFlow: [22, 31], capex: [8, 11], freeCashFlow: null,
        dividends: null, buybacks: null, totalAssets: [200, 240], totalLiabilities: null,
        totalEquity: [100, 120], totalDebt: [80, 90], cash: [20, 30],
        currentAssets: [60, 70], currentLiabilities: [30, 35], interestExpense: [4, 5],
      },
    });
    const computed = result.financials.computed ?? [];
    expect(computed.find(metric => metric.key === "netDebt")?.values).toEqual([60, 60]);
    expect(computed.find(metric => metric.key === "netDebtToEbitda")?.values).toEqual([2.4, 1.67]);
    expect(computed.find(metric => metric.key === "freeCashFlowCalculated")?.values).toEqual([14, 20]);
    expect(computed.find(metric => metric.key === "revenueGrowth")?.values).toEqual([null, 20]);
    expect(computed.find(metric => metric.key === "roic")?.values).toEqual([null, 13.24]);
  }, 20_000);
});
