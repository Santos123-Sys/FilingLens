import { describe, it, expect, vi } from "vitest";
import { buildPublicFinanceSnapshot } from "../../contracts/public-finance";
import {
  runDebate,
  synthesize,
  validateOpinion,
  type ModelCall,
} from "./orchestrator";
import { transferDebate } from "../../contracts/dcf-swarm-transfer";
import { prepareDcf } from "../valuation/dcf";
import { valuationFixture } from "../fixtures/valuation-case";
const brief = {
  question: "Which assumptions can be supported by the available evidence?",
  startYear: 2021,
  endYear: 2025,
  language: "en",
};
const snapshot = buildPublicFinanceSnapshot({
  issuer: { jurisdiction: "us", registryId: "0000320193" },
  provider: "sec_edgar",
  archivedOn: "2026-10-20",
  facts: [
    {
      metric: "revenue",
      value: "100",
      unit: "USD",
      currency: "USD",
      fiscalYear: 2025,
      periodEnd: "2025-12-31",
      periodLabel: "FY2025",
      status: "single_source",
      sources: [
        {
          url: "https://www.sec.gov/Archives/example",
          provider: "sec_edgar",
          form: "10-K",
          retrievedAt: "2026-10-20",
        },
      ],
    },
  ],
});
const proposal = {
  key: "revenue_growth_path" as const,
  value: 5,
  unit: "percent" as const,
  basis: "analyst_estimate" as const,
  rationale:
    "Explicit hypothesis requiring review against future operating evidence.",
  citations: [],
};
const opinion = {
  role: "growth_analyst" as const,
  assumptions: [proposal],
  challenges: ["Durability depends on evidence that is not yet available."],
  gaps: [],
};
const call: ModelCall = async (prompt, _payload, judge) => ({
  value: judge
    ? { selections: [{ key: "revenue_growth_path", role: "growth_analyst" }] }
    : prompt.includes("ROLE: growth")
      ? opinion
      : {
          role: prompt.includes("ROLE: margin")
            ? "margin_analyst"
            : prompt.includes("ROLE: discount")
              ? "discount_rate_analyst"
              : prompt.includes("ROLE: terminal")
                ? "terminal_value_analyst"
                : "contrarian_challenger",
          assumptions: [],
          challenges: [],
          gaps: [],
        },
});
describe("bounded assumption review", () => {
  it("calls no model when disabled or missing evidence", async () => {
    const model = vi.fn(call);
    expect(
      (
        await runDebate("us:0000320193", snapshot, brief, "test", {
          call: model,
          enabled: false,
        })
      ).status
    ).toBe("model_disabled");
    expect(
      (
        await runDebate("us:0000320193", null, brief, "test", {
          call: model,
          enabled: true,
        })
      ).status
    ).toBe("needs_sources");
    expect(model).not.toHaveBeenCalled();
  });
  it("rejects wrong issuer before model execution", async () => {
    await expect(
      runDebate("br:33000167000101", snapshot, brief, "x", { enabled: true })
    ).rejects.toThrow("issuer_mismatch");
  });
  it("filters evidence by period and retains a durable six-call review draft", async () => {
    const model = vi.fn(call),
      r = await runDebate("us:0000320193", snapshot, brief, "test", {
        call: model,
        enabled: true,
      });
    expect(r.status).toBe("needs_human_review");
    expect(r.modelCalls).toBe(6);
    expect(r.evidence).toHaveLength(1);
    expect(
      r.consensus?.rows.find(r => r.key === "revenue_growth_path")?.status
    ).toBe("contested");
    expect(
      (
        await runDebate(
          "us:0000320193",
          snapshot,
          { ...brief, endYear: 2024 },
          "test",
          { call: model, enabled: true }
        )
      ).status
    ).toBe("needs_sources");
  });
  it("rejects role impersonation, role scope, wrong units and unbounded assumptions", () => {
    expect(() => validateOpinion(opinion, "margin_analyst", [])).toThrow(
      "role_mismatch"
    );
    for (const patch of [
      { key: "wacc_beta" },
      { value: 301 },
      { unit: "ratio" },
      { rationale: "Target price is $100" },
    ])
      expect(() =>
        validateOpinion(
          { ...opinion, assumptions: [{ ...proposal, ...patch }] },
          "growth_analyst",
          []
        )
      ).toThrow();
  });
  it("does not promote a cited revenue amount to a growth fact", () => {
    const e = {
      id: "e",
      text: "Revenue was one hundred in reporting currency.",
      metric: "revenue",
      value: 100,
      unit: "USD",
      fiscalYear: 2025,
      sourceUrls: [],
    };
    expect(() =>
      validateOpinion(
        {
          ...opinion,
          assumptions: [
            {
              ...proposal,
              basis: "source_fact",
              citations: [{ evidenceId: "e", quote: e.text }],
            },
          ],
        },
        "growth_analyst",
        [e]
      )
    ).toThrow("unsupported_source_value");
  });
  it("judge cannot invent numbers, keys, roles or erase disagreement", () => {
    expect(() =>
      synthesize(
        { selections: [{ key: "tax_rate", role: "growth_analyst" }] },
        [opinion]
      )
    ).toThrow();
    expect(() =>
      synthesize(
        {
          selections: [
            { key: "revenue_growth_path", role: "growth_analyst", value: 9 },
          ],
        },
        [opinion]
      )
    ).toThrow();
    const alternate = {
      ...opinion,
      role: "contrarian_challenger" as const,
      assumptions: [{ ...proposal, value: -5 }],
    };
    const consensus = synthesize(
      { selections: [{ key: "revenue_growth_path", role: "growth_analyst" }] },
      [opinion, alternate]
    );
    expect(consensus.rows[0].proposal?.value).toBe(5);
    expect(consensus.rows[0].status).toBe("contested");
    expect(consensus.rows[0].dissent.length).toBeGreaterThan(0);
  });
  it("isolates one specialist failure, but fails closed on invalid judge", async () => {
    const r = await runDebate("us:0000320193", snapshot, brief, "test", {
      enabled: true,
      call: async (...args) => {
        if (args[0].includes("ROLE: margin")) throw Error("offline");
        return call(...args);
      },
    });
    expect(r.status).toBe("needs_human_review");
    expect(r.opinions.filter(o => o.error)).toHaveLength(1);
    const bad = await runDebate("us:0000320193", snapshot, brief, "test", {
      enabled: true,
      call: async (...args) =>
        args[2]
          ? {
              value: {
                selections: [{ key: "wacc_beta", role: "growth_analyst" }],
              },
            }
          : call(...args),
    });
    expect(bad.status).toBe("failed_closed");
    expect(bad.consensus).toBeNull();
  });
  it("cancelled run makes no calls and cannot produce a review ledger", async () => {
    const abort = new AbortController();
    abort.abort();
    const model = vi.fn(call);
    const r = await runDebate("us:0000320193", snapshot, brief, "test", {
      enabled: true,
      signal: abort.signal,
      call: model,
    });
    expect(r.status).toBe("failed_closed");
    expect(model).not.toHaveBeenCalled();
  });
  it("copying resets only selected input rows and never approves or calculates", async () => {
    const r = await runDebate("us:0000320193", snapshot, brief, "test", {
      enabled: true,
      call,
    });
    const rows = prepareDcf(valuationFixture()).assumptions.map(a => ({
      ...a,
      status: "accepted" as const,
      final_value: 8,
    }));
    const next = transferDebate(rows, r, "revenue_growth_path", r.issuerId);
    expect(
      next
        .filter(a => a.id.startsWith("dcf.revenue_growth"))
        .every(
          a =>
            a.status === "proposed" &&
            a.final_value === null &&
            a.proposed_value === 5
        )
    ).toBe(true);
    expect(next.find(a => a.id === "dcf.beta")?.status).toBe("accepted");
    expect(() =>
      transferDebate(rows, r, "revenue_growth_path", "us:0000000001")
    ).toThrow();
  });
});

it("preserves all ten unresolved keys and the full bounded dissent set", () => {
  const empty = synthesize({ selections: [] }, [opinion]);
  expect(empty.unresolved).toHaveLength(10);
  const roles = [
    "growth_analyst",
    "margin_analyst",
    "discount_rate_analyst",
    "terminal_value_analyst",
    "contrarian_challenger",
  ] as const;
  const opinions = roles.map(role => ({
    ...opinion,
    role,
    challenges: [
      "The evidence cannot support certainty about the future.",
      "Alternative assumptions require independent assessment.",
      "A change in operating conditions may invalidate this.",
    ],
  }));
  const result = synthesize(
    { selections: [{ key: "revenue_growth_path", role: "growth_analyst" }] },
    opinions
  );
  expect(result.rows[0].dissent).toHaveLength(15);
  expect(result.unresolved).toHaveLength(9);
});
