import { describe, it, expect } from "vitest";
import {
  buildFinancialLineage,
  financialAuditExport,
  safeEvidenceUrl,
  financialQuoteMatch,
} from "./financial-lineage";
import { valuationFixture } from "../api/fixtures/valuation-case";
import { prepareDcf, calculateDcf } from "../api/valuation/dcf";
import type { ValuationAssumption } from "./analysis";
const ledger = (): ValuationAssumption[] =>
  prepareDcf(valuationFixture()).assumptions.map(r => ({
    ...r,
    status: "accepted",
    final_value:
      (
        {
          "dcf.risk_free_rate": 10,
          "dcf.beta": 0,
          "dcf.equity_risk_premium": 0,
          "dcf.debt_weight": 0,
          "dcf.terminal_roic": 10,
          "dcf.terminal_growth": 2,
          "dcf.equity_adjustment": 0,
        } as Record<string, number>
      )[r.id] ?? (r.id.startsWith("dcf.revenue_growth_y") ? 0 : r.proposed_value),
  }));
describe("source-to-number and input lineage", () => {
  it("highlights whole numeric tokens without attaching a false match to another amount", () => {
    expect(financialQuoteMatch("Revenue 1,100 for FY2025", 100)).toBeNull();
    expect(financialQuoteMatch("Revenue 100.5 for FY2025", 100)).toBeNull();
    expect(
      financialQuoteMatch("Revenue 416,161 in FY2025", 416161)?.token
    ).toBe("416,161");
    expect(financialQuoteMatch("Capex (12,715)", -12715)?.token).toBe(
      "(12,715)"
    );
  });
  it("propagates conflicting input evidence without calling analyst acceptance verification", () => {
    const a = valuationFixture();
    a.financials.validationFlags = [
      {
        code: "SOURCE_MISMATCH",
        severity: "error",
        period: "2025",
        note: "Synthetic contradiction",
      },
    ];
    const assumptions = ledger(),
      dcf = calculateDcf(a, assumptions),
      g = buildFinancialLineage(a, { assumptions: { dcf: assumptions }, dcf });
    expect(g.nodes["dcf:implied_per_share"].status).toBe(
      "conflicting_evidence"
    );
    expect(g.nodes["dcf:implied_per_share"].limitations.join(" ")).toContain(
      "linked input"
    );
  });
  it("never borrows a quote from another period, and preserves conflicting evidence", () => {
    const a = valuationFixture();
    a.financials.evidence = [
      {
        metric: "revenue",
        period: "FY2024",
        source: {
          section: "Sales",
          quote: "Revenue 100 in 2024",
          url: "https://issuer.test/2024",
        },
      },
    ];
    const graph = buildFinancialLineage(a);
    expect(graph.nodes["actual:revenue:0"].status).toBe("source_linked");
    expect(graph.nodes["actual:revenue:1"].sources).toEqual([]);
    expect(graph.nodes["actual:revenue:1"].status).toBe("unverified");
    a.financials.validationFlags = [
      {
        code: "SOURCE_MISMATCH",
        period: "2024",
        severity: "error",
        note: "Two reports disagree",
      },
    ];
    expect(buildFinancialLineage(a).nodes["actual:revenue:0"].status).toBe(
      "conflicting_evidence"
    );
  });
  it("exposes a traversable result → formula → input → period-specific document path", () => {
    const a = valuationFixture(),
      assumptions = ledger(),
      dcf = calculateDcf(a, assumptions);
    a.financials.evidence = [
      {
        metric: "revenue",
        period: "2025",
        source: {
          section: "Sales",
          quote: "Revenue was 100",
          url: "https://issuer.test/2025",
        },
      },
    ];
    const graph = buildFinancialLineage(a, {
      assumptions: { dcf: assumptions },
      dcf,
    });
    expect(graph.nodes["dcf:implied_per_share"].inputs).toContain(
      "dcf:equity_value"
    );
    expect(graph.nodes["forecast:Y1:revenue"].inputs).toContain(
      "dcf.base_revenue"
    );
    expect(graph.nodes["dcf.base_revenue"].inputs).toContain(
      "actual:revenue:1"
    );
    expect(graph.nodes["dcf.net_debt"].inputs).toEqual([
      "actual:totalDebt:1",
      "actual:cash:1",
    ]);
    expect(graph.nodes["terminal:fcff"].formula).toContain("reinvestment");
    expect(graph.nodes["actual:revenue:1"].sources[0].url).toBe(
      "https://issuer.test/2025"
    );
    expect(
      Object.values(graph.nodes).every(n =>
        n.inputs.every(id => Boolean(graph.nodes[id]))
      )
    ).toBe(true);
  });
  it("preserves original evidence and calculation versions in exports without session credentials", () => {
    const a = valuationFixture(),
      assumptions = ledger(),
      dcf = calculateDcf(a, assumptions);
    const exported = financialAuditExport(a, {
      assumptions: { dcf: assumptions },
      dcf,
    });
    expect(exported.financials).toEqual(a.financials);
    expect(exported.lineage.calculationVersion).toBe("fcff-roic.v2");
    expect(JSON.stringify(exported)).not.toContain("ticket");
  });
  it("rejects script, credential-bearing and tokenized links without fetching them", () => {
    for (const u of [
      "javascript:alert(1)",
      "https://user:password@issuer.test/",
      "https://issuer.test/?api_key=secret",
      "file:///etc/passwd",
    ])
      expect(safeEvidenceUrl(u)).toBeNull();
    expect(safeEvidenceUrl("https://issuer.test/annual.pdf")).toBe(
      "https://issuer.test/annual.pdf"
    );
  });
});
