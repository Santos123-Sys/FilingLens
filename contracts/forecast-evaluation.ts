import { z } from "zod";

export const isoDate = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine(v => {
    const t = Date.parse(v);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
export const httpsSource = z
  .string()
  .max(2000)
  .url()
  .refine(v => {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      ![...u.searchParams.keys()].some(k =>
        /token|secret|password|signature|api.?key/i.test(k)
      )
    );
  }, "Public HTTPS source without credentials required");
export const forecastObservationSchema = z
  .object({
    id: z.string().min(1).max(100),
    issuer: z.string().min(1).max(100),
    metric: z.literal("revenue"),
    fiscalYear: z.number().int().min(2000).max(2099),
    periodEnd: isoDate,
    publishedOn: isoDate,
    value: z.number().finite().positive().max(1e12),
    currency: z.enum(["USD", "BRL", "EUR", "GBP", "CHF"]),
    unit: z.literal("millions"),
    definition: z.string().min(1).max(120),
    sourceUrl: httpsSource,
    publicationUrl: httpsSource,
    locator: z.string().min(1).max(300),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceQuote: z.string().min(1).max(500),
  })
  .strict()
  .refine(
    v =>
      v.publishedOn >= v.periodEnd &&
      Number(v.periodEnd.slice(0, 4)) === v.fiscalYear,
    "Publication must follow the fiscal period"
  );
export type ForecastObservation = z.infer<typeof forecastObservationSchema>;
export const forecastEvaluationInputSchema = z
  .object({
    observations: forecastObservationSchema.array().min(4).max(50),
    // Use the following calendar day; intraday publication ordering is not represented.
    minTraining: z.number().int().min(3).max(20).default(3),
    maxHorizon: z.number().int().min(1).max(5).default(5),
  })
  .strict();
export const forecastModels = [
  "filinglens_growth_v1",
  "naive",
  "drift",
  "three_year_cagr",
] as const;
export type ForecastModel = (typeof forecastModels)[number];

/** Historical DCF proposal rule retained for comparison; no longer automatically proposed. */
export function taperedRevenueGrowth(
  latestGrowthPercent: number,
  horizonIndex: number
) {
  return Number((latestGrowthPercent * (1 - horizonIndex * 0.15)).toFixed(2));
}
export function revenueForecast(
  training: number[],
  model: ForecastModel,
  horizon: number
): number {
  const last = training.at(-1)!;
  if (model === "naive") return last;
  if (model === "drift")
    return last + (horizon * (last - training[0])) / (training.length - 1);
  if (model === "three_year_cagr") {
    const first = training[Math.max(0, training.length - 4)];
    const intervals = Math.min(3, training.length - 1);
    return last * Math.pow(last / first, horizon / intervals);
  }
  const growth = (last / training.at(-2)! - 1) * 100;
  let value = last;
  for (let h = 0; h < horizon; h++)
    value *= 1 + taperedRevenueGrowth(growth, h) / 100;
  return value;
}

/** Original-disclosure-vintage retrospective replay, NOT a forecast registered in the past. */
export function evaluateForecasts(raw: unknown) {
  const input = forecastEvaluationInputSchema.parse(raw);
  if (input.observations.length <= input.minTraining)
    throw Error("Not enough holdout observations");
  const observations = [...input.observations].sort(
    (a, b) => a.fiscalYear - b.fiscalYear
  );
  const basis = observations[0];
  if (
    new Set(observations.map(o => o.id)).size !== observations.length ||
    new Set(observations.map(o => o.fiscalYear)).size !== observations.length
  )
    throw Error(
      "Duplicate observation or fiscal year; select an explicit original vintage"
    );
  if (
    observations.some(
      o =>
        o.issuer !== basis.issuer ||
        o.currency !== basis.currency ||
        o.definition !== basis.definition
    )
  )
    throw Error("Issuer, currency or accounting definition mismatch");
  if (
    observations.some(
      (o, i) =>
        i > 0 &&
        (o.fiscalYear !== observations[i - 1].fiscalYear + 1 ||
          o.periodEnd <= observations[i - 1].periodEnd ||
          o.publishedOn <= observations[i - 1].publishedOn)
    )
  )
    throw Error(
      "Consecutive fiscal years and ordered publication dates required"
    );
  const rows: {
    origin: string;
    horizon: number;
    targetYear: number;
    model: ForecastModel;
    prediction: number;
    actual: number;
    error: number;
    absoluteError: number;
    apePercent: number;
    scaledError: number | null;
    trainingIds: string[];
    targetId: string;
  }[] = [];
  for (let t = input.minTraining; t < observations.length; t++) {
    const origin = new Date(
      Date.parse(observations[t - 1].publishedOn) + 86400000
    )
      .toISOString()
      .slice(0, 10);
    // Never silently substitute a later revision, target or post-origin record.
    const training = observations
      .slice(0, t)
      .filter(o => o.publishedOn < origin);
    if (training.length !== t || observations[t].periodEnd <= origin)
      throw Error("Training/target availability overlaps the forecast origin");
    const values = training.map(o => o.value);
    const scale =
      values.slice(1).reduce((s, v, i) => s + Math.abs(v - values[i]), 0) /
      (values.length - 1);
    for (
      let horizon = 1;
      horizon <= Math.min(input.maxHorizon, observations.length - t);
      horizon++
    ) {
      const target = observations[t + horizon - 1];
      for (const model of forecastModels) {
        const prediction = revenueForecast(values, model, horizon),
          error = prediction - target.value;
        if (!Number.isFinite(prediction) || prediction <= 0)
          throw Error("Unsupported nonpositive forecast");
        rows.push({
          origin,
          horizon,
          targetYear: target.fiscalYear,
          model,
          prediction,
          actual: target.value,
          error,
          absoluteError: Math.abs(error),
          apePercent: (Math.abs(error) / target.value) * 100,
          scaledError: scale > 0 ? Math.abs(error) / scale : null,
          trainingIds: training.map(o => o.id),
          targetId: target.id,
        });
      }
    }
  }
  const scores = forecastModels.flatMap(model =>
    Array.from({ length: input.maxHorizon }, (_, i) => i + 1).flatMap(
      horizon => {
        const subset = rows.filter(
          r => r.model === model && r.horizon === horizon
        );
        if (!subset.length) return [];
        const n = subset.length,
          scaled = subset.filter(r => r.scaledError !== null);
        return [
          {
            model,
            horizon,
            count: n,
            mae: subset.reduce((s, r) => s + r.absoluteError, 0) / n,
            rmse: Math.sqrt(subset.reduce((s, r) => s + r.error ** 2, 0) / n),
            bias: subset.reduce((s, r) => s + r.error, 0) / n,
            mapePercent: subset.reduce((s, r) => s + r.apePercent, 0) / n,
            mase: scaled.length
              ? scaled.reduce((s, r) => s + r.scaledError!, 0) / scaled.length
              : null,
            maseCount: scaled.length,
          },
        ];
      }
    )
  );
  return {
    schemaVersion: "forecast-evaluation.v1" as const,
    issuer: basis.issuer,
    currency: basis.currency,
    unit: basis.unit,
    evaluationType: "retrospective_original_disclosure_replay" as const,
    methodology:
      "Expanding origins, next-day publication cutoff; no tuning or model selection on holdouts.",
    limitations: [
      "Two selected US technology issuers are not a representative investment universe.",
      "Current copies of historical issuer disclosures are not independently timestamped archival captures.",
      "Retrospective reconstruction is not a prospectively registered forecast. Revenue error does not measure fair-value or return accuracy.",
      "Longer horizons have fewer overlapping folds; no statistical significance or prediction-interval claim.",
      "User-edited drivers and future company-specific forecasts are not validated by this reference benchmark.",
    ],
    observations,
    rows,
    scores,
  };
}
export type ForecastEvaluation = ReturnType<typeof evaluateForecasts>;
