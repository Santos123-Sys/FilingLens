import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { AiInvalidRequest, AiTransient } from "../lib/ai-client";
import { MODEL_PINS } from "./provider";
import type { AnalysisStageName } from "../../contracts/analysis";

export const EXECUTION_POLICY = {
  version: "bounded-execution-v1",
  maxConcurrentGenerations: 2,
  maxQueuedGenerations: 8,
  queueTimeoutMs: 10_000,
  maxGenerationsPerRequest: 3,
  maxReportedTokensPerRequest: 150_000,
} as const;

export function requestBudgetMs(stage: string): number {
  if (["financials", "historian", "synthesizer"].includes(stage))
    return 210_000;
  if (stage === "market-research") return 140_000;
  return 120_000;
}

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
type Trace = {
  runId: string;
  requestId: string;
  stage: string;
  deadline: number;
  signal?: AbortSignal;
  generations: number;
  reportedTokens: number;
};
const execution = new AsyncLocalStorage<Trace>();

export function withExecutionScope<T>(
  stage: string,
  runId: string | undefined,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
  budgetMs = requestBudgetMs(stage)
): Promise<T> {
  const requestId = randomUUID();
  // Correlation labels are not identities or authorization boundaries.
  const trace: Trace = {
    runId: runId && /^[a-zA-Z0-9-]{1,64}$/.test(runId) ? runId : requestId,
    requestId,
    stage,
    deadline: Date.now() + budgetMs,
    signal,
    generations: 0,
    reportedTokens: 0,
  };
  return execution.run(trace, fn);
}

/** Private HTTP tools share the current request deadline and cancellation signal. */
export function executionAbortSignal(timeoutMs: number): AbortSignal {
  const trace = execution.getStore();
  const remaining = trace
    ? Math.max(0, trace.deadline - Date.now())
    : timeoutMs;
  const timeout = AbortSignal.timeout(Math.min(timeoutMs, remaining));
  return trace?.signal ? AbortSignal.any([timeout, trace.signal]) : timeout;
}

type Waiter = { start: () => void };
/** FIFO admission control for this Node process; queued cancellations never take a slot. */
export class GenerationGate {
  private active = 0;
  private queue: Waiter[] = [];
  constructor(
    private readonly concurrency: number,
    private readonly capacity: number
  ) {}
  snapshot() {
    return { active: this.active, queued: this.queue.length };
  }

  acquire(signal: AbortSignal, timeoutMs: number): Promise<() => void> {
    if (signal.aborted)
      return Promise.reject(new AiTransient("Model execution cancelled"));
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve(this.releaseOnce());
    }
    if (this.queue.length >= this.capacity)
      return Promise.reject(
        new AiTransient("Model execution capacity reached")
      );
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const remove = () => {
        this.queue = this.queue.filter(item => item !== waiter);
        cleanup();
      };
      const onAbort = () => {
        remove();
        reject(new AiTransient("Queued model execution cancelled"));
      };
      const waiter: Waiter = {
        start: () => {
          cleanup();
          this.active++;
          resolve(this.releaseOnce());
        },
      };
      const timer = setTimeout(() => {
        remove();
        reject(new AiTransient("Model execution queue timed out"));
      }, timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }
  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.start();
    };
  }
}
const gate = new GenerationGate(
  EXECUTION_POLICY.maxConcurrentGenerations,
  EXECUTION_POLICY.maxQueuedGenerations
);

export function safeErrorName(error: unknown): string {
  // Never log SDK errors wholesale: they can contain filing text and provider response bodies.
  return error instanceof Error && /^[a-zA-Z0-9_]{1,80}$/.test(error.name)
    ? error.name
    : "Error";
}

function usageOf(value: unknown): Usage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as { totalUsage?: Usage; usage?: Usage };
  return result.totalUsage ?? result.usage;
}

export async function withModelExecution<T>(
  stage: AnalysisStageName,
  fn: (signal: AbortSignal) => Promise<T>,
  callTimeoutMs = requestBudgetMs(stage)
): Promise<T> {
  const trace = execution.getStore();
  if (
    trace &&
    (trace.generations >= EXECUTION_POLICY.maxGenerationsPerRequest ||
      trace.reportedTokens >= EXECUTION_POLICY.maxReportedTokensPerRequest)
  ) {
    throw new AiInvalidRequest("Model request budget exhausted");
  }
  const remaining = trace ? trace.deadline - Date.now() : callTimeoutMs;
  if (remaining <= 0) throw new AiTransient("Model request deadline exhausted");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("model_deadline"),
    Math.min(remaining, callTimeoutMs)
  );
  const signal = trace?.signal
    ? AbortSignal.any([controller.signal, trace.signal])
    : controller.signal;
  const started = Date.now();
  let acquiredAt: number | undefined;
  let release: (() => void) | undefined;
  let outcome = "failed";
  let usage: Usage | undefined;
  let errorType: string | undefined;
  try {
    release = await gate.acquire(signal, EXECUTION_POLICY.queueTimeoutMs);
    acquiredAt = Date.now();
    signal.throwIfAborted();
    if (trace) {
      if (
        trace.generations >= EXECUTION_POLICY.maxGenerationsPerRequest ||
        trace.reportedTokens >= EXECUTION_POLICY.maxReportedTokensPerRequest
      ) {
        throw new AiInvalidRequest("Model request budget exhausted");
      }
      trace.generations++;
    }
    const result = await fn(signal);
    usage = usageOf(result);
    outcome = "complete";
    return result;
  } catch (error) {
    usage = usageOf(error);
    errorType = safeErrorName(error);
    outcome = signal.aborted ? "cancelled_or_deadline" : "failed";
    throw error;
  } finally {
    clearTimeout(timer);
    release?.();
    if (trace) trace.reportedTokens += usage?.totalTokens ?? 0;
    console.info(
      JSON.stringify({
        event: "model_execution",
        architecture: EXECUTION_POLICY.version,
        runId: trace?.runId,
        requestId: trace?.requestId,
        requestStage: trace?.stage,
        stage,
        model: MODEL_PINS[stage],
        outcome,
        errorType,
        queueMs: (acquiredAt ?? Date.now()) - started,
        durationMs: Date.now() - started,
        generationsInRequest: trace?.generations,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        usageKnown: usage?.totalTokens !== undefined,
      })
    );
  }
}

export const executionRuntimeStatus = () => ({
  ...EXECUTION_POLICY,
  ...gate.snapshot(),
  scope: "per_node_process",
});
