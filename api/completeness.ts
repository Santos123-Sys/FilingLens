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

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
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
      const hasName = nonEmptyString(company?.name);
      const hasDescription = typeof company?.description === "string" && company.description.trim().length > 30;
      const hasIdentity = hasName && [company?.ticker, company?.exchange, company?.filingType].some(nonEmptyString);
      const kpiCount = array(root?.kpis).length;
      const filingType = context?.filingType?.toLowerCase() ?? "";
      const periodicUpdate = /10-q|8-k|itr|fato relevante/.test(filingType);

      // Periodic filings often do not repeat the full Item 1 / business narrative.
      // Treat explicit issuer identity plus at least one filing KPI as a usable profile,
      // while preserving the absent description as a visible data gap.
      if (hasName && hasDescription) {
        return {
          status: "complete",
          confidence: 0.85,
          ...(kpiCount ? {} : { missing: ["filing-supported headline KPIs"] }),
        };
      }
      if (periodicUpdate && hasIdentity && kpiCount > 0) {
        return {
          status: "complete",
          confidence: 0.8,
          missing: ["business description not repeated in this periodic filing"],
          warnings: ["periodic_filing_profile_uses_identity_and_kpis"],
        };
      }
      return { status: "incomplete", reason: "profile_data_not_found", missing: ["issuer identity and business description or filing KPIs"] };
    }
    case "market": {
      const market = record(root?.market);
      const hasIndustry = typeof market?.industry === "string" && market.industry.trim().length > 0;
      const competitive = record(market?.competitiveAnalysis);
      const hasDetail = ["competitors", "geographies", "segments", "marketShares"].some(
        key => array(market?.[key]).length > 0,
      ) || array(competitive?.peerProfiles).length > 0
        || array(competitive?.findings).length > 0
        || array(competitive?.marketShareProxies).length > 0;
      return hasDetail && (hasIndustry || array(market?.marketShares).length > 0 || array(competitive?.peerProfiles).length > 0)
        ? { status: "complete", confidence: 0.85 }
        : { status: "incomplete", reason: "market_detail_not_found", missing: ["industry context plus peers, public market share, geographies, or operating segments"] };
    }
    case "risks": {
      if (array(root?.risks).length > 0) return { status: "complete", confidence: 0.85 };
      const filingType = context?.filingType?.toLowerCase() ?? "";
      const noStandaloneRiskSectionExpected = /relat[oó]rio de desempenho|earnings release|press release|apresenta(?:ç|c)[aã]o de resultados|fato relevante|(^|\s)8-k($|\s)|(^|\s)6-k($|\s)/i.test(filingType);
      return noStandaloneRiskSectionExpected
        ? {
            status: "not_applicable",
            reason: "risk_section_not_expected_for_filing",
            warnings: ["risk_inventory_requires_annual_or_reference_filing"],
          }
        : { status: "incomplete", reason: "risk_factors_not_found", missing: ["ranked risk factors"] };
    }
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
