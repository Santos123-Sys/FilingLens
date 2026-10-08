import { z } from "zod";

/** Shared contract: the site assembles these slices into the full dashboard. */

export const evidenceReferenceSchema = z.object({
  section: z.string(),
  page: z.string().nullable().optional(),
  item: z.string().nullable().optional(),
  sourceForm: z.string().nullable().optional(),
  /** Exact filing excerpt used to validate a claim; never a paraphrase. */
  quote: z.string().nullable().optional(),
  kind: z.enum(["excerpt", "citation"]).optional(),
  /**
   * URL syntax is verified at citation-binding boundaries instead of encoded as
   * JSON-Schema format:"uri". OpenAI Responses rejects that format in response
   * schemas even when the application-level Zod validator otherwise accepts it.
   */
  url: z.string().optional(),
  publisher: z.string().optional(),
  accessed: z.string().optional(),
});
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

export const metadataSchema = z.object({
  metadata: z.object({
    jurisdiction: z.enum(["br", "us"]),
    filingType: z.string(),
    reportingPeriod: z.string().nullable(),
    filedAt: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    cnpj: z.string().nullable(),
    cvmDocumentClass: z.string().nullable(),
    registryData: z.string().nullable(),
    cik: z.string().nullable(),
    sicCode: z.string().nullable(),
    fiscalYearEnd: z.string().nullable(),
    stateOfIncorporation: z.string().nullable(),
    sources: z.array(evidenceReferenceSchema).max(8),
  }),
});
export type MetadataResult = z.infer<typeof metadataSchema>;

export const companySchema = z.object({
  company: z.object({
    name: z.string(),
    ticker: z.string().nullable(),
    exchange: z.string().nullable(),
    filingType: z.string(),
    periodEnd: z.string(),
    filedAt: z.string().nullable(),
    filingReference: z.string().nullable().optional(),
    description: z.string(),
  }),
  kpis: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        delta: z.string().nullable(),
        positive: z.boolean().nullable(),
        source: evidenceReferenceSchema.nullable().optional(),
      })
    )
    .max(8),
});
export type CompanyResult = z.infer<typeof companySchema>;

export const marketShareMetricSchema = z.object({
  label: z.string(),
  valuePercent: z.number().min(0).max(100),
  numerator: z.number().nonnegative(),
  denominator: z.number().positive(),
  unit: z.string(),
  period: z.string(),
  geography: z.string(),
  productScope: z.string(),
  method: z.enum(["direct_public_data", "public_proxy"]),
  provider: z.string(),
  companyMatch: z.string(),
  caveat: z.string().nullable().optional(),
  source: evidenceReferenceSchema,
});
export type MarketShareMetric = z.infer<typeof marketShareMetricSchema>;

/**
 * Narrow schema used only for the filing-extraction model. Web competitive
 * intelligence and public-data market-share fields are attached downstream and
 * intentionally excluded here to reduce structured-output failure surface.
 */
export const marketFilingSchema = z.object({
  market: z.object({
    industry: z.string(),
    competitors: z.array(z.string()).max(12),
    peerEvidence: z.array(z.object({
      name: z.string(),
      sourceType: z.literal("filing"),
      source: evidenceReferenceSchema,
    })).max(12).optional(),
    geographies: z.array(z.object({
      name: z.string(),
      values: z.array(z.number()),
      periods: z.array(z.string()).max(5).optional(),
      sourceType: z.literal("filing").optional(),
      source: evidenceReferenceSchema.nullable().optional(),
    })).max(8),
    segments: z.array(z.object({
      name: z.string(),
      revenue: z.array(z.number()),
      earnings: z.array(z.number()).nullable(),
      /** Source-disclosed reporting scale; never infer from consolidated accounts. */
      unit: z.string().max(64).optional(),
      currency: z.string().max(8).optional(),
      periods: z.array(z.string()).max(5).optional(),
      sourceType: z.literal("filing").optional(),
      source: evidenceReferenceSchema.nullable().optional(),
    })).max(12),
  }),
});

