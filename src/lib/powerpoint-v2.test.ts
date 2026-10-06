import { describe, expect, it } from "vitest";
import type { FilingAnalysis } from "@contracts/analysis";
import { buildCompanyPowerPointV2 } from "./powerpoint-v2";

const sample: FilingAnalysis = {
  schemaVersion: "2.0",
  jurisdiction: "us",
  metadata: {
    jurisdiction: "us",
    filingType: "10-Q",
    reportingPeriod: "2026-07-26",
    filedAt: "2026-08-26",
    confidence: 0.99,
    cnpj: null,
    cvmDocumentClass: null,
    registryData: null,
    cik: "1045810",
    sicCode: "3674",
    fiscalYearEnd: "0125",
    stateOfIncorporation: "DE",
    sources: [],
  },
  company: {
    name: "NVIDIA Corporation",
    ticker: "NVDA",
    exchange: "Nasdaq",
    filingType: "10-Q",
    periodEnd: "2026-07-26",
    filedAt: "2026-08-26",
    description: "Designer of accelerated computing platforms and related software.",
  },
  kpis: [],
  market: { industry: "AI infrastructure", competitors: [], geographies: [], segments: [], externalResearchStatus: "unavailable" },
  risks: [],
  financials: {
    unit: "USD millions",
    years: ["Q2 FY2026", "Q2 FY2027"],
    revenue: [46743, 96221],
    netIncome: [26422, 59688],
    eps: [1.08, 2.46],
    grossMargin: [72.4, 75],
    operatingMargin: null,
    operatingCashFlow: null,
    capex: null,
    freeCashFlow: null,
    dividends: null,
    buybacks: null,
    totalAssets: [206803],
    totalDebt: null,
    cash: null,
    forwardGuidance: [],
    evidence: [],
  },
  timeline: [],
  events: [],
  summary: ["Revenue increased year over year."],
  confidenceNotes: [],
  missingData: [],
  diagnostics: {
    metadata: { status: "complete" },
    profiler: { status: "complete" },
    financials: { status: "complete" },
    market: { status: "incomplete" },
    risks: { status: "incomplete" },
    historian: { status: "complete" },
    synthesizer: { status: "complete" },
  },
};

describe("PowerPoint v2 OOXML", () => {
  it("uses PowerPoint-compatible layout IDs and widescreen dimensions", () => {
    const deck = buildCompanyPowerPointV2(sample, "en");
    expect(deck.slideCount).toBe(8);
    expect(Array.from(deck.bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    // STORE-method package keeps XML visible in the byte stream, which lets this
    // regression test catch the exact invalid OOXML that Microsoft PowerPoint
    // rejected in the legacy renderer.
    const raw = new TextDecoder().decode(deck.bytes);
    expect(raw).toContain('<p:sldLayoutId id="2147483649" r:id="rId1"/>');
    expect(raw).not.toContain('<p:sldLayoutId id="1" r:id="rId1"/>');
    expect(raw).toContain('<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>');
    expect(raw).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
  });
});
