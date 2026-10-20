import { generateObject } from "ai";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  AgentOpinion,
  AssumptionKey,
  DcfDebateBrief,
  JudgeSelection,
  type DebateEvidence,
  type DebateResult,
  type AgentRole,
  ConsensusMap,
} from "../../contracts/dcf-swarm";
import {
  publicFinanceSnapshotSchema,
  type PublicFinanceSnapshot,
} from "../../contracts/public-finance";
import { filingModel, openAIProviderOptions } from "../ai/provider";
import { withModelExecution } from "../ai/execution";
import * as prompts from "./prompts";
const roles: AgentRole[] = [
  "growth_analyst",
  "margin_analyst",
  "discount_rate_analyst",
  "terminal_value_analyst",
  "contrarian_challenger",
];
const rolePrompts = [
  prompts.GROWTH_ANALYST_PROMPT,
  prompts.MARGIN_ANALYST_PROMPT,
  prompts.DISCOUNT_RATE_ANALYST_PROMPT,
  prompts.TERMINAL_VALUE_ANALYST_PROMPT,
  prompts.CONTRARIAN_PROMPT,
];
const allowed: Record<AgentRole, string[]> = {
  growth_analyst: ["revenue_growth_path"],
  margin_analyst: ["operating_margin", "capex_ratio", "nwc_ratio", "tax_rate"],
  discount_rate_analyst: ["wacc_risk_free", "wacc_beta", "wacc_erp"],
  terminal_value_analyst: ["terminal_method", "terminal_growth"],
  contrarian_challenger: AssumptionKey.options,
};
export type ModelCall = (
  prompt: string,
  payload: unknown,
  judge: boolean,
  signal: AbortSignal
) => Promise<{ value: unknown; usage?: unknown }>;
const callModel: ModelCall = async (prompt, payload, judge, signal) => {
  const baseline=prompt.startsWith('SINGLE_ANALYST_BASELINE');
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized) > 64000) throw Error("input_budget");
  const result = await withModelExecution(
    judge ? "synthesizer" : "financials",
    async gateSignal =>
      generateObject({
        model: filingModel(judge ? "synthesizer" : "financials"),
        schema: judge ? JudgeSelection : baseline ? z.object({opinions:z.array(AgentOpinion).length(4)}).strict() : AgentOpinion,
        system: prompt,
        messages: [{ role: "user", content: serialized }],
        maxRetries: 0,
        providerOptions: openAIProviderOptions(
          judge ? "synthesizer" : "financials",
          baseline?14400:2400,
          "low"
        ),
        abortSignal: AbortSignal.any([signal, gateSignal]),
      }),
    30000
  );
  if (Buffer.byteLength(JSON.stringify(result.object)) > 64000)
    throw Error("output_budget");
  return { value: result.object, usage: result.usage };
};
export function validateOpinion(
  raw: unknown,
  role: AgentRole,
  evidence: DebateEvidence[]
) {
  const opinion = AgentOpinion.parse(raw);
  if (opinion.role !== role) throw Error("role_mismatch");
  if (
    new Set(opinion.assumptions.map(a => a.key)).size !==
    opinion.assumptions.length
  )
    throw Error("duplicate_key");
  for (const a of opinion.assumptions) {
    if (!allowed[role].includes(a.key)) throw Error("role_scope");
    if (new Set(a.citations.map(c => c.evidenceId)).size !== a.citations.length)
      throw Error("duplicate_citation");
    for (const c of a.citations) {
      const e = evidence.find(e => e.id === c.evidenceId);
      if (!e || !e.text.includes(c.quote)) throw Error("unsupported_citation");
      // A quote alone does not support a number, a unit, or a forward assumption.
      if (e.metric !== a.key || e.unit !== a.unit || e.value !== a.value)
        throw Error("unsupported_source_value");
    }
  }
  return opinion;
}
export function synthesize(
  raw: unknown,
  opinions: AgentOpinion[]
): ConsensusMap {
  const selection = JudgeSelection.parse(raw);
  if (
    new Set(selection.selections.map(s => s.key)).size !==
    selection.selections.length
  )
    throw Error("duplicate_selection");
  for (const s of selection.selections)
    if (
      !opinions
        .find(o => o.role === s.role)
        ?.assumptions.some(a => a.key === s.key)
    )
      throw Error("invented_selection");
  return ConsensusMap.parse({
    rows: AssumptionKey.options.map(key => {
      const selected = selection.selections.find(s => s.key === key);
      const proposal = selected
        ? opinions
            .find(o => o.role === selected.role)!
            .assumptions.find(a => a.key === key)!
        : null;
      const alternatives = opinions.flatMap(o =>
        o.assumptions
          .filter(
            a =>
              a.key === key &&
              (!proposal ||
                a.value !== proposal.value ||
                a.basis !== proposal.basis)
          )
          .map(a => ({ from: o.role, note: a.rationale }))
      );
      const challenges = opinions.flatMap(o =>
        o.challenges.map(note => ({ from: o.role, note }))
      );
      return {
        key,
        proposal,
        dissent: [...alternatives, ...challenges],
        status: !proposal
          ? "unresolved"
          : alternatives.length || challenges.length
            ? "contested"
            : "proposed",
      };
    }),
    unresolved: AssumptionKey.options.filter(
      key => !selection.selections.some(s => s.key === key)
    ),
  });
}
export async function runDebate(
  issuerId: string,
  rawSnapshot: PublicFinanceSnapshot | null,
  rawBrief: unknown,
  runId: string,
  options: { call?: ModelCall; signal?: AbortSignal; enabled?: boolean; mode?:'single'|'four'|'five' } = {}
): Promise<DebateResult> {
  const brief = DcfDebateBrief.parse(rawBrief),
    start = Date.now();
  const snapshot = rawSnapshot
    ? publicFinanceSnapshotSchema.parse(rawSnapshot)
    : null;
  if (
    snapshot &&
    snapshot.issuer.jurisdiction + ":" + snapshot.issuer.registryId !== issuerId
  )
    throw Error("issuer_mismatch");
  const evidence: DebateEvidence[] = (snapshot?.facts ?? [])
    .filter(
      f =>
        f.value !== null &&
        ["verified", "single_source"].includes(f.status) &&
        f.fiscalYear >= brief.startYear &&
        f.fiscalYear <= brief.endYear
    )
    .sort((a, b) => b.fiscalYear - a.fiscalYear || a.id.localeCompare(b.id))
    .slice(0, 20)
    .map(f => ({
      id: f.id,
      text: `${f.metric}: ${f.value} ${f.unit ?? "unknown unit"}; FY ${f.fiscalYear}; ${f.periodLabel ?? ""}`,
      metric: f.metric,
      value: Number(f.value),
      unit: f.unit,
      fiscalYear: f.fiscalYear,
      sourceUrls: f.sources.map(s => s.url),
    }));
  if (Buffer.byteLength(JSON.stringify(evidence)) > 48000)
    throw Error("evidence_budget");
  const run: DebateResult = {
    architecture: "dcf-assumption-swarm-v1",
    mode: options.mode ?? 'five',
    promptVersion: prompts.DCF_SWARM_PROMPT_VERSION,
    runId,
    issuerId,
    snapshotId: snapshot?.snapshotId ?? "",
    createdAt: new Date().toISOString(),
    brief,
    evidence,
    status: "needs_sources",
    opinions: [],
    consensus: null,
    gaps: [],
    trace: [],
    modelCalls: 0,
    stopReason: "no_usable_evidence",
    limitations: [
      ...(snapshot?.limitations ?? []),
      "AI proposals are unapproved hypotheses. Historical evidence does not prove future forecast accuracy.",
      "All specialists share a model family; agreement is not independent corroboration.",
      "No live quality advantage over the single-agent baseline has been demonstrated.",
    ],
  };
  if (!evidence.length) return run;
  if (!(options.enabled ?? process.env.DCF_SWARM_ENABLED === "true"))
    return { ...run, status: "model_disabled", stopReason: "model_disabled" };
  const signal = AbortSignal.any([
    AbortSignal.timeout(100000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const invoke = async (
    stage: string,
    prompt: string,
    payload: unknown,
    judge = false
  ) => {
    signal.throwIfAborted();
    if (run.modelCalls >= 6) throw Error("call_budget");
    run.modelCalls++;
    const t = Date.now();
    try {
      const result = await (options.call ?? callModel)(
        prompt,
        payload,
        judge,
        AbortSignal.any([signal, AbortSignal.timeout(30000)])
      );
      signal.throwIfAborted();
      run.trace.push({
        stage,
        status: "received",
        elapsedMs: Date.now() - t,
        usage: result.usage,
      });
      return result.value;
    } catch (e) {
      run.trace.push({
        stage,
        status: "failed_closed",
        elapsedMs: Date.now() - t,
      });
      throw e;
    }
  };
  try {
    if(options.mode==='single'){
      const raw=await invoke('single_analyst',prompts.BASELINE_PROMPT,{brief,issuerId,evidence});
      const parsed=z.object({opinions:z.array(AgentOpinion).length(4)}).strict().parse(raw);
      if(new Set(parsed.opinions.map(o=>o.role)).size!==4||parsed.opinions.some(o=>o.role==='contrarian_challenger'))throw Error('baseline_roles');
      const valid=parsed.opinions.map(o=>validateOpinion(o,o.role,evidence));
      run.opinions=valid.map(opinion=>({role:opinion.role,opinion}));
      run.consensus=synthesize({selections:valid.flatMap(o=>o.assumptions.map(a=>({key:a.key,role:o.role})))},valid);
      run.gaps=valid.flatMap(o=>o.gaps);run.status='needs_human_review';run.stopReason='completed';
      run.trace.push({stage:'complete',status:run.status,elapsedMs:Date.now()-start});return run;
    }
    const activeRoles=options.mode==='four'?roles.slice(0,4):roles;
    // Respect FilingLens's existing two-generation global admission limit.
    for (let i = 0; i < activeRoles.length; i += 2) {
      const settled = await Promise.allSettled(
        activeRoles.slice(i, i + 2).map(async (role, j) =>
          validateOpinion(
            await invoke(role, rolePrompts[i + j], {
              brief,
              issuerId,
              evidence,
            }),
            role,
            evidence
          )
        )
      );
      settled.forEach((s, j) =>
        run.opinions.push({
          role: roles[i + j],
          opinion: s.status === "fulfilled" ? s.value : null,
          ...(s.status === "rejected"
            ? { error: "agent_unavailable_or_invalid" }
            : {}),
        })
      );
    }
    const valid = run.opinions.flatMap(o => (o.opinion ? [o.opinion] : []));
    if (!valid.length) throw Error("all_agents_failed");
    const value = await invoke(
      "judge",
      prompts.SELECTION_PROMPT,
      { brief, issuerId, opinions: valid },
      true
    );
    run.consensus = synthesize(value, valid);
    run.gaps = valid.flatMap(o => o.gaps);
    run.status = "needs_human_review";
    run.stopReason = "completed";
  } catch {
    run.status = "failed_closed";
    run.stopReason = signal.aborted
      ? "cancelled_or_deadline"
      : "validation_or_provider_failure";
  }
  run.trace.push({
    stage: "complete",
    status: run.status,
    elapsedMs: Date.now() - start,
  });
  return run;
}
export const debateHash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
