import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GenerationGate,
  executionRuntimeStatus,
  safeErrorName,
  withExecutionScope,
  withModelExecution,
} from "./ai/execution";
import {
  classifyAiError,
  AiInvalidRequest,
  AiTransient,
} from "./lib/ai-client";
import { NoObjectGeneratedError } from "ai";

const signal = () => new AbortController().signal;
afterEach(() => vi.restoreAllMocks());

describe("process-wide model admission", () => {
  it("bounds concurrency, admits FIFO, rejects overflow and releases exactly once", async () => {
    const gate = new GenerationGate(1, 1);
    const release = await gate.acquire(signal(), 100);
    const second = gate.acquire(signal(), 100);
    await expect(gate.acquire(signal(), 100)).rejects.toBeInstanceOf(
      AiTransient
    );
    expect(gate.snapshot()).toEqual({ active: 1, queued: 1 });
    release();
    release();
    const releaseSecond = await second;
    expect(gate.snapshot()).toEqual({ active: 1, queued: 0 });
    releaseSecond();
    expect(gate.snapshot()).toEqual({ active: 0, queued: 0 });
  });

  it("removes aborted and expired waiters without leaking permits", async () => {
    const gate = new GenerationGate(1, 2);
    const release = await gate.acquire(signal(), 100);
    const controller = new AbortController();
    const aborted = gate.acquire(controller.signal, 100);
    const expired = gate.acquire(signal(), 5);
    const cancelledCheck = expect(aborted).rejects.toBeInstanceOf(AiTransient);
    const expiredCheck = expect(expired).rejects.toBeInstanceOf(AiTransient);
    controller.abort();
    await Promise.all([cancelledCheck, expiredCheck]);
    expect(gate.snapshot()).toEqual({ active: 1, queued: 0 });
    release();
    expect(gate.snapshot()).toEqual({ active: 0, queued: 0 });
  });
});

describe("request execution budgets and traces", () => {
  it("caps recovery calls and shares token usage within a request", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const call = vi.fn(async () => ({ usage: { totalTokens: 10 } }));
    await withExecutionScope(
      "market-research",
      "fixture-run",
      signal(),
      async () => {
        for (let i = 0; i < 3; i++) await withModelExecution("market", call);
        await expect(withModelExecution("market", call)).rejects.toBeInstanceOf(
          AiInvalidRequest
        );
      }
    );
    expect(call).toHaveBeenCalledTimes(3);
    // A new request has independent counters.
    await withExecutionScope("market", undefined, signal(), () =>
      withModelExecution("market", call)
    );
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("counts failed structured-output usage and blocks further work at the reported-token ceiling", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await withExecutionScope(
      "market-research",
      undefined,
      signal(),
      async () => {
        const error = Object.assign(new Error("secret filing body"), {
          usage: { totalTokens: 150_000 },
        });
        await expect(
          withModelExecution("market", async () => {
            throw error;
          })
        ).rejects.toBe(error);
        const next = vi.fn();
        await expect(withModelExecution("market", next)).rejects.toBeInstanceOf(
          AiInvalidRequest
        );
        expect(next).not.toHaveBeenCalled();
      }
    );
  });

  it("forwards deadlines and keeps the permit until provider cancellation settles", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      withExecutionScope(
        "profiler",
        undefined,
        signal(),
        () =>
          withModelExecution("profiler", async abort => {
            return new Promise((_, reject) =>
              abort.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true }
              )
            );
          }),
        5
      )
    ).rejects.toThrow("aborted");
    expect(executionRuntimeStatus().active).toBe(0);
    const call = vi.fn();
    await expect(
      withExecutionScope(
        "profiler",
        undefined,
        signal(),
        () => withModelExecution("profiler", call),
        -1
      )
    ).rejects.toBeInstanceOf(AiTransient);
    expect(call).not.toHaveBeenCalled();
  });

  it("bounds model work across independent simultaneous request scopes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const releases: (() => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise(resolve =>
          releases.push(() => resolve({ usage: { totalTokens: 1 } }))
        )
    );
    const runs = Array.from({ length: 3 }, () =>
      withExecutionScope("market", undefined, signal(), () =>
        withModelExecution("market", call)
      )
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(executionRuntimeStatus()).toMatchObject({ active: 2, queued: 1 });
    releases[0]();
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(3));
    releases[1]();
    releases[2]();
    await Promise.all(runs);
    expect(executionRuntimeStatus()).toMatchObject({ active: 0, queued: 0 });
  });

  it("logs correlation and usage without prompts, results or error payloads", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await withExecutionScope("market", "fixture-run", signal(), () =>
      withModelExecution("market", async () => ({
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        text: "private filing body",
      }))
    );
    const record = JSON.parse(log.mock.calls[0][0]);
    expect(record).toMatchObject({
      runId: "fixture-run",
      stage: "market",
      outcome: "complete",
      totalTokens: 5,
      usageKnown: true,
    });
    expect(log.mock.calls[0][0]).not.toContain("private filing body");
    expect(
      safeErrorName(
        Object.assign(new Error("private"), { name: "secret\nbody" })
      )
    ).toBe("Error");
  });
});

it("classifies schema failures as non-transient without exposing model text", () => {
  const error = new NoObjectGeneratedError({
    text: "private output",
    response: { id: "fixture", timestamp: new Date(), modelId: "fixture" },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: {},
      outputTokenDetails: {},
    } as never,
    finishReason: "stop",
  });
  const mapped = classifyAiError(error);
  expect(mapped).toBeInstanceOf(AiInvalidRequest);
  expect(mapped.message).not.toContain("private output");
});
