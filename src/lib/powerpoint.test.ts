import { describe, expect, it } from "vitest";
import type { FilingAnalysis } from "@contracts/analysis";
import { buildCompanyPowerPoint } from "./powerpoint";

const analysis: FilingAnalysis = {
  schemaVersion: "2.0",
  jurisdiction: "us",
  metadata: {
    jurisdiction: "us", filingType: "10-K", reportingPeriod: "2025-12-31", filedAt: "2026-02-15",
    confidence: 0.97, cnpj: null, cvmDocumentClass: null, registryData: null, cik: "0000123456",
    sicCode: "3569", fiscalYearEnd: "1231", stateOfIncorporation: "DE",
    sources: [{ section: "Cover", item: "10-K", quote: "Example Corp. annual report." }],
  },
  company: {
    name: "Example Corp.", ticker: "EXM", exchange: "NYSE", filingType: "10-K", periodEnd: "2025-12-31",
    filedAt: "2026-02-15", filingReference: "0000123456-26-000001",
    description: "Example Corp. designs and sells industrial systems to customers in North America and Europe.",
  },
  kpis: [{ label: "Revenue", value: "$1.2bn", delta: "+10%", positive: true, source: { section: "Item 8", quote: "Revenue was 1,200." } }],
  market: {
    industry: "Industrial systems",
    competitors: ["Filing Peer", "Web Peer"],
    peerEvidence: [
      { name: "Filing Peer", sourceType: "filing", source: { section: "Item 1", quote: "We compete with Filing Peer." } },
      { name: "Web Peer", sourceType: "external", source: { section: "Independent web research", kind: "citation", url: "https://industry.example/peer", publisher: "Industry Source", accessed: "2026-10-05" } },
    ],
    externalResearchStatus: "complete",
    geographies: [{ name: "United States", values: [600, 700], periods: ["2024", "2025"], sourceType: "filing", source: { section: "Note 3", quote: "US revenue was 600 and 700." } }],
    segments: [{ name: "Systems", revenue: [900, 1050], earnings: [120, 150], periods: ["2024", "2025"], sourceType: "filing", source: { section: "Note 3", quote: "Systems revenue was 900 and 1,050." } }],
  },
  risks: [{ title: "Supply constraints", category: "operations", severity: 4, summary: "Component shortages may delay deliveries.", materialityRank: 1, source: { section: "Item 1A", quote: "Component shortages may delay deliveries." } }],
  financials: {
    unit: "USD millions", years: ["2024", "2025"], revenue: [1000, 1200], ebitda: [150, 190], netIncome: [80, 105],
    eps: [1.2, 1.5], grossMargin: [40, 41], operatingMargin: [12, 13], operatingCashFlow: [130, 165], capex: [55, 60],
    freeCashFlow: [75, 105], dividends: null, buybacks: null, totalAssets: [1800, 1950], totalDebt: [400, 420], cash: [120, 160],
    forwardGuidance: [{ metric: "Revenue", period: "2026", range: "mid-single-digit growth", source: { section: "Item 7", quote: "We expect mid-single-digit revenue growth." } }],
    evidence: [{ metric: "revenue", period: "2025", source: { section: "Item 8", quote: "Revenue was 1,200." } }],
    computed: [{ key: "netDebtToEbitda", values: [1.87, 1.37], unit: "multiple", type: "calculated", formula: "(Debt - Cash) / EBITDA", components: ["totalDebt", "cash", "ebitda"], numerator: "netDebt", denominator: "ebitda", periods: ["2024", "2025"], sources: [{ section: "Item 8", quote: "Debt, cash and EBITDA figures." }], confidence: "high" }],
  },
  timeline: [{ year: "2025", title: "New platform", category: "product", detail: "Launched a new industrial platform.", source: { section: "Item 1", quote: "We launched a new industrial platform." }, sourceType: "filing" }],
  events: [{ date: "2025-09-15", title: "Acquisition", category: "M&A", impact: "Expanded service capacity.", source: { section: "Note 4", quote: "On September 15 we acquired ServiceCo." }, sourceType: "filing" }],
  summary: ["Revenue increased while profitability remained resilient.", "The filing identifies supply-chain risk as a material operating concern."],
  confidenceNotes: [], missingData: [],
  diagnostics: { metadata: { status: "complete" }, profiler: { status: "complete" }, market: { status: "complete" }, risks: { status: "complete" }, financials: { status: "complete" }, historian: { status: "complete" }, synthesizer: { status: "complete" } },
};

describe("PowerPoint export", () => {
  it("builds a valid OOXML zip with company facts and citation-backed web evidence", () => {
    const result = buildCompanyPowerPoint(analysis, "en");
    expect(result.fileName).toBe("Example-Corp.-US-FilingLens-Analysis.pptx");
    expect(result.slideCount).toBe(9);
    expect(Array.from(result.bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const decoded = new TextDecoder().decode(result.bytes);
    expect(decoded).toContain("ppt/slides/slide9.xml");
    expect(decoded).toContain("Example Corp.");
    expect(decoded).toContain("https://industry.example/peer");
    expect(decoded).toContain("Informational use only");
  });
});