export const marketSchema = z.object({
  market: z.object({
    industry: z.string(),
    competitors: z.array(z.string()).max(12),
    peerEvidence: z.array(z.object({
      name: z.string(),
      sourceType: z.enum(["filing", "external"]),
      source: evidenceReferenceSchema,
    })).max(12).optional(),
    externalResearchStatus: z.enum(["pending", "not_needed", "complete", "no_citable_results", "unavailable"]).optional(),
    marketShares: z.array(marketShareMetricSchema).max(8).optional(),
    competitiveAnalysis: z.object({
      status: z.enum(["complete", "partial", "no_citable_results", "unavailable"]),
      methodology: z.literal("market-research-brief"),
      peerProfiles: z.array(z.object({
        name: z.string(),
        relationship: z.string(),
        positioning: z.string(),
        strengths: z.array(z.string()).max(3),
        vulnerabilities: z.array(z.string()).max(3),
        dataPoints: z.array(z.object({
          label: z.string(),
          value: z.string(),
          period: z.string(),
          context: z.string(),
          source: evidenceReferenceSchema,
        })).max(6).optional(),
        moatAssessment: z.object({
          rating: z.enum(["strong", "moderate", "limited", "unclear"]),
          confidence: z.enum(["high", "medium", "low"]),
          summary: z.string(),
          evidence: z.array(z.object({
            dimension: z.string(),
            assessment: z.string(),
            source: evidenceReferenceSchema,
          })).max(5),
        }).optional(),
        outlook: z.object({
          stance: z.enum(["favorable", "mixed", "challenged", "unclear"]),
          horizon: z.string(),
          summary: z.string(),
          drivers: z.array(z.string()).max(4),
          risks: z.array(z.string()).max(4),
          source: evidenceReferenceSchema,
        }).optional(),
        source: evidenceReferenceSchema,
      })).max(8),
      findings: z.array(z.object({
        insight: z.string(),
        implication: z.string(),
        source: evidenceReferenceSchema,
      })).max(8),
      marketShareProxies: z.array(z.object({
        label: z.string(),
        valuePercent: z.number().min(0).max(100),
        numerator: z.number().nonnegative(),
        denominator: z.number().positive(),
        unit: z.string(),
        period: z.string(),
        geography: z.string(),
        productScope: z.string(),
        basis: z.string(),
        source: evidenceReferenceSchema,
      })).max(4).optional(),
      marketStructure: z.object({
        summary: z.string(),
        hhi: z.number().nullable().optional(),
        basis: z.string().nullable().optional(),
        source: evidenceReferenceSchema.nullable().optional(),
      }).optional(),
      researchDiagnostics: z.object({
        candidatePeers: z.number().int().nonnegative(),
        verifiedPeers: z.number().int().nonnegative(),
        deepDivePeers: z.number().int().nonnegative().optional(),
        citedSources: z.number().int().nonnegative(),
        droppedClaims: z.number().int().nonnegative(),
        recoveryUsed: z.boolean(),
        strategy: z.literal("deterministic-citation-ranking-v1"),
      }).optional(),
    }).optional(),
      geographies: z
      .array(z.object({
        name: z.string(),
        values: z.array(z.number()),
        periods: z.array(z.string()).max(5).optional(),
        sourceType: z.enum(["filing", "external"]).optional(),
        source: evidenceReferenceSchema.nullable().optional(),
      }))
      .max(8),
    segments: z.array(
      z.object({
        name: z.string(),
        revenue: z.array(z.number()),
        earnings: z.array(z.number()).nullable(),
        /** Source-disclosed reporting scale; never infer from consolidated accounts. */
        unit: z.string().max(64).optional(),
        currency: z.string().max(8).optional(),
        periods: z.array(z.string()).max(5).optional(),
        sourceType: z.enum(["filing", "external"]).optional(),
        source: evidenceReferenceSchema.nullable().optional(),
      })
    ),
    insights: z.array(z.object({
      dimension: z.enum(["segment", "geography"]),
      metric: z.enum(["revenue", "earnings"]),
      name: z.string(),
      period: z.string(),
      comparisonPeriod: z.string(),
      comparison: z.enum(["YoY", "QoQ"]),
      changePercent: z.number(),
      sourceType: z.literal("filing"),
      source: evidenceReferenceSchema,
    })).max(12).optional(),
    validationFlags: z.array(z.object({ code: z.string(), note: z.string() })).max(100).optional(),
  }),
});
export type MarketResult = z.infer<typeof marketSchema>;

