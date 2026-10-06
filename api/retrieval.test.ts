import { describe, expect, it } from "vitest";
import { buildAgentInput, createAnalysisCorpus } from "./analyze";

describe("section-aware filing retrieval", () => {
  it("retains separated 10-Q financial, market and risk evidence in a long filing", () => {
    const filing = [
      "NVIDIA CORPORATION FORM 10-Q Commission File Number 0-23985",
      "A".repeat(90_000),
      "PART I ITEM 1. FINANCIAL STATEMENTS\nCONDENSED CONSOLIDATED STATEMENTS OF INCOME\nRevenue 96,221 Net income 59,688",
      "B".repeat(75_000),
      "CONDENSED CONSOLIDATED BALANCE SHEETS\nTotal assets 206,803 Cash and cash equivalents 17,621",
      "C".repeat(70_000),
      "Note 12 — Segment Information\nData Center revenue 89,023 Gaming revenue 4,287",
      "D".repeat(65_000),
      "ITEM 1A. RISK FACTORS\nCybersecurity and supply concentration risks may materially affect our operations.",
      "E".repeat(45_000),
      "ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS\nQuarterly revenue and margin discussion.",
    ].join("\n");

    const corpus = createAnalysisCorpus(filing);
    expect(corpus.length).toBeLessThanOrEqual(320_000);
    expect(corpus).toContain("CONDENSED CONSOLIDATED STATEMENTS OF INCOME");
    expect(corpus).toContain("CONDENSED CONSOLIDATED BALANCE SHEETS");
    expect(corpus).toContain("Segment Information");
    expect(corpus).toContain("ITEM 1A. RISK FACTORS");

    const financials = buildAgentInput("financials", corpus);
    expect(financials).toContain("Revenue 96,221");
    expect(financials).toContain("Total assets 206,803");

    const market = buildAgentInput("market", corpus);
    expect(market).toContain("Data Center revenue 89,023");

    const risks = buildAgentInput("risks", corpus);
    expect(risks).toContain("Cybersecurity and supply concentration risks");
  });

  it("preserves evidence from every document in a filing bundle", () => {
    const bundle = [
      "[FILINGLENS_DOCUMENT 1/2: quarterly.pdf]\nFORM 10-Q\nITEM 1. FINANCIAL STATEMENTS\nRevenue 100\n[/FILINGLENS_DOCUMENT 1]",
      "[FILINGLENS_DOCUMENT 2/2: earnings.pdf]\nFORM 8-K\nEXHIBIT 99.1\nData Center revenue 90\n[/FILINGLENS_DOCUMENT 2]",
    ].join("\n");

    const input = buildAgentInput("market", bundle);
    expect(input).toContain("Filing bundle document 1");
    expect(input).toContain("Filing bundle document 2");
    expect(input).toContain("Data Center revenue 90");
  });
});
