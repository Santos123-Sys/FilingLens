import { describe, expect, it } from "vitest";
import { analyzeFinancialSkillInputs } from "./financial-skill-analysis";
import { validateHistorianOutput } from "./historian-validation";
import { validateMarketOutput } from "./market-validation";
import { buildAgentInput, buildRiskRecoveryInput } from "./analyze";
import { MODEL_PINS } from "./ai/provider";
import { extractDatedFilingEvents } from "./timeline-skill-extraction";
import { assessCompleteness } from "./completeness";
import { mergeMarketResearchPeers, synthesisInput } from "./agent-manager";
import { verifyMarketResearchPeers } from "./market-web-research";

describe("bounded FilingLens skill integrations", () => {
  it("keeps a sourced issuer profile usable without headline KPI figures", () => {
    expect(assessCompleteness("profiler", {
      company: { name: "Example SA", description: "The issuer distributes products throughout Brazil and operates logistics terminals." },
      kpis: [],
    }).status).toBe("complete");
  });

  it("passes completed specialist outputs into synthesis without unrelated payload fields", () => {
    const input = synthesisInput("Filing excerpt", { profiler: { company: { name: "Example" } }, secret: "omit" });
    expect(input).toContain('"name":"Example"');
    expect(input).not.toContain("omit");
  });

  it("extracts only explicitly dated filing events with verbatim source text", () => {
    const line = "Em 15/04/2024, a companhia aprovou a aquisição da unidade operacional.";
    const result = extractDatedFilingEvents(`${line}\nEm 31/02/2024, aprovou uma operação inválida.\nA companhia prevê novas aquisições.`);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: "2024-04-15", dateGranularity: "day", sourceType: "filing" });
    expect(result[0].source?.quote).toBe(line);
  });
  it("builds a focused risk window for Brazilian Formulario de Referencia", () => {
    const filing = [
      "CAPA",
      "Informações gerais do emissor.",
      "4.1 - Descreva os fatores de risco que possam influenciar a decisão de investimento",
      "A companhia está exposta a riscos de preço, crédito, regulação e segurança operacional.",
      "5. Gerenciamento de riscos",
    ].join("\n");
    const excerpt = buildRiskRecoveryInput(filing);
    expect(excerpt).toContain("fatores de risco");
    expect(excerpt).toContain("riscos de preço");
  });

  it("treats an auditable public market-share proxy as usable market evidence", () => {
    const diagnostic = assessCompleteness("market", {
      market: {
        industry: "",
        competitors: [],
        geographies: [],
        segments: [],
        marketShares: [{
          label: "Brazil liquid-fuels distribution volume share proxy",
          valuePercent: 24.5,
          numerator: 245,
          denominator: 1000,
          unit: "m³",
          period: "2026 YTD",
          geography: "Brazil",
          productScope: "Liquid fuels",
          method: "public_proxy",
          provider: "ANP SIMP",
          companyMatch: "VIBRA ENERGIA S.A.",
          source: { section: "Public market-share proxy", kind: "citation", url: "https://www.gov.br/anp/", publisher: "ANP", accessed: "2026-10-07" },
        }],
      },
    }, { jurisdiction: "br" });
    expect(diagnostic.status).toBe("complete");
  });

  it("includes MD&A alongside Item 1 for market evidence", () => {
    const filing = [
      "Item 1. Business",
      "We sell industrial equipment.",
      "Item 1A. Risk Factors",
      "Risk discussion.",
      "Item 7. Management's Discussion and Analysis",
      "The Components segment generated revenue of 120 in FY2025, compared with 100 in FY2024.",
      "Item 8. Financial Statements",
    ].join("\n");

    const excerpt = buildAgentInput("market", filing);
    expect(excerpt).toContain("Components segment generated revenue");
    expect(excerpt).toContain("We sell industrial equipment");
  });

  it("keeps Terra pinned for every analysis stage", () => {
    expect(new Set(Object.values(MODEL_PINS))).toEqual(new Set(["gpt-5.6-terra"]));
  });

  it("creates only comparable annual trends and raises filing-based review signals", () => {
    const analysis = analyzeFinancialSkillInputs({
      unit: "USD millions",
      years: ["FY2023", "FY2024"],
      revenue: [100, 110],
      grossProfit: [40, 33],
      netIncome: [10, 11],
      operatingCashFlow: [8, 4],
      totalAssets: [100, 100],
      totalLiabilities: [65, 72],
      totalEquity: [35, 28],
      currentAssets: [20, 10],
      currentLiabilities: [15, 12],
      accountsReceivable: [20, 35],
      inventory: [10, 13],
      accountsPayable: [8, 20],
      costOfGoodsSold: [60, 77],
      goodwill: [20, 35],
      eps: null, grossMargin: null, operatingMargin: null, capex: null,
      freeCashFlow: null, dividends: null, buybacks: null, totalDebt: [30, 35],
      cash: [5, 4], interestExpense: null,
    });

    expect(analysis.trends).toContainEqual({
      metric: "revenue", period: "FY2024", comparisonPeriod: "FY2023", comparison: "YoY", changePercent: 10,
    });
    expect(analysis.validationFlags.map(flag => flag.code)).toEqual(expect.arrayContaining([
      "AR_SURGE", "INVENTORY_BUILDUP", "AP_ANOMALY", "GROSS_MARGIN_SHIFT",
      "CASH_FLOW_DIVERGENCE", "EXCESSIVE_GOODWILL", "LIABILITIES_TO_ASSETS_SCREEN", "LOW_CURRENT_RATIO",
    ]));
  });

  it("validates filing timeline sources and drops unverifiable external events", () => {
    const result = validateHistorianOutput({
      timeline: [{ year: "2024", title: "Founded", category: "company history", detail: "Founded in 2024.", source: { section: "Item 1", quote: "The company was founded in 2024." } }],
      events: [
        { date: "2025-06", dateGranularity: "month", title: "Acquisition", category: "acquisition", impact: null, source: { section: "Note 4", quote: "On June 2025, the company acquired Example Ltd." } },
        { date: "2025-07-10", title: "Unverified", category: "other", impact: null, sourceType: "external", sourceRef: { kind: "citation", url: "https://example.com", publisher: "Example", accessed: "2026-10-04" } },
      ],
    }, "2025-07-01");

    expect(result.events).toHaveLength(1);
    expect(result.events[0].dateGranularity).toBe("month");
    expect(result.events[0].sourceType).toBe("filing");
    expect(result.events[0].id).toContain("evt-2025-06");
    expect(result.validationFlags?.some(flag => flag.reason === "external_source_unavailable")).toBe(true);
    expect(result.enrichmentStatus).toBe("skipped");
  });

  it("keeps peers and market series only when a filing quote is attached", () => {
    const result = validateMarketOutput({
      market: {
        industry: "Industrials",
        competitors: ["Named peer", "Unsupported peer"],
        peerEvidence: [{ name: "Named peer", sourceType: "filing", source: { section: "Item 1", quote: "We compete with Named peer." } }],
        geographies: [{ name: "Brazil", values: [10], sourceType: "filing", source: { section: "Note 8", quote: "Brazil revenue was 10." } }],
        segments: [
          { name: "Services", revenue: [10], earnings: null, sourceType: "external", source: { section: "External", quote: "Unverified." } },
          { name: "Unattributed", revenue: [5], earnings: null, source: { section: "Item 1", quote: "Quote without a provenance tag." } },
        ],
      },
    });

    expect(result.market.competitors).toEqual(["Named peer"]);
    expect(result.market.geographies[0].sourceType).toBe("filing");
    expect(result.market.segments).toHaveLength(0);
    expect(result.market.validationFlags?.length).toBe(2);
  });

  it("preserves filing peers while adding independently cited competitive research", () => {
    const source = {
      section: "Independent competitive research",
      kind: "citation" as const,
      url: "https://industry.example/peer",
      publisher: "Industry Association",
      accessed: "2026-10-05",
    };
    const result = mergeMarketResearchPeers({
      market: {
        industry: "Industrials",
        competitors: ["Filing Peer"],
        peerEvidence: [{
          name: "Filing Peer",
          sourceType: "filing",
          source: { section: "Item 1", quote: "We compete with Filing Peer." },
        }],
        geographies: [],
        segments: [],
        externalResearchStatus: "pending",
      },
    }, [{
      name: "Verified Motors",
      sourceType: "external",
      source,
    }], {
      status: "complete",
      methodology: "market-research-brief",
      peerProfiles: [{
        name: "Verified Motors",
        relationship: "Direct competitor",
        positioning: "Competes in the same core product category.",
        strengths: ["Scale"],
        vulnerabilities: ["Concentration"],
        source,
      }],
      findings: [{
        insight: "Competition is concentrated among scaled vendors.",
        implication: "Platform differentiation matters.",
        source,
      }],
    });

    expect(result.market.competitors).toEqual(["Filing Peer", "Verified Motors"]);
    expect(result.market.externalResearchStatus).toBe("complete");
    expect(result.market.competitiveAnalysis?.methodology).toBe("market-research-brief");
    expect(result.market.peerEvidence?.map(peer => peer.sourceType)).toEqual(["filing", "external"]);
  });

  it("accepts web-researched peers only when the search provider returned their citation URL", () => {
    const peers = verifyMarketResearchPeers([
      { name: "Verified Motors", url: "https://industry.example/peer?utm_source=search", reason: "Direct competitor." },
      { name: "Invented Motors", url: "https://invented.example/", reason: "Uncited claim." },
      { name: "Verified Motors", url: "https://industry.example/peer", reason: "Duplicate." },
      { name: "Insecure Source", url: "http://industry.example/peer", reason: "HTTP only." },
    ], [{ url: "https://industry.example/peer", title: "Industry Association" }], "2026-10-05");

    expect(peers).toEqual([{
      name: "Verified Motors",
      sourceType: "external",
      source: {
        section: "Independent competitive research",
        kind: "citation",
        url: "https://industry.example/peer",
        publisher: "Industry Association",
        accessed: "2026-10-05",
      },
    }]);
  });

  it("calculates cited market-framework trends only across explicitly comparable periods", () => {
    const result = validateMarketOutput({
      market: {
        industry: "Industrials", competitors: [],
        geographies: [],
        segments: [{
          name: "Services", periods: ["FY2023", "FY2024"], revenue: [80, 100], earnings: [8, 12],
          sourceType: "filing", source: { section: "Note 8", quote: "Services revenue was 80 in FY2023 and 100 in FY2024." },
        }],
      },
    });
    expect(result.market.insights).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Services", metric: "revenue", comparison: "YoY", changePercent: 25, sourceType: "filing" }),
      expect.objectContaining({ name: "Services", metric: "earnings", comparison: "YoY", changePercent: 50, sourceType: "filing" }),
    ]));
  });
});