export const risksSchema = z.object({
  risks: z
    .array(
      z.object({
        title: z.string(),
        category: z.string(),
        severity: z.number().min(1).max(5),
        summary: z.string(),
        materialityRank: z.number().int().positive().optional(),
        source: evidenceReferenceSchema.nullable().optional(),
      })
    )
    .max(15),
});
export type RisksResult = z.infer<typeof risksSchema>;

export const financialsSchema = z.object({
  financials: z.object({
    unit: z.string(),
    years: z.array(z.string()).max(5),
    revenue: z.array(z.number()),
    grossProfit: z.array(z.number()).nullable().optional(),
    ebit: z.array(z.number()).nullable().optional(),
    ebitda: z.array(z.number()).nullable().optional(),
    adjustedEbitda: z.array(z.number()).nullable().optional(),
    incomeBeforeTax: z.array(z.number()).nullable().optional(),
    incomeTaxExpense: z.array(z.number()).nullable().optional(),
    reportedRoic: z.array(z.number()).nullable().optional(),
    netIncome: z.array(z.number()),
    eps: z.array(z.number()).nullable(),
    grossMargin: z.array(z.number()).nullable(),
    operatingMargin: z.array(z.number()).nullable(),
    operatingCashFlow: z.array(z.number()).nullable(),
    capex: z.array(z.number()).nullable(),
    freeCashFlow: z.array(z.number()).nullable(),
    dividends: z.array(z.number()).nullable(),
    buybacks: z.array(z.number()).nullable(),
    totalAssets: z.array(z.number()).nullable(),
    totalLiabilities: z.array(z.number()).nullable().optional(),
    totalEquity: z.array(z.number()).nullable().optional(),
    totalDebt: z.array(z.number()).nullable(),
    shortTermDebt: z.array(z.number()).nullable().optional(),
    longTermDebt: z.array(z.number()).nullable().optional(),
    cash: z.array(z.number()).nullable(),
    currentAssets: z.array(z.number()).nullable().optional(),
    currentLiabilities: z.array(z.number()).nullable().optional(),
    interestExpense: z.array(z.number()).nullable().optional(),
    accountsReceivable: z.array(z.number()).nullable().optional(),
    inventory: z.array(z.number()).nullable().optional(),
    accountsPayable: z.array(z.number()).nullable().optional(),
    costOfGoodsSold: z.array(z.number()).nullable().optional(),
    goodwill: z.array(z.number()).nullable().optional(),
    trends: z.array(z.object({
      metric: z.string(),
      period: z.string(),
      comparisonPeriod: z.string(),
      comparison: z.enum(["YoY", "QoQ"]),
      changePercent: z.number(),
    })).max(100).optional(),
    validationFlags: z.array(z.object({
      code: z.string(),
      severity: z.enum(["warning", "error"]),
      period: z.string().nullable().optional(),
      note: z.string(),
    })).max(100).optional(),
    crossReferencedPriorFiling: z.boolean().optional(),
    forwardGuidance: z
      .array(
        z.object({
          metric: z.string(),
          period: z.string(),
          range: z.string(),
          source: evidenceReferenceSchema,
        }),
      )
      .max(12)
      .optional(),
    evidence: z
      .array(
        z.object({
          metric: z.string(),
          period: z.string().nullable(),
          source: evidenceReferenceSchema,
        }),
      )
      .max(40)
      .optional(),
    annualHistory: z.object({
      years: z.array(z.string()).max(5),
      unit: z.string(),
      provider: z.string(),
      status: z.enum(["complete", "partial"]),
      revenue: z.array(z.number().nullable()).max(5),
      grossProfit: z.array(z.number().nullable()).max(5),
      ebit: z.array(z.number().nullable()).max(5),
      netIncome: z.array(z.number().nullable()).max(5),
      operatingCashFlow: z.array(z.number().nullable()).max(5),
      capex: z.array(z.number().nullable()).max(5),
      totalAssets: z.array(z.number().nullable()).max(5),
      totalLiabilities: z.array(z.number().nullable()).max(5),
      totalEquity: z.array(z.number().nullable()).max(5),
      totalDebt: z.array(z.number().nullable()).max(5),
      cash: z.array(z.number().nullable()).max(5),
      sources: z.array(evidenceReferenceSchema).max(12),
    }).optional(),
    validation: z
      .object({
        balanceSheetIdentity: z.enum(["reconciled", "mismatch", "not_available"]),
        difference: z.number().nullable(),
        ocrAnomalies: z.array(z.string()),
        jumpWarnings: z.array(z.string()),
        relationshipWarnings: z.array(z.string()).optional(),
      })
      .optional(),
    computed: z.array(
      z.object({
        key: z.string(),
        values: z.array(z.number().nullable()),
        unit: z.enum(["currency", "percent", "multiple", "ratio", "days"]),
        type: z.enum(["reported", "calculated", "adjusted"]),
        formula: z.string().nullable(),
        components: z.array(z.string()).max(8),
        numerator: z.string().nullable(),
        denominator: z.string().nullable(),
        periods: z.array(z.string()).max(5),
        sources: z.array(evidenceReferenceSchema).max(8),
        confidence: z.enum(["high", "medium"]),
        note: z.string().nullable().optional(),
      }),
    ).max(40).optional(),
  }),
});
export type FinancialsResult = z.infer<typeof financialsSchema>;

