import type {
  AgentName,
  Jurisdiction,
  MetadataResult,
  ModuleDiagnostic,
} from "../contracts/analysis";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Structured output validates shape, not usefulness. */
export function assessCompleteness(
  agent: AgentName,
  result: unknown,
  context?: { jurisdiction?: Jurisdiction; filingType?: string },
): ModuleDiagnostic {
  const root = record(result);

  switch (agent) {
    case "profiler": {
      const company = record(root?.company);
      const hasName = typeof company?.name === "string" && company.name.trim().length > 0;
      const hasDescription = typeof company?.description === "string" && company.description.trim().length > 30;
      return hasName && hasDescription
        ? { status: "complete", confidence: 0.85, ...(array(root?.kpis).length ? {} : { missing: ["filing-supported headline KPIs"] }) }
        : { status: "incomplete", reason: "profile_data_not_found", missing: ["issuer identity and business description"] };
    }
    case "market": {
      const market = record(root?.market);
      const hasIndustry = typeof market?.industry === "string" && market.industry.trim().length > 0;
      const hasDetail = ["competitors", "geographies", "segments"].some(
        key => array(market?.[key]).length > 0,
      );
      return hasIndustry && hasDetail
        ? { status: "complete", confidence: 0.85 }
        : { status: "incomplete", reason: "market_detail_not_found", missing: ["competitors, geographies, or operating segments"] };
    }
    case "risks":
      return array(root?.risks).length > 0
        ? { status: "complete", confidence: 0.85 }
        : { status: "incomplete", reason: "risk_factors_not_found", missing: ["ranked risk factors"] };
    case "financials": {
      const financials = record(root?.financials);
      const years = array(financials?.years);
      const revenue = array(financials?.revenue);
      const netIncome = array(financials?.netIncome);
      const totalAssets = array(financials?.totalAssets);
      const filingType = context?.filingType?.toLowerCase() ?? "";
      const narrativeOnly = filingType.includes("formulário")
        || filingType.includes("formulario")
        || /(^|\s)8-k($|\s)/i.test(filingType)
        || filingType.includes("fato relevante");
      if (narrativeOnly) {
        return {
          status: "not_applicable",
          reason: "financial_tables_not_applicable_to_form",
          missing: ["historical financial statements"],
        };
      }

      const corePeriods = Math.max(revenue.length, netIncome.length);
      const isUs = context?.jurisdiction === "us";
      if (isUs && filingType.includes("10-k")) {
        return years.length >= 3 && corePeriods >= 3 && totalAssets.length >= 2
          ? { status: "complete", confidence: 0.9 }
          : {
              status: "incomplete",
              reason: "sec_10k_financials_incomplete",
              missing: ["three income-statement periods and reported balance-sheet periods"],
            };
      }
      if (isUs && filingType.includes("10-q")) {
        return years.length >= 2 && corePeriods >= 2 && totalAssets.length >= 1
          ? { status: "complete", confidence: 0.88 }
          : {
              status: "incomplete",
              reason: "sec_10q_financials_incomplete",
              missing: ["current quarter, prior-year quarter, and balance sheet"],
            };
      }
      if (!isUs && filingType.includes("itr")) {
        const priorReference = financials?.crossReferencedPriorFiling === true;
        return (years.length >= 2 && corePeriods >= 2) || (years.length >= 1 && corePeriods >= 1 && priorReference)
          ? { status: "complete", confidence: priorReference ? 0.8 : 0.88 }
          : {
              status: "incomplete",
              reason: "cvm_itr_financials_incomplete",
              missing: ["current quarter and prior-year reference, or a prior DFP cross-reference"],
            };
      }
      const hasCoreSeries = corePeriods >= 2;
      return years.length >= 2 && hasCoreSeries
        ? { status: "complete", confidence: 0.88 }
        : {
            status: "incomplete",
            reason: "historical_financials_not_found",
            missing: ["at least two periods plus revenue or net income"],
          };
    }
    case "historian":
      return array(root?.timeline).length > 0 || array(root?.events).length > 0
        ? { status: "complete", confidence: 0.82 }
        : { status: "incomplete", reason: "timeline_events_not_found", missing: ["timeline or material events"] };
    case "synthesizer":
      return array(root?.summary).some(item => typeof item === "string" && item.trim().length > 0)
        ? { status: "complete", confidence: array(root?.confidenceNotes).length ? 0.9 : 0.72 }
        : { status: "incomplete", reason: "summary_not_found", missing: ["executive summary"] };
  }
}

export function assessMetadataCompleteness(
  result: MetadataResult,
): ModuleDiagnostic {
  const metadata = result.metadata;
  const identifier = metadata.jurisdiction === "br" ? metadata.cnpj : metadata.cik;
  const missing = [
    !metadata.filingType ? "filing type" : null,
    !metadata.reportingPeriod ? "reporting period" : null,
    !identifier ? (metadata.jurisdiction === "br" ? "CNPJ" : "CIK") : null,
  ].filter((item): item is string => Boolean(item));
  return missing.length <= 1
    ? { status: "complete", confidence: metadata.confidence, missing }
    : { status: "incomplete", reason: "filing_metadata_incomplete", confidence: metadata.confidence, missing };
}
