import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { registerDcfSwarm } from "./routes";
import { AnalysisAccessError } from "../analysis-access";
import type { requireAnalysisAccess } from "../analysis-access";
afterEach(() => vi.unstubAllEnvs());
const ctx = { workspaceId: "account-a", issuerId: "us:0000320193" } as Awaited<
  ReturnType<typeof requireAnalysisAccess>
>;
function setup(authorization = true) {
  vi.stubEnv("DATABASE_URL", "mysql://synthetic");
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(
    async sql =>
      sql.includes("GET_LOCK")
        ? [[{ acquired: 1 }]]
        : sql.includes("COUNT")
          ? [[{ n: 0 }]]
          : [[]]
  );
  const end = vi.fn(async () => {});
  const connect = vi.fn(async () => ({ query, end }));
  const run = vi.fn();
  const load = vi.fn();
  const app = new Hono();
  registerDcfSwarm(app, {
    authorize: async () => {
      if (!authorization) throw new AnalysisAccessError(401);
      return ctx;
    },
    connect: connect as never,
    run,
    load,
  });
  const post = (body: unknown) =>
    app.request("/api/dcf-swarm", {
      method: "POST",
      body: JSON.stringify(body),
    });
  return { post, query, run, load, connect };
}
describe("DCF HTTP boundary", () => {
  it("denies anonymous requests before database or model calls", async () => {
    const s = setup(false);
    expect(
      (await s.post({ action: "read", issuerId: ctx.issuerId })).status
    ).toBe(401);
    expect(s.connect).not.toHaveBeenCalled();
  });
  it("rejects a different issuer and caller-supplied evidence", async () => {
    const s = setup();
    expect(
      (await s.post({ action: "read", issuerId: "br:33000167000101" })).status
    ).toBe(403);
    expect(
      (
        await s.post({
          action: "read",
          issuerId: ctx.issuerId,
          evidence: ["poisoned"],
        })
      ).status
    ).toBe(422);
    expect(s.connect).not.toHaveBeenCalled();
  });
  it("reads only current account and issuer", async () => {
    const s = setup();
    expect(
      (await s.post({ action: "read", issuerId: ctx.issuerId })).status
    ).toBe(200);
    expect(
      s.query.mock.calls.find(c => c[0].startsWith("SELECT id,status"))?.[1]
    ).toEqual([ctx.workspaceId, ctx.issuerId]);
  });
  it("disabled generation cannot call providers", async () => {
    vi.stubEnv("DCF_SWARM_ENABLED", "false");
    const s = setup();
    expect(
      (
        await s.post({
          action: "run",
          issuerId: ctx.issuerId,
          runId: crypto.randomUUID(),
          brief: {
            question: "Which assumptions are defensible here?",
            startYear: 2021,
            endYear: 2025,
            language: "en",
          },
        })
      ).status
    ).toBe(503);
    expect(s.run).not.toHaveBeenCalled();
    expect(s.load).not.toHaveBeenCalled();
  });
});

it("persists before generation and bounds daily paid runs", async () => {
  vi.stubEnv("DCF_SWARM_ENABLED", "true");
  const s = setup();
  const body = {
    action: "run",
    issuerId: ctx.issuerId,
    runId: crypto.randomUUID(),
    brief: {
      question: "Which assumptions are defensible here?",
      startYear: 2021,
      endYear: 2025,
      language: "en",
    },
  };
  s.run.mockImplementation(async () => {
    expect(s.query.mock.calls.some(c => c[0].startsWith("INSERT INTO"))).toBe(
      true
    );
    return { status: "needs_human_review" };
  });
  expect((await s.post(body)).status).toBe(200);
  expect(s.run).toHaveBeenCalledTimes(1);
  const capped = setup();
  capped.query.mockImplementation(async (sql: string) =>
    sql.includes("GET_LOCK")
      ? [[{ acquired: 1 }]]
      : sql.includes("COUNT")
        ? [[{ n: 3 }]]
        : [[]]
  );
  expect((await capped.post(body)).status).toBe(429);
  expect(capped.run).not.toHaveBeenCalled();
});
it("does not execute a colliding saved run from another workspace", async () => {
  vi.stubEnv("DCF_SWARM_ENABLED", "true");
  const s = setup();
  s.query.mockImplementation(async (sql: string) =>
    sql.includes("GET_LOCK")
      ? [[{ acquired: 1 }]]
      : sql.includes("SELECT workspace_id")
        ? [
            [
              {
                workspace_id: "account-b",
                request_hash: "different",
                status: "running",
                output_json: null,
              },
            ],
          ]
        : [[]]
  );
  expect(
    (
      await s.post({
        action: "run",
        issuerId: ctx.issuerId,
        runId: crypto.randomUUID(),
        brief: {
          question: "Which assumptions are defensible here?",
          startYear: 2021,
          endYear: 2025,
          language: "en",
        },
      })
    ).status
  ).toBe(409);
  expect(s.run).not.toHaveBeenCalled();
  expect(s.load).not.toHaveBeenCalled();
});
