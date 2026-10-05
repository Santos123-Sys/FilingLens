import { describe, expect, it } from "vitest";
import type { FilingAnalysis } from "@contracts/analysis";
import { buildCompanyPowerPointBytes } from "./powerpoint";

const analysis: FilingAnalysis = {
  schemaVersion: "2.0",
  jurisdiction: "us",
  metadata: { jurisdiction: "us", filingType: "10-K", reportingPeriod: "2026", filedAt: "2026-02-20", confidence: 0.99, cnpj: null, cvmDocumentClass: null, registryData: null, cik: "123", sicCode: null, fiscalYearEnd: null, stateOfIncorporation: null, sources: [{ section: "Item 1" }] },
  company: { name: "Example Corp", ticker: "EX", exchange: "NYSE", filingType: "10-K", periodEnd: "2026", filedAt: "2026-02-20", description: "Example company used for PPTX generation tests." },
  kpis: [{ label: "Revenue", value: "$120", delta: "+10%", positive: true, source: { section: "Item 8" } }],
  market: { industry: "Software", competitors: ["Peer Inc"], peerEvidence: [{ name: "Peer Inc", sourceType: "external", source: { section: "Independent web research", kind: "citation", url: "https://example.com/peer", publisher: "Example" } }], externalResearchStatus: "complete", geographies: [], segments: [] },
  risks: [{ title: "Competition", category: "Market", severity: 4, summary: "Competitive pressure can reduce growth.", source: { section: "Item 1A" } }],
  financials: { unit: "USD millions", years: ["2025", "2026"], revenue: [100, 120], netIncome: [10, 14], eps: [1, 1.3], grossMargin: [60, 62], operatingMargin: [20, 22], operatingCashFlow: [15, 19], capex: [-3, -4], freeCashFlow: [12, 15], dividends: null, buybacks: null, totalAssets: [200, 230], totalDebt: [50, 45], cash: [30, 42], forwardGuidance: [], evidence: [{ metric: "Revenue", period: "2026", source: { section: "Item 8" } }] },
  timeline: [], events: [{ date: "2026-01-10", title: "Launch", category: "Product", impact: "New product launched", source: { section: "Item 1" } }],
  summary: ["Revenue increased while cash generation improved."], confidenceNotes: [], missingData: [], diagnostics: {},
};

describe("PowerPoint generator", () => {
  it("builds a valid ZIP-based pptx package with presentation and slide entries", () => {
    const bytes = buildCompanyPowerPointBytes(analysis, "en");
    expect(bytes.length).toBeGreaterThan(20_000);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("ppt/presentation.xml");
    expect(text).toContain("ppt/slides/slide10.xml");
    expect(text).toContain("Example Corp");
    expect(text).toContain("example.com/peer");
  });
});
