import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evidenceReferenceSchema } from "../contracts/analysis";
import { openAIProviderOptions } from "./ai/provider";

describe("OpenAI structured-output compatibility", () => {
  it("keeps strict JSON Schema disabled for filing contracts with nullable/optional evidence", () => {
    const options = openAIProviderOptions("profiler");
    expect(options.openai.strictJsonSchema).toBe(false);
  });

  it("does not emit the unsupported uri format in shared evidence schemas", () => {
    const schema = z.toJSONSchema(evidenceReferenceSchema);
    expect(JSON.stringify(schema)).not.toContain('"format":"uri"');
  });
});
