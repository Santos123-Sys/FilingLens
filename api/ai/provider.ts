import { createOpenAI } from "@ai-sdk/openai";
import type { AnalysisStageName } from "../../contracts/analysis";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL = "gpt-5.6-terra";

/**
 * Explicit pins make model governance observable per module without coupling
 * the rest of the architecture to one provider configuration shape.
 */
export const MODEL_PINS: Record<AnalysisStageName, string> = {
  metadata: DEFAULT_MODEL,
  profiler: DEFAULT_MODEL,
  market: DEFAULT_MODEL,
  risks: DEFAULT_MODEL,
  financials: DEFAULT_MODEL,
  historian: DEFAULT_MODEL,
  synthesizer: DEFAULT_MODEL,
};

export const filingModel = (stage: AnalysisStageName) => openai(MODEL_PINS[stage]);

export const marketWebSearchTool = () => openai.tools.webSearch({ searchContextSize: "medium" });
