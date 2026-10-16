import type {
  EvidenceReference,
  FilingAnalysis,
  ValuationAssumption,
  ValuationBundle,
} from "./analysis";
import { annualBasis, moneyBasis } from "./valuation-basis";

export type LineageNode = {
  id: string;
  label: string;
  value: number | string | null;
  unit: string;
  period: string;
  classification:
    | "reported_actual"
    | "normalized_actual"
    | "user_assumption"
    | "calculated_metric"
    | "calculated_forecast";
  status:
    | "source_linked"
    | "user_supplied"
    | "unverified"
    | "conflicting_evidence"
    | "calculated";
  formula?: string;
  inputs: string[];
  sources: EvidenceReference[];
  retrievalMethod: string;
  checks: string[];
  limitations: string[];
};
export type FinancialLineage = {
  schemaVersion: "financial-lineage.v1";
  issuer: { name: string; ticker: string | null; registryId: string | null };
  accountingBasis: string;
  scope: string;
  calculationVersion: string;
  valuationDate: string | null;
  nodes: Record<string, LineageNode>;
};
const periodKey = (s: string) =>
  s
    .trim()
    .replace(/^FY\s*/i, "")
    .toUpperCase();
export function safeEvidenceUrl(value: string | undefined): string | null {
  try {
    const u = new URL(value ?? "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      [...u.searchParams.keys()].some(k =>
        /token|secret|password|signature|api.?key/i.test(k)
      )
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
const cleanSource = (s: EvidenceReference): EvidenceReference => ({
  ...s,
  url: safeEvidenceUrl(s.url) ?? undefined,
});
const resolved = (r: ValuationAssumption) =>
  r.final_value === undefined ? r.proposed_value : r.final_value;
export const actualNodeId = (metric: string, index: number, history = false) =>
  `${history ? "history" : "actual"}:${metric}:${index}`;
const metricLabels: Record<string, string> = {
  revenue: "Revenue",
  ebit: "Operating income (EBIT)",
  ebitda: "Reported EBITDA",
  netIncome: "Net income",
  eps: "Diluted EPS",
  grossProfit: "Gross profit",
  operatingCashFlow: "Operating cash flow",
  capex: "Capital expenditure",
  freeCashFlow: "Reported free cash flow",
  totalDebt: "Debt",
  cash: "Cash",
  totalAssets: "Assets",
  incomeBeforeTax: "Pretax income",
  incomeTaxExpense: "Income tax expense",
  accountsReceivable: "Trade receivables",
  inventory: "Inventory",
  accountsPayable: "Trade payables",
  interestExpense: "Interest expense",
};

/** Pure, local traversal of already-authorized analysis. Does not fetch or grant source access. */
export function buildFinancialLineage(
  a: FilingAnalysis,
  bundle: ValuationBundle | undefined = a.valuation
): FinancialLineage {
  const f = a.financials,
    nodes: Record<string, LineageNode> = {};
  const add = (n: LineageNode) => {
    nodes[n.id] = n;
    return n.id;
  };
  const result: FinancialLineage = {
    schemaVersion: "financial-lineage.v1",
    issuer: {
      name: a.company.name,
      ticker: a.company.ticker,
      registryId:
        a.jurisdiction === "us"
          ? (a.metadata?.cik ?? null)
          : (a.metadata?.cnpj ?? null),
    },
    accountingBasis: f.accountingBasis ?? "unknown",
    scope: f.statementScope ?? "unknown",
    calculationVersion:
      bundle?.dcf?.calculation_version ?? "legacy-or-unavailable",
    valuationDate: bundle?.dcf?.valuation_date ?? null,
    nodes,
  };
  const actuals = (history: boolean) => {
    const table = history ? f.annualHistory : f;
    if (!table) return;
    for (const [metric, label] of Object.entries(metricLabels)) {
      const series = table[metric as keyof typeof table];
      if (!Array.isArray(series) || series.length !== table.years.length)
        continue;
      table.years.forEach((period, i) => {
        const v = series[i];
        if (v !== null && typeof v !== "number") return;
        // A history-wide source does not establish a metric/period locator.
        const evidence = history
          ? []
          : (f.evidence ?? []).filter(
              e =>
                e.metric === metric &&
                e.period !== null &&
                periodKey(e.period) === periodKey(period)
            );
        const sources = evidence.map(e => cleanSource(e.source));
        const flags = (f.validationFlags ?? []).filter(
          flag =>
            (!flag.period || periodKey(flag.period) === periodKey(period)) &&
            /conflict|mismatch|unverified|inconsistent/i.test(flag.code)
        );
        const linked = sources.some(s =>
          Boolean(s.quote?.trim() && s.section.trim())
        );
        add({
          id: actualNodeId(metric, i, history),
          label,
          value: typeof v === "number" && Number.isFinite(v) ? v : null,
          unit:
            metric === "eps"
              ? `${moneyBasis(table.unit)?.currency ?? "currency"}/share`
              : table.unit,
          period,
          classification: "reported_actual",
          status: flags.some(flag =>
            /conflict|mismatch|inconsistent/i.test(flag.code)
          )
            ? "conflicting_evidence"
            : flags.length
              ? "unverified"
              : linked
                ? "source_linked"
                : "unverified",
          inputs: [],
          sources: history
            ? (f.annualHistory?.sources ?? []).map(cleanSource)
            : sources,
          retrievalMethod: history
            ? `Historical provider: ${f.annualHistory?.provider ?? "unknown"}; extraction method not recorded per value`
            : "Document extraction; exact retrieval method not recorded in this analysis",
          checks: linked
            ? [
                "Metric and period locator matched. Source link is not a financial reconciliation.",
              ]
            : [],
          limitations: [
            ...flags.map(x => x.note),
            ...(!linked
              ? ["No metric-specific supporting passage for this period."]
              : []),
            ...(v === null
              ? ["Missing value; not substituted with zero."]
              : []),
          ],
        });
      });
    }
  };
  actuals(false);
  actuals(true);
  const basis = annualBasis(a),
    sourceTable = basis?.fromHistory ? f.annualHistory : f;
  const baseIndex =
    sourceTable?.years.findIndex(
      y => periodKey(y) === periodKey(basis?.period ?? "")
    ) ?? -1;
  const baseId = (key: string) =>
    actualNodeId(key, baseIndex, Boolean(basis?.fromHistory));
  const mapping: Record<string, string[]> = {
    base_revenue: ["revenue"],
    net_debt: ["totalDebt", "cash"],
    shares_outstanding: ["netIncome", "eps"],
    tax_rate: ["incomeTaxExpense", "incomeBeforeTax"],
    da_pct_revenue: ["ebitda", "ebit", "revenue"],
    capex_pct_revenue: ["capex", "revenue"],
    nwc_pct_revenue: [
      "accountsReceivable",
      "inventory",
      "accountsPayable",
      "revenue",
    ],
    pre_tax_cost_debt: ["interestExpense", "totalDebt"],
  };
  for (const method of ["dcf", "comps"] as const)
    for (const row of bundle?.assumptions[method] ?? []) {
      const key = row.id.replace(/^dcf\./, "");
      const metrics =
        mapping[key] ??
        (key.startsWith("ebit_margin_")
          ? ["ebit", "revenue"]
          : key.startsWith("revenue_growth_")
            ? ["revenue"]
            : []);
      const inputs = metrics.map(baseId).filter(id => nodes[id]);
      if (key.startsWith("revenue_growth_") && sourceTable && baseIndex > 0) {
        const priorId = actualNodeId(
          "revenue",
          baseIndex - 1,
          Boolean(basis?.fromHistory)
        );
        if (nodes[priorId]) inputs.push(priorId);
      }
      add({
        id: row.id,
        label: row.label,
        value:
          typeof resolved(row) === "boolean"
            ? String(resolved(row))
            : (resolved(row) as number | string | null),
        unit: row.unit ?? "",
        period:
          row.category === "baseline"
            ? (basis?.period ?? "Unspecified")
            : "Analyst scenario",
        classification: "user_assumption",
        status: "user_supplied",
        formula: row.rationale,
        inputs,
        sources: row.source ? [cleanSource(row.source)] : [],
        retrievalMethod:
          "Reviewed or edited by analyst; source-linked starting point is not a forecast fact",
        checks: [`Review state: ${row.status}`],
        limitations: [
          ...(row.status === "proposed"
            ? ["Not approved for calculation."]
            : []),
          ...(resolved(row) !== row.proposed_value
            ? [
                "Edited value differs from its original proposal. Historical links explain the starting point; the final amount remains an analyst input.",
              ]
            : []),
          ...(row.id === "dcf.shares_outstanding"
            ? [
                "Net income / diluted EPS is a weighted-average proxy. Confirm valuation-date dilution separately.",
              ]
            : []),
        ],
      });
    }
  const calculated = (
    id: string,
    label: string,
    value: number | null,
    unit: string,
    period: string,
    formula: string,
    inputs: string[],
    forecast = false
  ) =>
    add({
      id,
      label,
      value,
      unit,
      period,
      formula,
      inputs: inputs.filter(x => Boolean(nodes[x])),
      sources: [],
      retrievalMethod: "Deterministic calculation from the reviewed ledger",
      classification: forecast ? "calculated_forecast" : "calculated_metric",
      status: value === null ? "unverified" : "calculated",
      checks: ["Calculation provenance; not a statement of forecast accuracy."],
      limitations: [
        "Displayed values may be rounded. Reproduce from full reviewed inputs and calculation version.",
        ...(inputs.some(x => !nodes[x])
          ? [
              "Some historical input lineage is unavailable in this saved version.",
            ]
          : []),
      ],
    });
  const d = bundle?.dcf;
  if (d) {
    const currency = d.figures.enterprise_value.unit;
    d.projections.forEach((row, i) => {
      const y = i + 1,
        id = (key: string) => `forecast:Y${y}:${key}`,
        prev = i ? `forecast:Y${i}:revenue` : "dcf.base_revenue";
      calculated(
        id("revenue"),
        `Y${y} revenue`,
        row.revenue,
        currency,
        row.year,
        "Prior revenue × (1 + growth / 100)",
        [prev, `dcf.revenue_growth_y${y}`],
        true
      );
      calculated(
        id("ebit_margin"),
        `Y${y} operating margin`,
        row.ebit_margin,
        "%",
        row.year,
        "User-approved operating margin",
        [`dcf.ebit_margin_y${y}`],
        true
      );
      calculated(
        id("ebit"),
        `Y${y} EBIT`,
        row.ebit,
        currency,
        row.year,
        "Revenue × operating margin / 100",
        [id("revenue"), id("ebit_margin")],
        true
      );
      calculated(
        id("nopat"),
        `Y${y} NOPAT`,
        row.nopat,
        currency,
        row.year,
        d.calculation_version
          ? "EBIT − max(EBIT, 0) × tax rate / 100"
          : "Legacy: EBIT × (1 − tax rate / 100)",
        [id("ebit"), "dcf.tax_rate"],
        true
      );
      calculated(
        id("d_and_a"),
        `Y${y} D&A`,
        row.d_and_a,
        currency,
        row.year,
        "Revenue × D&A / revenue ratio",
        [id("revenue"), "dcf.da_pct_revenue"],
        true
      );
      calculated(
        id("capex"),
        `Y${y} capex`,
        row.capex,
        currency,
        row.year,
        "Revenue × capex / revenue ratio",
        [id("revenue"), "dcf.capex_pct_revenue"],
        true
      );
      calculated(
        id("change_nwc"),
        `Y${y} change in NWC`,
        row.change_nwc,
        currency,
        row.year,
        "(Current revenue − prior revenue) × operating NWC / revenue ratio",
        [id("revenue"), prev, "dcf.nwc_pct_revenue"],
        true
      );
      calculated(
        id("fcff"),
        `Y${y} FCFF`,
        row.fcff,
        currency,
        row.year,
        "NOPAT + D&A − capex − change in NWC",
        [id("nopat"), id("d_and_a"), id("capex"), id("change_nwc")],
        true
      );
    });
    const ids = (bundle?.assumptions.dcf ?? []).map(r => r.id);
    calculated(
      "dcf:wacc",
      "WACC",
      d.figures.wacc.value,
      "%",
      d.valuation_date ?? "Unspecified",
      "(1 − debt weight) × (risk-free + beta × ERP) + debt weight × cost of debt × (1 − tax rate)",
      d.figures.wacc.assumption_ids
    );
    calculated(
      "dcf:terminal_growth",
      "Terminal growth",
      d.figures.terminal_growth.value,
      "%",
      "Perpetuity",
      "Reviewed nominal growth assumption",
      ["dcf.terminal_growth"]
    );
    if (d.terminal) {
      calculated(
        "terminal:nopat",
        "Terminal NOPAT",
        d.terminal.nopat,
        currency,
        "Y6",
        "Y5 NOPAT × (1 + g / 100)",
        ["forecast:Y5:nopat", "dcf.terminal_growth"],
        true
      );
      calculated(
        "terminal:reinvestment_rate",
        "Terminal reinvestment rate",
        d.terminal.reinvestment_rate_percent,
        "%",
        "Perpetuity",
        "g / terminal incremental ROIC × 100",
        ["dcf.terminal_growth", "dcf.terminal_roic"]
      );
      calculated(
        "terminal:reinvestment",
        "Terminal reinvestment",
        d.terminal.reinvestment,
        currency,
        "Y6",
        "Terminal NOPAT × reinvestment rate / 100",
        ["terminal:nopat", "terminal:reinvestment_rate"],
        true
      );
      calculated(
        "terminal:fcff",
        "Terminal FCFF",
        d.terminal.fcff,
        currency,
        "Y6",
        "Terminal NOPAT − terminal reinvestment",
        ["terminal:nopat", "terminal:reinvestment"],
        true
      );
    }
    calculated(
      "dcf:terminal_value",
      "Terminal enterprise value",
      d.figures.terminal_value.value,
      currency,
      "End of Y5",
      "Terminal FCFF in Y6 / ((WACC − g) / 100)",
      ["terminal:fcff", "dcf:wacc", "dcf:terminal_growth"]
    );
    calculated(
      "dcf:enterprise_value",
      "Enterprise value",
      d.figures.enterprise_value.value,
      currency,
      d.valuation_date ?? "Unspecified",
      "Σ FCFF_t / (1 + WACC/100)^t + terminal value / (1 + WACC/100)^5",
      [
        ...d.projections.map((_, i) => `forecast:Y${i + 1}:fcff`),
        "dcf:wacc",
        "dcf:terminal_value",
      ]
    );
    calculated(
      "dcf:equity_value",
      "Equity value",
      d.figures.equity_value.value,
      currency,
      d.valuation_date ?? "Unspecified",
      "Enterprise value − net debt + other equity adjustments",
      ["dcf:enterprise_value", "dcf.net_debt", "dcf.equity_adjustment"]
    );
    calculated(
      "dcf:implied_per_share",
      "Implied value per share",
      d.figures.implied_per_share.value,
      d.figures.implied_per_share.unit,
      d.valuation_date ?? "Unspecified",
      "Equity value / valuation-date diluted shares",
      ["dcf:equity_value", "dcf.shares_outstanding"]
    );
    d.sensitivity.values.forEach((row, i) =>
      row.forEach((value, j) =>
        calculated(
          `sensitivity:${i}:${j}`,
          "DCF sensitivity",
          value,
          d.figures.implied_per_share.unit,
          "Scenario",
          `Rerun v2 with WACC=${d.sensitivity.wacc[i]}%, g=${d.sensitivity.terminal_growth[j]}%; all remaining reviewed assumptions fixed`,
          ids
        )
      )
    );
    for (const key of ["bull", "base", "bear"] as const)
      calculated(
        `scenario:${key}`,
        `${key} scenario`,
        d.scenarios[key].value,
        d.scenarios[key].unit,
        "Scenario",
        "Rerun reviewed ledger using approved scenario growth, margin, WACC and terminal-growth spreads; not probabilities",
        ids
      );
  }
  const c = bundle?.comps;
  if (c) {
    for (const [key, figure] of Object.entries(c.figures))
      calculated(
        `comps:${key}`,
        key.replaceAll("_", " "),
        figure.value,
        figure.unit,
        "Reviewed peer snapshot",
        key === "implied_per_share"
          ? "Equity / diluted shares"
          : key === "equity_value"
            ? "Enterprise value − net debt + bridge adjustments"
            : key === "enterprise_value"
              ? "Selected multiple × annual target metric (P/E values equity directly)"
              : "Selected reviewed peer multiple",
        figure.assumption_ids
      );
  }
  // Propagate observed evidence problems through the graph without treating analyst acceptance as source verification.
  const problems = new Map<string, number>();
  const visit = (id: string, seen = new Set<string>()): number => {
    if (problems.has(id)) return problems.get(id)!;
    const node = nodes[id];
    if (!node || seen.has(id)) return 1;
    const next = new Set(seen);
    next.add(id);
    const inherited = Math.max(
      0,
      ...node.inputs.map(input => visit(input, next))
    );
    const own =
      node.status === "conflicting_evidence"
        ? 2
        : node.status === "unverified"
          ? 1
          : 0;
    const severity = Math.max(own, inherited);
    if (inherited)
      node.limitations.push(
        "A linked input has missing or conflicting evidence; review dependent results."
      );
    if (node.status === "calculated" && severity)
      node.status = severity === 2 ? "conflicting_evidence" : "unverified";
    problems.set(id, severity);
    return severity;
  };
  Object.keys(nodes).forEach(id => visit(id));
  return result;
}

/** Export contains no capability/session credential. Fingerprints identify versions, not correctness. */
export function financialAuditExport(
  a: FilingAnalysis,
  bundle: ValuationBundle,
  exportedAt = new Date().toISOString()
) {
  return {
    schemaVersion: "financial-audit.v1",
    exportedAt,
    company: a.company,
    metadata: a.metadata,
    financials: a.financials,
    market: a.market,
    valuation: bundle,
    lineage: buildFinancialLineage(a, bundle),
    definitions: {
      source_linked:
        "Metric and period locator attached; financial correctness not independently reconciled.",
      user_supplied: "Analyst input; acceptance is not source verification.",
      calculated:
        "Deterministic derived amount; dependent input quality still matters.",
      unverified: "Supporting evidence is missing or incomplete.",
      conflicting_evidence: "A stored mismatch or conflict requires review.",
    },
  };
}
