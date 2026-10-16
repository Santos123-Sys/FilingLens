import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerValuationPublisher } from "./valuation-publisher";
import { valuationFixture } from "./fixtures/valuation-case";
import { prepareDcf, calculateDcf } from "./valuation/dcf";
import type { ValuationAssumption } from "../contracts/analysis";
const workspace = "550e8400-e29b-41d4-a716-446655440000",
  id = "flv1_" + "a".repeat(64),
  token = "t".repeat(40);
const a = valuationFixture();
const assumptions: ValuationAssumption[] = prepareDcf(a).assumptions.map(r => ({
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
    )[r.id] ?? r.proposed_value,
}));
const result = calculateDcf(a, assumptions);
const record = {
  payload_json: JSON.stringify({
    valuationVersionId: id,
    issuerId: "us:0000000001",
    method: "dcf",
  }),
  audit_json: JSON.stringify({
    company: a.company,
    financials: a.financials,
    metadata: a.metadata,
    assumptions,
    result,
  }),
};
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "mysql://fixture");
  vi.stubEnv("FILINGLENS_VALUATION_READ_API_TOKEN", token);
});
function app() {
  let calls = 0;
  const db = {
    query: async (_sql: string, params: string[]) => {
      calls++;
      return [params[0] === id && params[1] === workspace ? [record] : []];
    },
    end: async () => {},
  };
  const h = new Hono();
  registerValuationPublisher(h, (async () => db) as never);
  return { h, calls: () => calls };
}
describe("private published valuation lineage", () => {
  it("rejects anonymous reads before database access", async () => {
    const { h, calls } = app();
    expect(
      (await h.request(`/api/integration/v1/valuations/${id}/audit`)).status
    ).toBe(401);
    expect(calls()).toBe(0);
  });
  it("requires service authority and workspace scope and returns no other workspace record", async () => {
    const { h } = app();
    const headers = {
      authorization: "Bearer " + token,
      "X-Workspace-Id": workspace,
    };
    expect(
      (
        await h.request(`/api/integration/v1/valuations/${id}/audit`, {
          headers: { authorization: headers.authorization },
        })
      ).status
    ).toBe(400);
    expect(
      (
        await h.request(`/api/integration/v1/valuations/${id}/audit`, {
          headers: {
            ...headers,
            "X-Workspace-Id": "550e8400-e29b-41d4-a716-446655440001",
          },
        })
      ).status
    ).toBe(404);
    const response = await h.request(
      `/api/integration/v1/valuations/${id}/audit`,
      { headers }
    );
    const data = await response.json() as {lineage: import("../contracts/financial-lineage").FinancialLineage};
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data).toMatchObject({
      schemaVersion: "valuation-audit.v1",
      valuationVersionId: id,
      issuerId: "us:0000000001",
    });
    expect(data.lineage.nodes["dcf:implied_per_share"].inputs).toContain(
      "dcf:equity_value"
    );
    expect(JSON.stringify(data)).not.toContain(token);
  });
});
