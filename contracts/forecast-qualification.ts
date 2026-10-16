import { z } from "zod";
import { httpsSource, isoDate, revenueForecast } from "./forecast-evaluation";

// Multiple retained vintages are permitted. Exact receipts belong to each row.
export const vintageSchema = z.object({
  id: z.string().min(1).max(100), issuer: z.string().min(1).max(100),
  fiscalYear: z.number().int().min(2000).max(2099), periodEnd: isoDate,
  publishedOn: isoDate, value: z.number().finite().min(-1e12).max(1e12),
  currency: z.enum(["BRL", "USD", "EUR", "GBP", "CHF"]),
  unit: z.literal("millions"), definition: z.string().min(1).max(150),
  sourceUrl: httpsSource, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(o => o.periodEnd === `${o.fiscalYear}-12-31` && o.publishedOn >= o.periodEnd,
  "Calendar annual period and subsequent exact-vintage receipt required");
export type RevenueVintage = z.infer<typeof vintageSchema>;
export const candidateModels = ["filinglens_growth_v1", "naive", "drift", "three_year_cagr", "median_ensemble"] as const;
export type CandidateModel = typeof candidateModels[number];
export const scoredModels = [...candidateModels, "adaptive_v2"] as const;
export type ScoredModel = typeof scoredModels[number];
export const forecastQualityInputSchema = z.object({
  observations: vintageSchema.array().min(1).max(100), origin: isoDate,
}).strict();

export function checkedVintages(raw: unknown): RevenueVintage[] {
  const rows = vintageSchema.array().min(1).max(100).parse(raw);
  if (new Set(rows.map(r => r.issuer)).size !== 1 || new Set(rows.map(r => r.id)).size !== rows.length)
    throw Error("Exactly one issuer and unique vintage IDs required");
  const keys = rows.map(r => `${r.fiscalYear}:${r.publishedOn}`);
  if (new Set(keys).size !== keys.length) throw Error("Ambiguous same-day annual vintages");
  return rows.sort((a, b) => a.fiscalYear - b.fiscalYear || a.publishedOn.localeCompare(b.publishedOn));
}

/** Select the latest retained vintage actually available before the date. */
export function availableYear(rows: RevenueVintage[], year: number, origin: string) {
  return rows.filter(r => r.fiscalYear === year && r.periodEnd < origin && r.publishedOn < origin)
    .sort((a, b) => a.publishedOn.localeCompare(b.publishedOn)).at(-1);
}

export function consecutiveTraining(rows: RevenueVintage[], origin: string) {
  const lastYear = Number(origin.slice(0, 4)) - 1;
  const training: RevenueVintage[] = [];
  for (let y = lastYear; y >= 2000; y--) {
    const r = availableYear(rows, y, origin);
    if (!r || r.value <= 0) break;
    if (training.length && (r.currency !== training[0].currency || r.definition !== training[0].definition)) break;
    training.unshift(r);
  }
  return training;
}

export function candidateForecast(values: number[], model: CandidateModel, horizon: number): number | null {
  if (values.length < 3 || values.some(v => !Number.isFinite(v) || v <= 0)) return null;
  let prediction: number;
  if (model === "median_ensemble") {
    const parts = (["naive", "drift", "three_year_cagr"] as const)
      .map(m => candidateForecast(values, m, horizon));
    if (parts.some(p => p === null)) return null;
    prediction = (parts as number[]).sort((a, b) => a - b)[1];
  } else prediction = revenueForecast(values, model, horizon);
  return Number.isFinite(prediction) && prediction > 0 ? prediction : null;
}

type PastForecast = {
  origin: string; horizon: number; targetYear: number; scale: number;
  currency: string; definition: string;
  predictions: Record<CandidateModel, number | null>; adaptive: number;
};
export type QualifiedForecast = {
  horizon: number; targetYear: number; prediction: number; selectedModel: CandidateModel;
  selectionStatus: "historical_candidate_selected" | "naive_fallback";
  selectionErrors: number; calibrationErrors: number;
  interval: { lower: number; upper: number; nominalPercent: 80 } | null;
  intervalStatus: "empirical_no_probability_guarantee" | "insufficient_pre_origin_errors";
  predictions: Record<CandidateModel, number | null>;
};

function forecastAt(rows: RevenueVintage[], origin: string, past: PastForecast[]) {
  const training = consecutiveTraining(rows, origin);
  if (training.length < 3) return { training, forecasts: [] as QualifiedForecast[], reason: "fewer_than_three_consecutive_available_positive_annuals" };
  const values = training.map(r => r.value), last = training.at(-1)!;
  const forecasts: QualifiedForecast[] = [];
  for (let horizon = 1; horizon <= 5; horizon++) {
    const predictions = Object.fromEntries(candidateModels.map(m => [m, candidateForecast(values, m, horizon)])) as Record<CandidateModel, number | null>;
    // Labels for these errors must themselves have been filed before this origin.
    const known = past.filter(p => p.horizon === horizon && p.origin < origin && p.currency === last.currency && p.definition === last.definition)
      .flatMap(p => {
        const actual = availableYear(rows, p.targetYear, origin);
        return actual && actual.currency === p.currency && actual.definition === p.definition ? [{ p, actual: actual.value }] : [];
      });
    let selectedModel: CandidateModel = "naive", selectionErrors = known.length, best = Infinity;
    for (const model of candidateModels.filter(m => m !== "naive")) {
      if (predictions[model] === null) continue;
      const pairs = known.filter(({p}) => p.predictions[model] !== null && p.predictions.naive !== null);
      if (pairs.length < 3) continue;
      const error = pairs.reduce((s, {p, actual}) => s + Math.abs(p.predictions[model]! - actual) / p.scale, 0) / pairs.length;
      const naiveError = pairs.reduce((s, {p, actual}) => s + Math.abs(p.predictions.naive! - actual) / p.scale, 0) / pairs.length;
      if (error < best && error <= naiveError * 0.9 && error < naiveError) {
        best = error; selectedModel = model; selectionErrors = pairs.length;
      }
    }
    const prediction = predictions[selectedModel]!;
    const errors = known.map(({p, actual}) => Math.abs(p.adaptive - actual) / p.scale).sort((a, b) => a - b);
    const rank = Math.ceil((errors.length + 1) * 0.8);
    // No interpolated quantile and no silently finite band for an infinite rank.
    const q = errors.length >= 5 && rank <= errors.length ? errors[rank - 1] : null;
    forecasts.push({horizon, targetYear: Number(origin.slice(0, 4)) + horizon - 1,
      prediction, selectedModel, selectionStatus: selectedModel === "naive" ? "naive_fallback" : "historical_candidate_selected",
      selectionErrors, calibrationErrors: errors.length,
      interval: q === null ? null : {lower: Math.max(0, prediction - q * last.value), upper: prediction + q * last.value, nominalPercent: 80},
      intervalStatus: q === null ? "insufficient_pre_origin_errors" : "empirical_no_probability_guarantee", predictions});
  }
  return {training, forecasts, reason: null};
}

/** Rebuild past proposals without reading their targets, then select/calibrate at origin. */
export function forecastQuality(raw: unknown) {
  const input = forecastQualityInputSchema.parse(raw), rows = checkedVintages(input.observations);
  if (!input.origin.endsWith("-07-01")) throw Error("Protocol v2 requires a July 1 calendar origin");
  const past: PastForecast[] = [];
  const earliest = Math.min(...rows.map(r => r.fiscalYear)) + 3;
  for (let year = earliest; year < Number(input.origin.slice(0, 4)); year++) {
    const origin = `${year}-07-01`, result = forecastAt(rows, origin, past), last = result.training.at(-1);
    if (last) for (const f of result.forecasts) past.push({origin, horizon: f.horizon, targetYear: f.targetYear,
      scale: last.value, currency: last.currency, definition: last.definition, predictions: f.predictions, adaptive: f.prediction});
  }
  const result = forecastAt(rows, input.origin, past);
  return {
    schemaVersion: "forecast-quality.v2" as const, issuer: rows[0].issuer,
    origin: input.origin, sourceCutoff: input.origin, trainingIds: result.training.map(r => r.id),
    status: result.reason ? "unavailable" as const : "conditional_revenue_scenario" as const,
    reason: result.reason, forecasts: result.forecasts,
    limitations: ["Issuer-specific historical selection is not proof of future accuracy.",
      "Only calendar annual reported revenue is covered; edited drivers, margins, valuation and returns are unvalidated.",
      "Empirical bands require available pre-origin errors and do not guarantee nominal coverage."],
  };
}

export type ForecastQuality = ReturnType<typeof forecastQuality>;
