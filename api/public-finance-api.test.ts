import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { buildPublicFinanceSnapshot } from "../contracts/public-finance";
import { registerPublicFinanceApi } from "./public-finance-api";

const token = "t".repeat(48);
const snapshot = buildPublicFinanceSnapshot({
  issuer: { jurisdiction: "us", registryId: "0000320193" },
  provider: "sec_edgar",
  archivedOn: "2026-10-10",
  facts: [{
    metric: "revenue", value: "120", unit: "USD millions", currency: "USD", fiscalYear: 2025,
    periodEnd: "2025-09-27", periodLabel: "FY 2025", status: "single_source",
    sources: [{ url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json", provider: "sec_edgar", form: "10-K", retrievedAt: "2026-10-10" }],
  }],
});

function testApp(options: { enabled?: boolean; found?: boolean } = {}) {
  const app = new Hono();
  const load = vi.fn(async () => options.found === false ? null : snapshot);
  registerPublicFinanceApi(app, { load, token: () => token, enabled: () => options.enabled !== false });
  return { app, load };
}

describe("public finance integration API", () => {
  it("advertises a bounded read-only shared intelligence capability", async () => {
    const { app } = testApp();
    const response = await app.request("/api/integration/v1/capabilities");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "filinglens-public-finance-v1",
      mode: "read_only",
      consumers: ["global_portfolio_intelligence", "portfolio_risk_return"],
      configured: true,
    });
  });

  it("requires the dedicated server token and normalizes a US CIK", async () => {
    const { app, load } = testApp();
    const path = "/api/integration/v1/issuers/us/320193/financial-snapshot";
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const response = await app.request(path, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(load).toHaveBeenCalledWith("us", "0000320193");
    await expect(response.json()).resolves.toMatchObject({ schemaVersion: "filinglens-public-finance-v1" });
  });

  it("separates disabled, invalid, and unavailable identities", async () => {
    const disabled = testApp({ enabled: false });
    expect((await disabled.app.request("/api/integration/v1/issuers/us/320193/financial-snapshot")).status).toBe(503);
    const missing = testApp({ found: false });
    const headers = { Authorization: `Bearer ${token}` };
    expect((await missing.app.request("/api/integration/v1/issuers/us/0000000000/financial-snapshot", { headers })).status).toBe(400);
    expect((await missing.app.request("/api/integration/v1/issuers/br/123/financial-snapshot", { headers })).status).toBe(400);
    expect((await missing.app.request("/api/integration/v1/issuers/us/789019/financial-snapshot", { headers })).status).toBe(404);
  });
});

