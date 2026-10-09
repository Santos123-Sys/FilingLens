import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import apple from "./fixtures/apple-fy2025-issuer-statement.json";
import { performance } from "node:perf_hooks";
import { buildAgentInput, createAnalysisCorpus } from "./analyze";

// Synthetic stress cases: these are not regulator filings or answer-quality judgments.
export function retrievalCases() {
  const aliases = Array.from({ length: 7 }, (_, i) => `Item 8. Financial Statements (contents alias ${i})\n${"contents filler ".repeat(850)}`).join("\n");
  return [
    { id: "public-apple-issuer-statement", agent: "financials" as const, text: apple.text, evidence: apple.expectedEvidence },
    { id: "sec-toc-body", agent: "financials" as const, text: `${aliases}\n${"body filler ".repeat(3000)}\nItem 8. Financial Statements\nUSD millions, FY2025 / FY2024\nRevenue 391035 383285\nFootnote: values are consolidated.\n${"appendix ".repeat(15000)}`, evidence: ["Revenue 391035 383285", "Footnote: values are consolidated."] },
    { id: "cvm-toc-body", agent: "market" as const, text: `${Array.from({ length: 6 }, (_, i) => `Informações por segmento ${i}\n${"sumário ".repeat(1200)}`).join("\n")}\n${"texto ".repeat(4000)}\nInformações contábeis por segmento de negócio\nBRL milhões, trimestre 2025 / 2024\nExploração e Produção receita 87200 resultado 25400\n${"anexo ".repeat(12000)}`, evidence: ["Exploração e Produção receita 87200 resultado 25400"] },
    { id: "sec-separated", agent: "financials" as const, text: `FORM 10-Q\n${"a".repeat(90000)}\nCONDENSED CONSOLIDATED STATEMENTS OF INCOME\nRevenue 96221\n${"b".repeat(75000)}\nCONDENSED CONSOLIDATED BALANCE SHEETS\nAssets 206803\n${"c".repeat(70000)}`, evidence: ["Revenue 96221", "Assets 206803"] },
    { id: "missing-evidence", agent: "market" as const, text: "FORM 10-K\nNo operating segment amounts are disclosed in this fixture.\n".repeat(400), evidence: [] },
  ];
}

describe("reproducible excerpt coverage evaluation", () => {
  it("reports exact-evidence coverage and CPU latency separately from answer accuracy", () => {
    const cases = retrievalCases();
    const result = cases.map(row => {
      const times: number[] = [];
      let excerpt = "";
      for (let n = 0; n < 100; n++) {
        const started = performance.now();
        excerpt = buildAgentInput(row.agent, createAnalysisCorpus(row.text));
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      const found = row.evidence.filter(e => excerpt.includes(e)).length;
      expect(found).toBe(row.evidence.length);
      expect(excerpt.length).toBeLessThanOrEqual(row.agent === "financials" ? 145000 : 105000);
      return { id: row.id, expected: row.evidence.length, found, excerptChars: excerpt.length, samples: times.length, p50Ms: times[49], p95Ms: times[94] };
    });
    if (process.env.RETRIEVAL_EVALUATION_OUTPUT) writeFileSync(process.env.RETRIEVAL_EVALUATION_OUTPUT, JSON.stringify(result, null, 2));
  });
});
