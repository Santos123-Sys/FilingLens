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

function section(markdown: string, heading: string, nextHeading?: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) return "";
  const end = nextHeading ? markdown.indexOf(nextHeading, start + heading.length) : -1;
  return markdown.slice(start, end >= 0 ? end : undefined).trim();
}

/**
 * The uploaded market-research-brief contains consumer/retail modules plus
 * reusable market-sizing, competition and data-to-insight methods. FilingLens
 * injects the exact relevant framework text into the market-research runtime
 * instead of merely naming the skill in a prompt.
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

  return [
    section(framework, "## 1. Market Sizing Methodology", "## 2. Category & Growth Driver Analysis"),
    section(framework, "## 5. Competitive Analysis", "## 6. Data-to-Insight Methodology"),
    section(framework, "## 6. Data-to-Insight Methodology", "## Adaptation Guide"),
    section(framework, "## Adaptation Guide"),
  ].filter(Boolean).join("\n\n").slice(0, 18_000);
}

export function marketResearchSkillStatus() {
  const framework = loadMarketResearchFramework();
  return {
    skill: "market-research-brief",
    runtimeFrameworkLoaded: framework.length > 0,
    runtimeFrameworkChars: framework.length,
    modules: ["market-sizing", "competitive-analysis", "data-to-insight", "adaptation-guide"],
  };
}
