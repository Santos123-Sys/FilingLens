import { readFileSync } from "node:fs";
import { join } from "node:path";

const FRAMEWORK_PATH = join(
  process.cwd(),
  "skills",
  "market-research-brief",
  "references",
  "analysis_framework.md",
);

let cachedFramework: string | null = null;

export function loadMarketResearchFramework(): string {
  if (cachedFramework !== null) return cachedFramework;
  try {
    cachedFramework = readFileSync(FRAMEWORK_PATH, "utf8");
  } catch {
    cachedFramework = "";
  }
  return cachedFramework;
}

/**
 * Load the complete analysis framework from the uploaded market-research-brief
 * package. The research prompt decides which modules are relevant to the issuer
 * and follows the package's own Adaptation Guide for B2B/energy companies.
 * Keeping the complete file here makes this a real runtime skill binding rather
 * than a prompt that merely mentions the skill by name.
 */
export function marketResearchRuntimeMethodology(): string {
  const framework = loadMarketResearchFramework();
  if (!framework) {
    return [
      "Market-research methodology fallback:",
      "- prefer public/government and regulator data;",
      "- identify direct competitors based on overlapping products, customers and geography;",
      "- quantify market share only from common-basis numerator and denominator;",
      "- validate every insight and state the decision-useful implication.",
    ].join("\n");
  }
  return framework;
}

export function marketResearchSkillStatus() {
  const framework = loadMarketResearchFramework();
  return {
    skill: "market-research-brief",
    runtimeFrameworkLoaded: framework.length > 0,
    runtimeFrameworkChars: framework.length,
    modules: ["market-sizing", "category-growth", "channel-analysis", "consumer-behavior", "competitive-analysis", "data-to-insight", "adaptation-guide"],
  };
}
