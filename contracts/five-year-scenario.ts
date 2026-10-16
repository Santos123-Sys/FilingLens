import { z } from "zod";
import type { FilingAnalysis, ValuationAssumption } from "./analysis";
import { httpsSource, isoDate } from "./forecast-evaluation";
import { moneyBasis } from "./valuation-basis";

export const fiveYearScenarioSchema = z
  .object({
    issuer: z.string().min(1).max(200),
    baseYear: z.number().int().min(2000).max(2094),
    baseRevenue: z.number().finite().min(0.000001).max(1e10),
    currency: z.enum(["USD", "BRL", "EUR", "GBP", "CHF"]),
    growthPercent: z.number().finite().min(-99).max(300).array().length(5),
    note: z.string().trim().max(1000),
    sourceUrl: httpsSource.nullable(),
    origin: isoDate.nullable(),
    reviewed: z.boolean(),
  })
  .strict();
export type FiveYearScenario = z.infer<typeof fiveYearScenarioSchema>;

export function calculateFiveYearScenario(raw: unknown) {
  const input = fiveYearScenarioSchema.parse(raw);
  let previous = input.baseRevenue;
  return {
    schemaVersion: "five-year-scenario.v1" as const,
    input,
    predictiveStatus: "analyst_scenario_not_calibrated" as const,
    reviewStatus: input.reviewed ? "reviewed" : "draft",
    rows: input.growthPercent.map((growthPercent, i) => {
      const revenue = previous * (1 + growthPercent / 100);
      if (!Number.isFinite(revenue) || revenue <= 0)
        throw Error("invalid_scenario_revenue");
      const row = {
        horizon: i + 1,
        targetYear: input.baseYear + i + 1,
        previousRevenue: previous,
        growthPercent,
        revenue,
      };
      previous = revenue;
      return row;
    }),
    intervals: null,
  };
}
const resolved = (rows: ValuationAssumption[], id: string) => {
  const row = rows.find(r => r.id === id);
  return row?.final_value === undefined ? row?.proposed_value : row.final_value;
};
export function fiveYearPlanningContext(
  a: FilingAnalysis,
  ledger: ValuationAssumption[]
) {
  const revenue = resolved(ledger, "dcf.base_revenue"),
    currency = resolved(ledger, "dcf.currency"),
    period = resolved(ledger, "dcf.base_period");
  const year =
    typeof period === "string"
      ? /^(?:FY\s*)?(20\d{2})$/.exec(period)?.[1]
      : null;
  const base = fiveYearScenarioSchema
    .pick({ issuer: true, baseYear: true, baseRevenue: true, currency: true })
    .safeParse({
      issuer: a.company.name,
      baseYear: year ? Number(year) : null,
      baseRevenue:
        typeof revenue === "string" && revenue.trim()
          ? Number(revenue)
          : revenue,
      currency,
    });
  if (!base.success) return null;
  const growthPercent = Array.from({ length: 5 }, (_, i) => {
    const value = resolved(ledger, `dcf.revenue_growth_y${i + 1}`);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
  const terminal = resolved(ledger, "dcf.terminal_growth");
  return {
    ...base.data,
    growthPercent,
    terminalGrowthPercent:
      typeof terminal === "number" && Number.isFinite(terminal)
        ? terminal
        : null,
  };
}
export type FiveYearPlanningContext = NonNullable<
  ReturnType<typeof fiveYearPlanningContext>
>;

/** Historical suggestion only; absent publication vintages never become calibration. */
export function alignedPlanningHistory(
  a: FilingAnalysis,
  context: FiveYearPlanningContext
) {
  const history = a.financials.annualHistory;
  const candidates = [];
  if (history && history.provenance)
    candidates.push({
      years: history.years,
      revenue: history.revenue,
      unit: history.unit,
      sources: history.sources,
    });
  if (/10-K|20-F|DFP|annual|full.year/i.test(a.company.filingType))
    candidates.push({
      years: a.financials.years,
      revenue: a.financials.revenue,
      unit: a.financials.unit,
      sources:
        a.financials.evidence
          ?.filter(e => e.metric === "revenue")
          .map(e => e.source) ?? [],
    });
  for (const candidate of candidates) {
    const unit = moneyBasis(candidate.unit);
    if (
      !unit ||
      unit.currency !== context.currency ||
      candidate.years.length !== 5 ||
      candidate.revenue?.length !== 5
    )
      continue;
    const pairs = candidate.years
      .map((label, i) => ({
        year: Number(/^(?:FY\s*)?(20\d{2})$/.exec(label)?.[1] ?? NaN),
        value: candidate.revenue![i],
      }))
      .sort((a, b) => a.year - b.year);
    if (
      pairs.some(
        (p, i) =>
          !Number.isInteger(p.year) ||
          p.year !== context.baseYear - 4 + i ||
          typeof p.value !== "number" ||
          !Number.isFinite(p.value) ||
          p.value <= 0
      )
    )
      continue;
    const values = pairs.map(p => p.value! * unit.toMillions);
    if (
      Math.abs(values[4] - context.baseRevenue) >
      1e-6 * Math.max(1, context.baseRevenue)
    )
      continue;
    return {
      values,
      years: pairs.map(p => p.year),
      sourceUrls: [
        ...new Set(
          candidate.sources
            .map(s => s.url)
            .filter((url): url is string => httpsSource.safeParse(url).success)
        ),
      ],
    };
  }
  return null;
}

/** Explicit reviewed transfer, tied to the current ledger—not a portfolio publish. */
export function transferFiveYearScenario(
  ledger: ValuationAssumption[],
  raw: unknown,
  expectedIssuer: string
) {
  const scenario = calculateFiveYearScenario(raw),
    input = scenario.input;
  if (!input.reviewed || input.note.length < 10)
    throw Error("explicit_review_and_documented_rationale_required");
  if (input.issuer !== expectedIssuer) throw Error("scenario_issuer_mismatch");
  if (new Set(ledger.map(r => r.id)).size !== ledger.length)
    throw Error("duplicate_ledger_ids");
  const base = resolved(ledger, "dcf.base_revenue"),
    currency = resolved(ledger, "dcf.currency"),
    period = resolved(ledger, "dcf.base_period");
  if (
    Number(base) !== input.baseRevenue ||
    currency !== input.currency ||
    !new RegExp(`^(?:FY\\s*)?${input.baseYear}$`).test(String(period))
  )
    throw Error("scenario_base_period_or_currency_mismatch");
  if (
    !Array.from({ length: 5 }, (_, i) => `dcf.revenue_growth_y${i + 1}`).every(
      id => ledger.some(r => r.id === id)
    )
  )
    throw Error("prepare_dcf_ledger_first");
  return ledger.map(row => {
    const match = /^dcf\.revenue_growth_y([1-5])$/.exec(row.id);
    if (!match) return row;
    return {
      ...row,
      final_value: input.growthPercent[Number(match[1]) - 1],
      status: "edited" as const,
      confidence: "low" as const,
      rationale: `Reviewed five-year scenario v3; base FY${input.baseYear}, ${input.baseRevenue} ${input.currency} millions. ${input.note} Origin ${input.origin ?? "not supplied"}. Source cutoff/calibration unavailable for this transferred analyst scenario; empirical bands and cohort qualification do not transfer to edited drivers. No future accuracy or issuer-guidance claim.`,
      source: input.sourceUrl
        ? {
            section:
              "Historical revenue/analyst scenario source; not a disclosed future forecast",
            url: input.sourceUrl,
          }
        : undefined,
    };
  });
}
