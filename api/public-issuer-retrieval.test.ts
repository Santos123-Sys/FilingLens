import { describe, expect, it } from "vitest";
import apple from "./fixtures/apple-fy2025-issuer-statement.json";
import { buildAgentInput, extractFilingText, BadFiling } from "./analyze";
import { verifyIssuerApple2025Point } from "../contracts/issuer-statement-proof";
import type { MarketResult } from "../contracts/analysis";

type Peer = NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number];
type Point = NonNullable<Peer["dataPoints"]>[number];
const point = (label: string, value: string): Point => ({
  label, value, period: "FY2025", context: "consolidated US GAAP; period end 2025-09-27",
  source: { kind: "citation", section: "Apple FY2025 filing", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm" },
});
const document = { url: apple.url, text: apple.text, sha256: apple.pdfSha256, retrievedAt: apple.retrievedAt };

describe("public issuer statement evidence retention", () => {
  it("keeps real annual financial rows and verifies values using the existing deterministic path", () => {
    const excerpt = buildAgentInput("financials", apple.text);
    const selected = { ...document, text: excerpt };
    for (const [label, value] of [["Revenue", "416161"], ["Operating income", "133050"], ["Net income", "112010"], ["Gross profit", "195201"]]) {
      expect(verifyIssuerApple2025Point("Apple Inc.", point(label, `USD ${value} millions`), selected).status).toBe("verified");
    }
    expect(verifyIssuerApple2025Point("Apple Inc.", point("Revenue", "USD 1 millions"), selected).status).toBe("amount_mismatch");
    expect(verifyIssuerApple2025Point("Other Issuer", point("Revenue", "USD 416161 millions"), selected).status).toBe("source_mismatch");
    expect(verifyIssuerApple2025Point("Apple Inc.", { ...point("Revenue", "USD 416161 millions"), period: "FY2024" }, selected).status).toBe("source_mismatch");
  });
  it("rejects corrupt PDF bytes before analysis", async () => {
    await expect(extractFilingText(Buffer.from("not a readable PDF"))).rejects.toBeInstanceOf(BadFiling);
  });
});
