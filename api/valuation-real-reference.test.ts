import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import reference from "../src/data/apple-valuation-reference.json";
import statement from "./fixtures/apple-fy2025-issuer-statement.json";
import { calculateDcf } from "./valuation/dcf";
import {
  companySchema,
  metadataSchema,
  financialsSchema,
  valuationAssumptionSchema,
  type FilingAnalysis,
} from "../contracts/analysis";
import { financialAuditExport } from "../contracts/financial-lineage";
const assumptions = reference.reviewedDcfAssumptions.map(r =>
  valuationAssumptionSchema.parse(r)
);

describe("real issuer statement → audited arithmetic reference", () => {
  it("preserves exact original quotes for the correct annual series", () => {
    companySchema.shape.company.parse(reference.analysis.company);
    metadataSchema.parse({ metadata: reference.analysis.metadata });
    financialsSchema.parse({ financials: reference.analysis.financials });
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const e of reference.analysis.financials.evidence)
      expect(normalize(statement.text)).toContain(normalize(e.source.quote));
    for (const r of assumptions)
      if (r.source?.quote)
        expect(normalize(statement.text)).toContain(normalize(r.source.quote));
    expect(reference.source.pdfSha256).toBe(statement.pdfSha256);
    expect(reference.analysis.financials.revenue).toEqual([391035, 416161]);
  });
  it("matches the independent Python reference through equity and preserves it on export", () => {
    const analysis = reference.analysis as unknown as FilingAnalysis,
      result = calculateDcf(analysis, assumptions);
    expect(result.figures.enterprise_value.value).toBeCloseTo(
      reference.independentReference.enterpriseValue,
      2
    );
    expect(result.figures.equity_value.value).toBeCloseTo(
      reference.independentReference.equityValue,
      2
    );
    expect(result.figures.implied_per_share.value).toBe(118.74);
    expect(result.terminal!.fcff).toBeCloseTo(
      reference.independentReference.terminalFcff,
      5
    );
    const exported = financialAuditExport(analysis, {
      assumptions: { dcf: assumptions },
      dcf: result,
    });
    expect(exported.lineage.nodes["actual:revenue:1"].sources[0].url).toBe(
      statement.url
    );
    expect(exported.lineage.nodes["dcf:implied_per_share"].value).toBe(118.74);
    expect(
      createHash("sha256")
        .update(JSON.stringify(exported.financials))
        .digest("hex")
    ).toHaveLength(64);
  });
});
