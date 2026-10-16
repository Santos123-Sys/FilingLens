import { z } from "zod";
import { isoDate, httpsSource } from "./forecast-evaluation";
import type { FinancialLineage, LineageNode } from "./financial-lineage";

const amount = z.number().finite().min(0).max(1e10);
const signedAmount = z.number().finite().min(-1e10).max(1e10);
const source = z
  .object({ url: httpsSource, note: z.string().min(1).max(600) })
  .strict();
const common = {
  issuer: z.string().min(1).max(180),
  currency: z.enum(["USD", "BRL", "EUR", "GBP", "CHF"]),
  valuationDate: isoDate,
  inputAsOf: isoDate,
  dilutedShares: amount.positive(),
  reviewed: z.literal(true),
  sample: z.boolean(),
  // Keyed by input ID. Values remain analyst supplied; links are not source verification.
  evidence: z
    .record(z.string().max(100), source)
    .refine(v => Object.keys(v).length <= 100)
    .default({}),
};
export const residualIncomeInputSchema = z
  .object({
    ...common,
    method: z.literal("residual_income"),
    sector: z.enum(["bank", "insurer"]),
    openingCommonEquity: amount.positive(),
    costOfEquityPercent: z.number().finite().gt(0).max(50),
    netIncome: signedAmount.array().length(5),
    dividends: amount.array().length(5),
    minimumCommonEquity: amount.array().length(5),
    terminalRoePercent: z.number().finite().gt(0).max(50),
    terminalGrowthPercent: z.number().finite().min(0).max(10),
    cleanSurplusConfirmed: z.literal(true),
    regulatoryCapitalReviewed: z.literal(true),
  })
  .strict();
export const reitNavInputSchema = z
  .object({
    ...common,
    method: z.literal("reit_nav"),
    sector: z.literal("equity_reit"),
    properties: z
      .object({
        name: z.string().min(1).max(120),
        annualForwardNoi: amount.positive(),
        capRatePercent: z.number().finite().min(0.1).max(30),
        ownershipPercent: z.number().finite().gt(0).max(100),
      })
      .strict()
      .array()
      .min(1)
      .max(30),
    cash: amount,
    otherAssets: amount,
    grossDebt: amount,
    otherLiabilities: amount,
    preferredEquity: amount,
    nonControllingInterests: amount,
    corporateCostValue: amount,
    ownershipAndClaimsReviewed: z.literal(true),
  })
  .strict();
export const sectorValuationInputSchema = z.discriminatedUnion("method", [
  residualIncomeInputSchema,
  reitNavInputSchema,
]);
export type SectorValuationInput = z.infer<typeof sectorValuationInputSchema>;
export type ResidualIncomeInput = z.infer<typeof residualIncomeInputSchema>;
export type ReitNavInput = z.infer<typeof reitNavInputSchema>;

