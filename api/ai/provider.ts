import { createOpenAI } from "@ai-sdk/openai";
import type { AnalysisStageName } from "../../contracts/analysis";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
const DEFAULT_SYNTHESIZER_REASONING_EFFORT: ReasoningEffort = "high";
const VALID_REASONING = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh"]);

function modelFromEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function reasoningFromEnv(name: string, fallback: ReasoningEffort): ReasoningEffort {
  const value = process.env[name]?.trim().toLowerCase() as ReasoningEffort | undefined;
  return value && VALID_REASONING.has(value) ? value : fallback;
}

export const OPENAI_MODEL = modelFromEnv("OPENAI_MODEL", DEFAULT_MODEL);
export const OPENAI_SYNTHESIZER_MODEL = modelFromEnv("OPENAI_SYNTHESIZER_MODEL", OPENAI_MODEL);
export const OPENAI_REASONING_EFFORT = reasoningFromEnv("OPENAI_REASONING_EFFORT", DEFAULT_REASONING_EFFORT);
export const OPENAI_SYNTHESIZER_REASONING_EFFORT = reasoningFromEnv(
  "OPENAI_SYNTHESIZER_REASONING_EFFORT",
  DEFAULT_SYNTHESIZER_REASONING_EFFORT,
);

/** Explicit stage pins keep model governance observable while allowing deployment-time configuration. */
export const MODEL_PINS: Record<AnalysisStageName, string> = {
  metadata: OPENAI_MODEL,
  profiler: OPENAI_MODEL,
  market: OPENAI_MODEL,
  risks: OPENAI_MODEL,
  financials: OPENAI_MODEL,
  historian: OPENAI_MODEL,
  synthesizer: OPENAI_SYNTHESIZER_MODEL,
};

export const filingModel = (stage: AnalysisStageName) => openai(MODEL_PINS[stage]);

export const reasoningEffortFor = (stage: AnalysisStageName): ReasoningEffort =>
  stage === "synthesizer" ? OPENAI_SYNTHESIZER_REASONING_EFFORT : OPENAI_REASONING_EFFORT;

/**
 * AI SDK 6 enables OpenAI strict JSON Schema mode by default. FilingLens' domain
 * contracts intentionally use nullable/optional evidence fields because a filing
 * must never be forced to fabricate unavailable values. OpenAI strict mode rejects
 * those otherwise-valid schemas before inference (for example optional
 * filingReference / validation period fields). Keep provider-side strict mode off
 * and retain Zod validation after generation at the application boundary.
 */
export const openAIProviderOptions = (stage: AnalysisStageName, maxCompletionTokens?: number) => ({
  openai: {
    ...(maxCompletionTokens ? { maxCompletionTokens } : {}),
    reasoningEffort: reasoningEffortFor(stage),
    strictJsonSchema: false,
  },
});

export const modelRuntimeConfig = () => ({
  model: OPENAI_MODEL,
  reasoningEffort: OPENAI_REASONING_EFFORT,
  synthesizerModel: OPENAI_SYNTHESIZER_MODEL,
  synthesizerReasoningEffort: OPENAI_SYNTHESIZER_REASONING_EFFORT,
});

export const marketWebSearchTool = () => openai.tools.webSearch({ searchContextSize: "medium" });