export const historySchema = z.object({
  timeline: z
    .array(
      z.object({
        year: z.string(),
        title: z.string(),
        category: z.string(),
        detail: z.string(),
        source: evidenceReferenceSchema.nullable().optional(),
        sourceType: z.enum(["filing", "external"]).optional(),
      })
    )
    .max(20),
  events: z
    .array(
      z.object({
        id: z.string().optional(),
        date: z.string(),
        title: z.string(),
        category: z.string(),
        impact: z.string().nullable(),
        sourceForm: z.string().nullable().optional(),
        source: evidenceReferenceSchema.nullable().optional(),
        dateGranularity: z.enum(["day", "month", "year"]).optional(),
        materiality: z.enum(["material", "implied", "routine"]).optional(),
        sourceType: z.enum(["filing", "external"]).optional(),
        confidence: z.enum(["high", "medium", "low"]).optional(),
        sourceRef: z.object({
          kind: z.enum(["excerpt", "citation"]),
          section: z.string().optional(),
          pageHint: z.string().optional(),
          quote: z.string().optional(),
          url: z.string().optional(),
          publisher: z.string().optional(),
          accessed: z.string().optional(),
        }).optional(),
      })
    )
    .max(15),
  enrichmentStatus: z.enum(["none", "partial", "full", "skipped"]).optional(),
  validationFlags: z.array(z.object({
    code: z.string(),
    eventId: z.string().optional(),
    note: z.string(),
    reason: z.string().optional(),
  })).max(100).optional(),
});
export type HistoryResult = z.infer<typeof historySchema>;

