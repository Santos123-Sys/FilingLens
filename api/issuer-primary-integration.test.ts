import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { APPLE_2025_ACCEPTED_SHA256, buildAppleIssuerPrimarySnapshot, registerIssuerPrimaryIntegration } from "./issuer-primary-integration";
import { APPLE_2025_DISCLOSURE } from "../contracts/issuer-statement-proof";

const token = "a".repeat(48);
const table = ("Apple Inc.\nCONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)\n" +
  "(In millions) Twelve Months Ended September 27, 2025\n" +
  "Total net sales 102,466 94,930 416,161 391,035\n" +
  "Gross margin 48,341 43,879 195,201 180,683\n" +
  "Operating income 32,427 29,591 133,050 123,216\n" +
  "Net income 27,466 14,736 112,010 93,736\n").repeat(5);
const doc = { url: APPLE_2025_DISCLOSURE.url, text: table,
  sha256: APPLE_2025_ACCEPTED_SHA256, retrievedAt: "2026-10-09T09:29:42.339Z" };
const path = "/api/integration/v1/issuers/us/0000320193/issuer-statement";
function app(load = async () => doc) {
  const a = new Hono();
  registerIssuerPrimaryIntegration(a, { enabled: () => true, token: () => token, load });
  return a;
}
describe("issuer-published integration", () => {
  it("requires an authenticated consumer", async () => {
    expect((await app().request(path)).status).toBe(401);
  });
  it("returns distinct provenance and a validated digest", async () => {
    const response = await app().request(path, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const { contentHash, ...body } = await response.json() as Record<string, unknown>;
    expect(contentHash).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    expect(body.provenance).toBe("issuer_published_unaudited_pdf");
    expect(body.secCompanyFactsVerified).toBe(false);
    expect(body.revenueGrowthYoYPct).toBeNull();
  });
  it("refuses changed document digests", async () => {
    expect(await buildAppleIssuerPrimarySnapshot({ ...doc, sha256: "f".repeat(64) })).toBeNull();
  });
});
