import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerBrazilFundamentalsApi } from "./brazil-fundamentals-api";
const token = "t".repeat(40);
function setup() {
  const app = new Hono(), retrieve = vi.fn(async () => ({ schemaVersion: "cvm-companyfacts.v1", facts: [] }));
  registerBrazilFundamentalsApi(app, { token: () => token, retrieve });
  return { app, retrieve };
}
const send = (app: Hono, body: unknown, authorized = true) => app.request("/api/integration/v1/brazil/fundamentals", {
  method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body),
});
describe("CVM fundamentals integration API", () => {
  it("authorizes before acquiring and rejects unbounded or point-in-time requests", async () => {
    const { app, retrieve } = setup();
    expect((await send(app, { operation: "screen" }, false)).status).toBe(401);
    for (const body of [{ operation: "screen", limit: 10000 }, { operation: "facts" },
      { operation: "facts", cnpj: "33000167000101", asOf: "2020-01-01" }, { operation: "screen", year: 2200 }])
      expect((await send(app, body)).status).toBe(400);
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("returns provenance and preserves source failures without invented facts", async () => {
    const { app, retrieve } = setup();
    const response = await send(app, { operation: "facts", cnpj: "33000167000101", form: "ITR", year: 2025 });
    expect(response.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({ scope: "consolidated", limit: 50, form: "ITR" }));
    retrieve.mockRejectedValueOnce(new Error("sensitive upstream detail"));
    const failure = await send(app, { operation: "screen" });
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("sensitive");
  });
  it("reports checked-in SEC pause without an HTTP probe", async () => {
    const { app, retrieve } = setup();
    const response = await app.request("/api/integration/v1/regulatory-access");
    expect((await response.json() as {sec: unknown}).sec).toMatchObject({ status: "paused", liveRetrievalVerified: false });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
