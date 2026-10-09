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

  it("prioritizes Brazilian segment disclosures even when they appear late in a long filing", () => {
    const filing = [
      "Relatório trimestral",
      "X".repeat(70_000),
      "Informações contábeis por segmento de negócio",
      "Segmento Exploração e Produção | Receita líquida R$ 87,2 bilhões | Resultado R$ 25,4 bilhões",
      "Y".repeat(55_000),
    ].join("\n");
    const market = buildAgentInput("market", filing);
    expect(market).toContain("Informações contábeis por segmento de negócio");
    expect(market).toContain("Receita líquida R$ 87,2 bilhões");
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

describe("bounded source coverage regressions", () => {
  it("keeps the late body statement after repeated contents aliases", () => {
    const contents = Array.from({ length: 8 }, () => `Item 8. Financial Statements\n${"contents ".repeat(1300)}`).join("\n");
    const text = `${contents}\n${"filler ".repeat(6000)}\nItem 8. Financial Statements\nRevenue FY2025 USD millions 416161\nAccounting footnote: consolidated.\n${"appendix ".repeat(18000)}`;
    const excerpt = buildAgentInput("financials", createAnalysisCorpus(text));
    expect(excerpt).toContain("Revenue FY2025 USD millions 416161");
    expect(excerpt).toContain("Accounting footnote: consolidated.");
  });

  it("does not deduplicate different evidence families sharing a long prefix", () => {
    const text = `${"common cover ".repeat(40)}\nItem 1. Business\n${"overview ".repeat(1200)}\nItem 8. Financial Statements\nRevenue 987\n${"appendix ".repeat(19000)}`;
    expect(buildAgentInput("financials", text)).toContain("Revenue 987");
  });

  it("keeps every document and tail evidence inside the six-document hard cap", () => {
    const bundle = Array.from({ length: 6 }, (_, i) => `[FILINGLENS_DOCUMENT ${i + 1}/6: filing-${i}.pdf]\nFORM 10-K\n${"cover ".repeat(12000)}\nItem 1A. Risk Factors\n${"risk ".repeat(2000)}\nTAIL_EVIDENCE_${i}\n[/FILINGLENS_DOCUMENT ${i + 1}]`).join("\n");
    const excerpt = buildAgentInput("risks", bundle);
    expect(excerpt.length).toBeLessThanOrEqual(100000);
    for (let i = 0; i < 6; i++) {
      expect(excerpt).toContain(`Filing bundle document ${i + 1}`);
      // Tail family is allocated independently and never clipped by label overhead.
      expect(excerpt).toContain(`TAIL_EVIDENCE_${i}`);
    }
  });

  it("does not duplicate a short source and preserves a stable normalized-text ID", () => {
    const text = "Item 8. Financial Statements\nRevenue 100\nFootnote: USD millions.";
    const first = buildAgentInput("financials", text);
    expect(first.match(/Revenue 100/g)).toHaveLength(1);
    expect(buildAgentInput("financials", text)).toBe(first);
    expect(first).toMatch(/normalized-text-sha256:[a-f0-9]{64}/);
    expect(buildAgentInput("financials", text + " changed")).not.toBe(first);
  });
});
