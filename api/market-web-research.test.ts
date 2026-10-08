import { describe, expect, it } from "vitest";
import { verifyCompetitiveResearch } from "./market-web-research";

describe("competitive research deep dives", () => {
  it("keeps only source-bound peer data, moat evidence and outlook claims", () => {
    const peerUrl = "https://example.com/peer";
    const dataUrl = "https://example.com/results";
    const moatUrl = "https://example.com/assets";
    const outlookUrl = "https://example.com/guidance";

    const verified = verifyCompetitiveResearch(
      {
        peers: [{
          name: "Peer Energy",
          relationship: "Competes in upstream production",
          positioning: "Large operator with a scaled offshore portfolio",
          strengths: ["Scale"],
          vulnerabilities: ["Commodity exposure"],
          dataPoints: [
            { label: "Production", value: "1.2m boe/day", period: "FY 2026", context: "Company-reported production", url: dataUrl },
            { label: "Unsupported metric", value: "99", period: "FY 2026", context: "Must be dropped", url: "https://example.com/not-cited" },
          ],
          moatAssessment: {
            rating: "strong",
            summary: "Scale and scarce assets support a durable cost position.",
            evidence: [
              { dimension: "Scarce assets", assessment: "Operates a cited portfolio of high-quality offshore assets.", url: moatUrl },
              { dimension: "Unsupported", assessment: "Must be dropped.", url: "https://example.com/not-cited" },
            ],
          },
          outlook: {
            stance: "favorable",
            horizon: "12–24 months",
            summary: "Management guidance indicates production growth.",
            drivers: ["Project ramp-up"],
            risks: ["Execution delays"],
            url: outlookUrl,
          },
          url: peerUrl,
        }],
        findings: [],
        marketShareProxies: [],
        marketStructure: null,
      },
      [
        { url: peerUrl, title: "Peer profile" },
        { url: dataUrl, title: "Peer results" },
        { url: moatUrl, title: "Peer assets" },
        { url: outlookUrl, title: "Peer guidance" },
      ],
      "2026-10-08",
    );

    const profile = verified.competitiveAnalysis.peerProfiles[0];
    expect(profile.dataPoints).toHaveLength(1);
    expect(profile.dataPoints?.[0]?.label).toBe("Production");
    expect(profile.moatAssessment?.evidence).toHaveLength(1);
    expect(profile.moatAssessment?.confidence).toBe("low");
    expect(profile.outlook?.stance).toBe("favorable");
    expect(verified.competitiveAnalysis.researchDiagnostics?.deepDivePeers).toBe(1);
    expect(verified.competitiveAnalysis.researchDiagnostics?.droppedClaims).toBe(2);
  });
});