export const summarySchema = z.object({
  summary: z.array(z.string()).max(10),
  confidenceNotes: z
    .array(
      z.object({
        claim: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        reason: z.string(),
        source: evidenceReferenceSchema.nullable().optional(),
      }),
    )
    .max(12)
    .optional(),
  missingData: z.array(z.string()).max(20).optional(),
});
export type SummaryResult = z.infer<typeof summarySchema>;


export const valuationMethodSchema = z.enum(["dcf", "comps"]);
export type ValuationMethod = z.infer<typeof valuationMethodSchema>;

export const valuationAssumptionValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);
export type ValuationAssumptionValue = z.infer<typeof valuationAssumptionValueSchema>;

export const valuationAssumptionSchema = z.object({
  id: z.string(),
  method: valuationMethodSchema,
  category: z.string(),
  label: z.string(),
  proposed_value: valuationAssumptionValueSchema,
  final_value: valuationAssumptionValueSchema.optional(),
  unit: z.string().nullable().optional(),
  rationale: z.string(),
  source: evidenceReferenceSchema.nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]),
  impact: z.enum(["high", "medium", "low"]),
  status: z.enum(["proposed", "accepted", "edited", "rejected"]),
});
export type ValuationAssumption = z.infer<typeof valuationAssumptionSchema>;

export const valuationFigureSchema = z.object({
  value: z.number().nullable(),
  unit: z.string(),
  assumption_ids: z.array(z.string()),
  note: z.string().optional(),
});
export type ValuationFigure = z.infer<typeof valuationFigureSchema>;

export const dcfProjectionSchema = z.object({
  year: z.string(),
  revenue: z.number(),
  ebit_margin: z.number(),
  ebit: z.number(),
  nopat: z.number(),
  d_and_a: z.number(),
  capex: z.number(),
  change_nwc: z.number(),
  fcff: z.number(),
});
export type DcfProjection = z.infer<typeof dcfProjectionSchema>;

export const dcfValuationResultSchema = z.object({
  method: z.literal("dcf"),
  status: z.literal("complete"),
  projections: z.array(dcfProjectionSchema).length(5),
  figures: z.object({
    wacc: valuationFigureSchema,
    terminal_growth: valuationFigureSchema,
    terminal_value: valuationFigureSchema,
    enterprise_value: valuationFigureSchema,
    equity_value: valuationFigureSchema,
    implied_per_share: valuationFigureSchema,
  }),
  sensitivity: z.object({
    wacc: z.array(z.number()).length(5),
    terminal_growth: z.array(z.number()).length(5),
    values: z.array(z.array(z.number().nullable()).length(5)).length(5),
  }),
  scenarios: z.object({
    bull: valuationFigureSchema,
    base: valuationFigureSchema,
    bear: valuationFigureSchema,
  }),
  notes: z.array(z.string()).max(12),
});
export type DcfValuationResult = z.infer<typeof dcfValuationResultSchema>;

export const compsPeerResultSchema = z.object({
  name: z.string(),
  multiple: z.number().nullable(),
  source: evidenceReferenceSchema.nullable().optional(),
  assumption_id: z.string(),
});
export type CompsPeerResult = z.infer<typeof compsPeerResultSchema>;

export const compsValuationResultSchema = z.object({
  method: z.literal("comps"),
  status: z.literal("complete"),
  multiple_metric: z.enum(["EV/EBITDA", "EV/Revenue", "P/E"]),
  peers: z.array(compsPeerResultSchema).max(12),
  quartiles: z.object({
    q1: valuationFigureSchema,
    median: valuationFigureSchema,
    q3: valuationFigureSchema,
  }),
  figures: z.object({
    selected_multiple: valuationFigureSchema,
    enterprise_value: valuationFigureSchema,
    equity_value: valuationFigureSchema,
    implied_per_share: valuationFigureSchema,
  }),
  sensitivity: z.array(z.object({
    label: z.string(),
    multiple: z.number(),
    implied_per_share: z.number().nullable(),
    assumption_ids: z.array(z.string()),
  })).max(7),
  notes: z.array(z.string()).max(12),
});
export type CompsValuationResult = z.infer<typeof compsValuationResultSchema>;

