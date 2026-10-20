import { z } from "zod";

// Hybrid swarm for DCF assumption debate. Design: docs/dcf-swarm-architecture.md.
// The swarm proposes assumptions only; FilingLens owns all valuation arithmetic.

export const AssumptionKey = z.enum([
  "revenue_growth_path",
  "operating_margin",
  "capex_ratio",
  "nwc_ratio",
  "tax_rate",
  "wacc_risk_free",
  "wacc_beta",
  "wacc_erp",
  "terminal_method",
  "terminal_growth",
]);
export type AssumptionKey = z.infer<typeof AssumptionKey>;

export const AgentRole = z.enum([
  "growth_analyst",
  "margin_analyst",
  "discount_rate_analyst",
  "terminal_value_analyst",
  "contrarian_challenger",
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const DcfDebateBrief = z
  .object({
    question: z.string().trim().min(20).max(1600),
    startYear: z.number().int().min(2000).max(2200),
    endYear: z.number().int().min(2000).max(2200),
    language: z.enum(["en", "pt"]),
  })
  .strict()
  .refine(
    b => b.endYear >= b.startYear && b.endYear - b.startYear <= 10,
    "Use an ordered debate window of at most eleven fiscal years"
  );
export type DcfDebateBrief = z.infer<typeof DcfDebateBrief>;

// Narrative stays qualitative; numbers live only in structured ledger fields.
const qualitative = z
  .string()
  .trim()
  .min(10)
  .max(700)
  .refine(
    t => !/\p{N}|[$€£%]|https?:\/\//u.test(t),
    "Narrative cannot introduce numbers or URLs"
  );

const citation = z
  .object({
    evidenceId: z.string().min(1).max(200),
    quote: z.string().min(10).max(1500),
  })
  .strict();

export const AssumptionEntry = z
  .object({
    key: AssumptionKey,
    // Structured numeric proposal. terminal_method uses value as a label via unit 'method'.
    value: z.number().finite(),
    unit: z.enum(["percent", "ratio", "currency_rate", "method"]),
    basis: z.enum(["source_fact", "analyst_estimate"]),
    rationale: qualitative,
    citations: z.array(citation).max(4),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const bounds: Record<string, [number, number]> = {
      revenue_growth_path: [-99, 300],
      operating_margin: [-100, 100],
      capex_ratio: [0, 100],
      nwc_ratio: [-100, 200],
      tax_rate: [0, 100],
      wacc_risk_free: [0, 50],
      wacc_beta: [0, 5],
      wacc_erp: [0, 30],
      terminal_method: [1, 1],
      terminal_growth: [0, 10],
    };
    const [lo, hi] = bounds[entry.key];
    const unit =
      entry.key === "wacc_beta"
        ? "ratio"
        : entry.key === "terminal_method"
          ? "method"
          : "percent";
    if (entry.value < lo || entry.value > hi || entry.unit !== unit)
      ctx.addIssue({
        code: "custom",
        message: "Invalid assumption unit or range",
      });
    if (entry.basis === "source_fact" && entry.citations.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "source_fact requires at least one citation",
      });
    }
    if (entry.basis === "analyst_estimate" && entry.citations.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "analyst_estimate must not cite evidence",
      });
    }
  });
export type AssumptionEntry = z.infer<typeof AssumptionEntry>;

export const AgentOpinion = z
  .object({
    role: AgentRole,
    assumptions: z.array(AssumptionEntry).max(4),
    challenges: z.array(qualitative).max(3),
    gaps: z.array(qualitative).max(4),
  })
  .strict();
export type AgentOpinion = z.infer<typeof AgentOpinion>;

// Judge may only select, merge or reject agent proposals; never new numbers.
export const ConsensusRow = z
  .object({
    key: AssumptionKey,
    proposal: AssumptionEntry.nullable(),
    dissent: z
      .array(
        z
          .object({
            from: AgentRole,
            note: qualitative,
          })
          .strict()
      )
      .max(20),
    status: z.enum(["proposed", "contested", "unresolved"]),
  })
  .strict();
export const ConsensusMap = z
  .object({
    rows: z.array(ConsensusRow).max(10),
    unresolved: z.array(z.string().trim().min(1).max(400)).max(10),
  })
  .strict();
export type ConsensusMap = z.infer<typeof ConsensusMap>;

export type DcfDebateRun = {
  architecture: "dcf-assumption-swarm-v1";
  mode?: 'single'|'four'|'five';
  promptVersion: string;
  brief: DcfDebateBrief;
  status:
    "needs_sources" | "model_disabled" | "needs_human_review" | "failed_closed";
  opinions: { role: AgentRole; opinion: AgentOpinion | null; error?: string }[];
  consensus: ConsensusMap | null;
  gaps: string[];
  trace: {
    stage: string;
    status: string;
    elapsedMs: number;
    count?: number;
    usage?: unknown;
  }[];
  modelCalls: number;
  stopReason: string;
};

export const DCF_SWARM_MAX_MODEL_CALLS = 6; // 5 agents + 1 judge, single round
export const DCF_SWARM_MAX_EVIDENCE = 20;
export const DCF_SWARM_OVERALL_MS = 100_000;
export const DCF_SWARM_PER_CALL_MS = 30_000;

export type DebateEvidence = {
  id: string;
  text: string;
  metric: string;
  value: number;
  unit: string | null;
  fiscalYear: number;
  sourceUrls: string[];
};
export type DebateResult = DcfDebateRun & {
  runId: string;
  issuerId: string;
  snapshotId: string;
  createdAt: string;
  evidence: DebateEvidence[];
  limitations: string[];
};
export const JudgeSelection = z
  .object({
    selections: z
      .array(z.object({ key: AssumptionKey, role: AgentRole }).strict())
      .max(10),
  })
  .strict();
