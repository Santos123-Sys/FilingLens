import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAnalysisPipeline } from "./analysis-pipeline";

const input = () => ({
  text: "fixture ".repeat(400),
  classification: {
    jurisdiction: "us" as const,
    filingType: "10-K",
    confidence: 1,
    needsConfirmation: false,
    signals: [],
  },
  fileName: "fixture.pdf",
  lang: "en" as const,
  signal: new AbortController().signal,
  onStage: vi.fn(),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("browser retry boundary", () => {
  it("does not retry unknown internal server errors", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const fetch = vi.fn(async () => json({ error: "internal" }, 500));
    vi.stubGlobal("fetch", fetch);
    await expect(executeAnalysisPipeline(input())).rejects.toMatchObject({
      code: "internal",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains one fresh retry for classified provider outages", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const fetch = vi.fn(async () => json({ error: "ai_transient" }, 503));
    vi.stubGlobal("fetch", fetch);
    await expect(executeAnalysisPipeline(input())).rejects.toMatchObject({
      code: "ai_transient",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const ids = fetch.mock.calls.map(call =>
      new Headers((call as unknown as [string, RequestInit])[1].headers).get(
        "X-FilingLens-Run-Id"
      )
    );
    expect(ids[0]).toMatch(/^[a-z0-9-]+$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it("does not retry rejected structured output", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const fetch = vi.fn(async () => json({ error: "ai_invalid_request" }, 422));
    vi.stubGlobal("fetch", fetch);
    await expect(executeAnalysisPipeline(input())).rejects.toMatchObject({
      code: "ai_invalid_request",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