export function calculateSectorValuation(raw: unknown) {
  const x = sectorValuationInputSchema.parse(raw);
  if (x.inputAsOf > x.valuationDate)
    throw Error("Inputs cannot be dated after valuation");
  const unit = `${x.currency} millions`,
    nodes: Record<string, LineageNode> = {};
  const input = (
    id: string,
    label: string,
    value: number,
    u = unit,
    period = x.inputAsOf
  ) => {
    const s = x.evidence[id];
    nodes[id] = {
      id,
      label,
      value,
      unit: u,
      period,
      classification: "user_assumption",
      status: "user_supplied",
      inputs: [],
      sources: s
        ? [{ url: s.url, section: s.note, publisher: "Analyst-linked source" }]
        : [],
      retrievalMethod:
        "Analyst supplied; no RAG or web retrieval is performed by this calculator.",
      checks: ["Schema and range validated"],
      limitations: [
        x.sample
          ? "Synthetic example, not company facts."
          : "Analyst review does not establish source verification.",
        ...(s
          ? ["A linked source is not a numerical or accounting tie-out."]
          : ["No source attached to this input."]),
      ],
    };
    return id;
  };
  const derived = (
    id: string,
    label: string,
    value: number,
    formula: string,
    inputs: string[],
    u = unit,
    period = x.valuationDate
  ) => {
    if (!Number.isFinite(value)) throw Error("Nonfinite sector calculation");
    nodes[id] = {
      id,
      label,
      value,
      unit: u,
      period,
      classification: "calculated_metric",
      status: "calculated",
      formula,
      inputs,
      sources: [],
      retrievalMethod: "Deterministic sector model",
      checks: ["Conditional on reviewed inputs"],
      limitations: [
        "Model value is conditional; forecast quality and input accuracy are separate checks.",
      ],
    };
    return id;
  };
  input(
    "dilutedShares",
    "Valuation-date diluted common shares",
    x.dilutedShares,
    "million shares"
  );
  let equity: number;
  let reconciliation: {
    dividendDiscountEquity: number;
    difference: number;
  } | null = null;
  const schedule: Record<string, number | string>[] = [];
  let limitations: string[];
  if (x.method === "residual_income") {
    const r = x.costOfEquityPercent / 100,
      g = x.terminalGrowthPercent / 100,
      roe = x.terminalRoePercent / 100;
    if (r <= g) throw Error("Cost of equity must exceed terminal growth");
    if (g > roe) throw Error("Terminal growth requires retention above 100%");
    input(
      "openingCommonEquity",
      "Opening common book equity",
      x.openingCommonEquity
    );
    input(
      "costOfEquityPercent",
      "Cost of common equity",
      x.costOfEquityPercent,
      "%"
    );
    input(
      "terminalRoePercent",
      "Sustainable terminal ROE",
      x.terminalRoePercent,
      "%",
      "Y6 onward"
    );
    input(
      "terminalGrowthPercent",
      "Terminal book-equity growth",
      x.terminalGrowthPercent,
      "%",
      "Y6 onward"
    );
    let book = x.openingCommonEquity,
      pvRi = 0,
      pvDividends = 0,
      previousBookId = "openingCommonEquity";
    for (let i = 0; i < 5; i++) {
      const period = `Y${i + 1}`,
        opening = book;
      const ni = input(
        `netIncome.${i}`,
        `Common net income ${period}`,
        x.netIncome[i],
        unit,
        period
      );
      const div = input(
        `dividends.${i}`,
        `Common distributions ${period}`,
        x.dividends[i],
        unit,
        period
      );
      const floor = input(
        `minimumCommonEquity.${i}`,
        `Reviewed common-equity capital floor ${period}`,
        x.minimumCommonEquity[i],
        unit,
        period
      );
      book += x.netIncome[i] - x.dividends[i];
      if (book <= 0 || book < x.minimumCommonEquity[i])
        throw Error(`Common-equity capital floor breached in ${period}`);
      const charge = r * opening,
        ri = x.netIncome[i] - charge,
        pv = ri / (1 + r) ** (i + 1);
      const chargeId = derived(
        `charge.${i}`,
        `Equity charge ${period}`,
        charge,
        "Cost of equity × BEGINNING common book equity",
        ["costOfEquityPercent", previousBookId],
        unit,
        period
      );
      const riId = derived(
        `ri.${i}`,
        `Residual income ${period}`,
        ri,
        "Common net income − equity charge",
        [ni, chargeId],
        unit,
        period
      );
      derived(
        `pvRi.${i}`,
        `Present residual income ${period}`,
        pv,
        "Residual income / (1 + cost of equity)^year",
        [riId, "costOfEquityPercent"],
        unit,
        period
      );
      previousBookId = derived(
        `book.${i}`,
        `Ending common equity ${period}`,
        book,
        "Beginning common equity + net income − distributions; no OCI or net issuance",
        [previousBookId, ni, div],
        unit,
        period
      );
      derived(
        `capitalSurplus.${i}`,
        `Capital-floor surplus ${period}`,
        book - x.minimumCommonEquity[i],
        "Ending common equity − reviewed common-equity capital floor",
        [previousBookId, floor],
        unit,
        period
      );
      schedule.push({
        year: period,
        openingEquity: opening,
        netIncome: x.netIncome[i],
        dividends: x.dividends[i],
        equityCharge: charge,
        residualIncome: ri,
        presentResidualIncome: pv,
        endingEquity: book,
      });
      pvRi += pv;
      pvDividends += x.dividends[i] / (1 + r) ** (i + 1);
    }
    const ri6 = (roe - r) * book,
      continuingRi = ri6 / (r - g),
      terminalEquity = book + continuingRi;
    if (terminalEquity <= 0)
      throw Error("Nonpositive continuing common-equity value");
    derived(
      "terminalRi",
      "Year 6 residual income",
      ri6,
      "(Terminal ROE − cost of equity) × ending Y5 common equity",
      ["terminalRoePercent", "costOfEquityPercent", "book.4"],
      unit,
      "Y6"
    );
    derived(
      "terminalRiPv",
      "Present continuing residual income",
      continuingRi / (1 + r) ** 5,
      "RI6 / (cost of equity − growth) / (1 + cost of equity)^5",
      ["terminalRi", "costOfEquityPercent", "terminalGrowthPercent"],
      unit,
      "Y6 onward"
    );
    derived(
      "terminalPayout",
      "Sustainable terminal payout",
      (1 - g / roe) * 100,
      "100 × (1 − terminal growth / terminal ROE)",
      ["terminalGrowthPercent", "terminalRoePercent"],
      "%",
      "Y6 onward"
    );
    equity = x.openingCommonEquity + pvRi + continuingRi / (1 + r) ** 5;
    const dividendDiscountEquity = pvDividends + terminalEquity / (1 + r) ** 5;
    reconciliation = {
      dividendDiscountEquity,
      difference: equity - dividendDiscountEquity,
    };
    if (
      Math.abs(reconciliation.difference) >
      Math.max(1e-7, Math.abs(equity) * 1e-10)
    )
      throw Error("Residual-income/dividend identity failed");
    derived(
      "equity",
      "Common equity value",
      equity,
      "Opening book equity + Σ PV(residual income Y1–Y5) + PV(continuing residual income)",
      [
        "openingCommonEquity",
        ...Array.from({ length: 5 }, (_, i) => `pvRi.${i}`),
        "terminalRiPv",
      ]
    );
    limitations = [
      "Requires clean surplus: no unmodeled OCI, net common issuance or buybacks. Incorporate these with a specialist schedule before use.",
      "Common-equity capital floors are analyst reconciliations, not a Basel/CET1 or insurer solvency calculation.",
      "Credit losses, reserving, underwriting, duration and asset/liability risks must already be reflected in the reviewed net-income path.",
      "No debt subtraction: this is a common-equity model. Stable terminal ROE and retention imply perpetual growth.",
    ];
  } else {
    let properties = 0;
    const propertyIds: string[] = [];
    x.properties.forEach((p, i) => {
      const noi = input(
        `properties.${i}.annualForwardNoi`,
        `${p.name} · annual forward NOI`,
        p.annualForwardNoi,
        unit,
        "Next 12 months"
      );
      const cap = input(
        `properties.${i}.capRatePercent`,
        `${p.name} · capitalization rate`,
        p.capRatePercent,
        "%"
      );
      const own = input(
        `properties.${i}.ownershipPercent`,
        `${p.name} · economic ownership`,
        p.ownershipPercent,
        "%"
      );
      const value =
        ((p.annualForwardNoi / (p.capRatePercent / 100)) * p.ownershipPercent) /
        100;
      properties += value;
      propertyIds.push(
        derived(
          `propertyValue.${i}`,
          `${p.name} · attributable property value`,
          value,
          "Annual forward NOI / capitalization rate × economic ownership",
          [noi, cap, own]
        )
      );
      schedule.push({
        property: p.name,
        annualForwardNoi: p.annualForwardNoi,
        capRatePercent: p.capRatePercent,
        ownershipPercent: p.ownershipPercent,
        propertyValue: value,
      });
    });
    derived(
      "propertiesValue",
      "Attributable property value",
      properties,
      "Σ attributable property values",
      propertyIds
    );
    const keys = [
      "cash",
      "otherAssets",
      "grossDebt",
      "otherLiabilities",
      "preferredEquity",
      "nonControllingInterests",
      "corporateCostValue",
    ] as const;
    const labels = [
      "Unrestricted cash",
      "Other net asset value",
      "Attributable gross debt",
      "Other liabilities",
      "Preferred equity claims",
      "Remaining noncontrolling claims",
      "Capitalized corporate costs",
    ];
    keys.forEach((k, i) => input(k, labels[i], x[k]));
    equity =
      properties +
      x.cash +
      x.otherAssets -
      x.grossDebt -
      x.otherLiabilities -
      x.preferredEquity -
      x.nonControllingInterests -
      x.corporateCostValue;
    derived(
      "equity",
      "Common equity NAV",
      equity,
      "Attributable properties + cash + other assets − gross debt − other liabilities − preferred equity − remaining noncontrolling claims − corporate cost value",
      ["propertiesValue", ...keys]
    );
    limitations = [
      "Equity REITs only; mortgage REITs, development projects and negative-NOI properties require a different model.",
      "NOI and capitalization rates must use consistent forward periods, lease, capex-reserve and property conventions.",
      "Review JV debt and economic ownership on the same look-through basis; do not deduct the same minority claim twice.",
      "Cap rates, property values, corporate costs and liabilities are analyst inputs; this is not an independent appraisal or an AFFO forecast.",
    ];
  }
  if (equity <= 0)
    throw Error("Nonpositive common-equity value requires a distress model");
  const perShare = equity / x.dilutedShares;
  derived(
    "perShare",
    "Sector value per common share",
    perShare,
    "Common equity value / valuation-date diluted common shares",
    ["equity", "dilutedShares"],
    `${x.currency}/share`
  );
  const lineage: FinancialLineage = {
    schemaVersion: "financial-lineage.v1",
    issuer: { name: x.issuer, ticker: null, registryId: null },
    accountingBasis: "Analyst-reviewed common equity / property inputs",
    scope: x.sample ? "Synthetic example" : "Analyst sector model",
    calculationVersion:
      x.method === "residual_income"
        ? "residual-income.v1"
        : "equity-reit-nav.v1",
    valuationDate: x.valuationDate,
    nodes,
  };
  return {
    schemaVersion: "sector-valuation.v1" as const,
    method: x.method,
    input: x,
    equityValue: equity,
    valuePerShare: perShare,
    unit: `${x.currency}/share`,
    schedule,
    reconciliation,
    lineage,
    limitations,
    publicationStatus: "review_export_only" as const,
  };
}
export type SectorValuationResult = ReturnType<typeof calculateSectorValuation>;