export const valuationReconciliationSchema = z.object({
  status: z.enum(["aligned", "divergent", "unavailable"]),
  dcf_per_share: z.number().nullable(),
  comps_per_share: z.number().nullable(),
  divergence_percent: z.number().nullable(),
  threshold_percent: z.number(),
  notes: z.array(z.string()).max(8),
});
export type ValuationReconciliation = z.infer<typeof valuationReconciliationSchema>;

export const valuationBundleSchema = z.object({
  assumptions: z.object({
    dcf: z.array(valuationAssumptionSchema).optional(),
    comps: z.array(valuationAssumptionSchema).optional(),
  }).default({}),
  dcf: dcfValuationResultSchema.optional(),
  comps: compsValuationResultSchema.optional(),
  reconciliation: valuationReconciliationSchema.optional(),
});
export type ValuationBundle = z.infer<typeof valuationBundleSchema>;

export type AgentName =
  | "profiler"
  | "market"
  | "risks"
  | "financials"
  | "historian"
  | "synthesizer";

export type AnalysisStageName = "metadata" | AgentName;
export type Jurisdiction = "br" | "us";

export type FilingClassification = {
  jurisdiction: Jurisdiction;
  filingType: string;
  confidence: number;
  needsConfirmation: boolean;
  signals: string[];
};

export type ModuleDiagnostic = {
  status: "complete" | "incomplete" | "failed" | "not_applicable";
  reason?: string;
  missing?: string[];
  warnings?: string[];
  confidence?: number;
  enrichmentStatus?: "none" | "partial" | "full" | "skipped";
};

export type AnalysisDiagnostics = Partial<Record<AnalysisStageName, ModuleDiagnostic>>;

export type PrebuiltDashboardSeries = {
  state: "ready" | "empty";
  title: string;
  subtitle: string;
  axis: string[];
  bar: { name: string; values: number[] } | null;
  line: { name: string; values: number[]; suffix: string } | null;
  message?: string;
};

export type PrebuiltDashboardData = {
  template: "featured-map";
  jurisdiction: Jurisdiction;
  locale: "pt-BR" | "en-US";
  currency: "BRL" | "USD";
  riskPresentation: "narrative" | "structured";
  eventPriority: "fatos-relevantes" | "8-k";
  period: string;
  hero: {
    state: "ready" | "empty";
    label: string;
    value: number | null;
    unit: string;
    delta: string | null;
    comparison: string | null;
    message?: string;
  };
  kpis: CompanyResult["kpis"];
  combo: PrebuiltDashboardSeries;
  pareto: {
    state: "ready" | "empty";
    title: string;
    items: Array<{ name: string; value: number }>;
    message?: string;
  };
  pivot: {
    state: "ready" | "empty";
    title: string;
    columns: [string, string, string, string];
    rows: Array<[string, string, string, string]>;
    total: [string, string, string, string] | null;
    message?: string;
  };
};

/** The fully assembled dashboard data. */
export interface FilingAnalysis {
  schemaVersion: "2.0";
  jurisdiction: Jurisdiction;
  metadata: MetadataResult["metadata"];
  company: CompanyResult["company"];
  kpis: CompanyResult["kpis"];
  market: MarketResult["market"];
  risks: RisksResult["risks"];
  financials: FinancialsResult["financials"];
  timeline: HistoryResult["timeline"];
  events: HistoryResult["events"];
  historyValidationFlags?: HistoryResult["validationFlags"];
  summary: SummaryResult["summary"];
  confidenceNotes: NonNullable<SummaryResult["confidenceNotes"]>;
  missingData: string[];
  diagnostics?: AnalysisDiagnostics;
  prebuiltDashboard?: PrebuiltDashboardData;
  valuation?: ValuationBundle;
}

export type Market = "us" | "br";
