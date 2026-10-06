import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { dataToolsConfigured, dataToolsJson } from "./data-tools-client";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const RUNNER = resolve(ROOT, "skills/skill_runner.py");
const PYTHON = process.env.PYTHON_EXECUTABLE?.trim() || "python3";

export const SKILL_ARCHIVES = {
  ratios: {
    archive: resolve(ROOT, "skills/financial-ratio-toolkit/source.zip.b64"),
    member: "scripts/analyze.py",
  },
  statements: {
    archive: resolve(ROOT, "skills/financial-statement-analyzer/source.zip.b64"),
    member: "scripts/analyze_financials.py",
  },
  timeline: {
    archive: resolve(ROOT, "skills/filing-timeline-extractor/source.zip.b64"),
    member: "filing-timeline-extractor/scripts/validate_timeline.py",
  },
} as const;

export class SkillRuntimeError extends Error {
  constructor(
    public readonly skill: keyof typeof SKILL_ARCHIVES,
    message: string,
    public readonly stderr = "",
  ) {
    super(message);
    this.name = "SkillRuntimeError";
  }
}

async function runMember(
  skill: keyof typeof SKILL_ARCHIVES,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const spec = SKILL_ARCHIVES[skill];
  try {
    const result = await execFileAsync(PYTHON, [RUNNER, spec.archive, spec.member, ...args], {
      cwd: ROOT,
      timeout: 35_000,
      maxBuffer: 3 * 1024 * 1024,
      encoding: "utf8",
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string; code?: string | number };
    const stderr = typeof detail.stderr === "string" ? detail.stderr.slice(0, 4_000) : "";
    throw new SkillRuntimeError(
      skill,
      `Exact ${skill} skill execution failed${detail.code ? ` (exit ${detail.code})` : ""}`,
      stderr,
    );
  }
}

async function withJsonFile<T>(
  prefix: string,
  payload: unknown,
  callback: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const path = join(dir, "input.json");
  try {
    await writeFile(path, JSON.stringify(payload), "utf8");
    return await callback(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseJson<T>(skill: keyof typeof SKILL_ARCHIVES, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SkillRuntimeError(skill, `Exact ${skill} skill returned malformed JSON`, text.slice(0, 1_000));
  }
}

async function remoteOrLocal<T>(
  skill: keyof typeof SKILL_ARCHIVES,
  path: string,
  payload: unknown,
  local: () => Promise<T>,
): Promise<T> {
  if (!dataToolsConfigured()) return local();
  try {
    return await dataToolsJson<T>(path, payload, 45_000);
  } catch (error) {
    // Keep local execution as a bounded migration fallback so CI/development and a
    // temporary private-service outage do not destroy otherwise valid filing analysis.
    console.warn(`[skill:${skill}] Railway data-tools call failed; falling back locally:`, error);
    return local();
  }
}

export async function runRatioSkill<T>(payload: unknown): Promise<T> {
  return remoteOrLocal("ratios", "/v1/skills/ratios", payload, () =>
    withJsonFile("filinglens-ratios-", payload, async path => {
      const { stdout } = await runMember("ratios", ["--input", path, "--json"]);
      return parseJson<T>("ratios", stdout);
    }),
  );
}

export async function runStatementSkill<T>(payload: unknown): Promise<T> {
  return remoteOrLocal("statements", "/v1/skills/statements", payload, () =>
    withJsonFile("filinglens-statements-", payload, async path => {
      const { stdout } = await runMember("statements", [path, "--json"]);
      return parseJson<T>("statements", stdout);
    }),
  );
}

export async function validateTimelineWithExactSkill(payload: unknown): Promise<{ output: string }> {
  return remoteOrLocal("timeline", "/v1/skills/timeline", payload, () =>
    withJsonFile("filinglens-timeline-", payload, async path => {
      const { stdout } = await runMember("timeline", [path]);
      return { output: stdout.trim() };
    }),
  );
}

export async function skillRuntimeStatus(): Promise<{
  mode: "railway" | "local";
  python: string;
  runnerReadable: boolean;
  archives: Record<string, boolean>;
}> {
  const readable = async (path: string) => {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  };
  return {
    mode: dataToolsConfigured() ? "railway" : "local",
    python: PYTHON,
    runnerReadable: await readable(RUNNER),
    archives: {
      ratios: await readable(SKILL_ARCHIVES.ratios.archive),
      statements: await readable(SKILL_ARCHIVES.statements.archive),
      timeline: await readable(SKILL_ARCHIVES.timeline.archive),
    },
  };
}
