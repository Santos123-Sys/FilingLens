import {secProofUrl} from "./sec-peer-proof";

/**
 * Validate a USER-SUPPLIED, LOSSY transformation of SEC CompanyFacts.
 *
 * This is a fixture/reconciliation tool, NOT an official CompanyFacts decoder.
 * No accession, period-start or XBRL fp data can be reconstructed from these
 * two files. Never feed its output into sec_companyfacts_snapshots or label it
 * sec_api / operator_attested_sec_json / operator_attested_sec_bulk.
 */
const METRICS = [
 ["RevenueFromContractWithCustomerExcludingAssessedTax", "USD", "revenue"],
 ["NetIncomeLoss", "USD", "netIncome"],
 ["Assets", "USD", "assets"],
 ["Liabilities", "USD", "liabilities"],
 ["StockholdersEquity", "USD", "stockholdersEquity"],
 ["OperatingIncomeLoss", "USD", "operatingIncome"],
 ["EarningsPerShareBasic", "USD/shares", "basicEps"],
 ["EarningsPerShareDiluted", "USD/shares", "dilutedEps"],
] as const;

type JsonObject = Record<string, unknown>;
const fail = (reason: string): never => {throw new Error("sec_transformed_fixture_" + reason);};
const object = (value: unknown, reason: string): JsonObject => {
 if (!value || typeof value !== "object" || Array.isArray(value)) return fail(reason);
 return value as JsonObject;
};
const array = (value: unknown, reason: string): unknown[] =>
 Array.isArray(value) ? value : fail(reason);
const string = (value: unknown, reason: string): string =>
 typeof value === "string" && value.trim() ? value : fail(reason);
const integer = (value: unknown, reason: string): number =>
 typeof value === "number" && Number.isSafeInteger(value) ? value : fail(reason);
const numeric = (value: unknown, reason: string): number =>
 typeof value === "number" && Number.isFinite(value) ? value : fail(reason);
const date = (value: unknown, reason: string): string => {
 const s = string(value, reason);
 if (!/^20\d{2}-\d{2}-\d{2}$/.test(s) ||
     !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
     new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s) return fail(reason);
 return s;
};
const rowKey = (concept: string, unit: string, fy: number, end: string, filed: string) =>
 [concept, unit, fy, end, filed].join("|");

function metadata(value: unknown) {
 const m = object(value, "metadata_missing");
 const cik = integer(m.cik, "cik_invalid");
 const cikPadded = string(m.cik_padded, "cik_padded_missing");
 if (cik < 1 || !/^\d{10}$/.test(cikPadded) || String(cik).padStart(10, "0") !== cikPadded)
  return fail("cik_mismatch");
 const issuer = string(m.entity_name, "issuer_missing");
 const claimedSourceUrl = string(m.source_url, "source_missing");
 if (claimedSourceUrl !== secProofUrl(cikPadded)) return fail("source_url_mismatch");
 const taxonomies = array(m.taxonomies, "taxonomies_missing")
  .map(x => string(x, "taxonomy_invalid"));
 if (!taxonomies.length || new Set(taxonomies).size !== taxonomies.length ||
     taxonomies.some(x => !["dei", "us-gaap", "ifrs-full"].includes(x)))
  return fail("taxonomies_invalid");
 const conceptCounts = object(m.concept_counts_by_taxonomy, "taxonomy_counts_missing");
 const totalConcepts = integer(m.total_concepts, "total_concepts_invalid");
 if (totalConcepts < 1 || totalConcepts > 10000 ||
     Object.keys(conceptCounts).length !== taxonomies.length ||
     taxonomies.some(x => !Number.isSafeInteger(conceptCounts[x]) ||
       (conceptCounts[x] as number) < 0) ||
     taxonomies.reduce((n, x) => n + (conceptCounts[x] as number), 0) !== totalConcepts)
  return fail("taxonomy_counts_invalid");
 return {cik, cikPadded, issuer, claimedSourceUrl, taxonomies, conceptCounts, totalConcepts};
}

export function inspectSecTransformedFixture(transformedInput: unknown, keyFinancialsInput: unknown,
 expectedCik?: string) {
 const transformed = object(transformedInput, "transformed_invalid");
 const financials = object(keyFinancialsInput, "key_financials_invalid");
 const a = metadata(transformed.metadata);
 const b = metadata(financials.metadata);
 if (a.cikPadded !== b.cikPadded || a.issuer !== b.issuer ||
     a.claimedSourceUrl !== b.claimedSourceUrl ||
     JSON.stringify(a.taxonomies) !== JSON.stringify(b.taxonomies) ||
     a.totalConcepts !== b.totalConcepts ||
     a.taxonomies.some(t => a.conceptCounts[t] !== b.conceptCounts[t]))
  return fail("cross_file_metadata_mismatch");
 if (expectedCik !== undefined && expectedCik !== a.cikPadded)
  return fail("requested_cik_mismatch");

 const concepts = array(transformed.all_concepts, "concepts_missing");
 if (concepts.length !== a.totalConcepts) return fail("concept_count_mismatch");
 const conceptUnits = new Map<string, Set<string>>();
 const byTaxonomy = new Map<string, Set<string>>();
 for (const raw of concepts) {
  const c = object(raw, "concept_invalid");
  const taxonomy = string(c.taxonomy, "concept_taxonomy_missing");
  const name = string(c.concept, "concept_name_missing");
  const key = taxonomy + "|" + name;
  const units = array(c.units, "concept_units_missing")
   .map(x => string(x, "concept_unit_invalid"));
  if (!a.taxonomies.includes(taxonomy) || !units.length ||
      new Set(units).size !== units.length || conceptUnits.has(key) ||
      integer(c.data_point_count, "concept_data_point_count_invalid") < 1)
   return fail("concept_invalid_or_duplicate");
  conceptUnits.set(key, new Set(units));
  if (!byTaxonomy.has(taxonomy)) byTaxonomy.set(taxonomy, new Set());
  byTaxonomy.get(taxonomy)!.add(name);
 }
 const breakdown = object(transformed.taxonomy_breakdown, "taxonomy_breakdown_missing");
 if (Object.keys(breakdown).length !== a.taxonomies.length)
  return fail("taxonomy_breakdown_mismatch");
 for (const taxonomy of a.taxonomies) {
  const rows = array(breakdown[taxonomy], "taxonomy_breakdown_missing");
  const names = rows.map(raw => string(object(raw, "breakdown_concept_invalid").concept,
   "breakdown_concept_missing"));
  if (rows.length !== a.conceptCounts[taxonomy] ||
      new Set(names).size !== names.length ||
      names.some(name => !byTaxonomy.get(taxonomy)?.has(name)))
   return fail("taxonomy_breakdown_mismatch");
 }

 const samples = array(transformed.sample_facts, "sample_facts_missing");
 if (!samples.length || samples.length > 2000) return fail("sample_facts_invalid_length");
 const sampleValues = new Map<string, number>();
 for (const raw of samples) {
  const s = object(raw, "sample_invalid");
  const concept = string(s.concept, "sample_concept_missing");
  const unit = string(s.unit, "sample_unit_missing");
  const fy = integer(s.fiscal_year, "sample_fy_invalid");
  const end = date(s.period_end, "sample_period_end_invalid");
  const filed = date(s.filed_date, "sample_filed_date_invalid");
  const value = numeric(s.value, "sample_value_invalid");
  if (!conceptUnits.get("us-gaap|" + concept)?.has(unit) ||
      !["10-K", "10-K/A", "20-F", "20-F/A"].includes(s.form as string) ||
      fy < Number(end.slice(0, 4)) || fy > Number(end.slice(0, 4)) + 2 ||
      filed < end) return fail("sample_identity_or_period_invalid");
  const key = rowKey(concept, unit, fy, end, filed);
  if (sampleValues.has(key)) return fail("duplicate_sample_observation");
  sampleValues.set(key, value);
 }

 const keyFacts = object(financials.key_annual_facts, "key_annual_facts_missing");
 if (Object.keys(keyFacts).length !== METRICS.length ||
     METRICS.some(([concept]) => !(concept in keyFacts)))
  return fail("key_metric_set_mismatch");
 const reconciled = new Set<string>();
 const allPeriods = new Set<string>();
 let totalObservations = 0;
 let comparativeDuplicates = 0;
 const metrics = METRICS.map(([concept, unit, metric]) => {
  const entry = object(keyFacts[concept], "key_metric_invalid");
  string(entry.label, "key_metric_label_missing");
  const units = object(entry.data, "key_metric_units_missing");
  if (Object.keys(units).length !== 1 || !(unit in units) ||
      !conceptUnits.get("us-gaap|" + concept)?.has(unit))
   return fail("key_metric_unit_mismatch");
  const rows = array(units[unit], "key_metric_rows_missing");
  if (!rows.length || rows.length > 200) return fail("key_metric_rows_invalid");
  const periods = new Map<string, {value: number; filings: Set<string>}>();
  for (const raw of rows) {
   const r = object(raw, "key_metric_row_invalid");
   const fy = integer(r.fy, "key_metric_fy_invalid");
   const end = date(r.end, "key_metric_period_end_invalid");
   const filed = date(r.filed, "key_metric_filed_invalid");
   const value = numeric(r.val, "key_metric_value_invalid");
   const key = rowKey(concept, unit, fy, end, filed);
   if (!sampleValues.has(key)) return fail("unmatched_sample_observations");
   if (sampleValues.get(key) !== value || reconciled.has(key))
    return fail("key_sample_numeric_mismatch");
   reconciled.add(key);
   if (fy < Number(end.slice(0, 4)) || fy > Number(end.slice(0, 4)) + 2 ||
       filed < end) return fail("key_metric_period_invalid");
   const previous = periods.get(end);
   // Restated or inconsistent comparative values must not be silently selected.
   if (previous && previous.value !== value) return fail("conflicting_comparative_values");
   if (previous) {
    previous.filings.add(filed);
    comparativeDuplicates++;
   } else periods.set(end, {value, filings: new Set([filed])});
   allPeriods.add(end);
   totalObservations++;
  }
  return {metric, concept, unit, observations: rows.length,
   periods: [...periods].sort(([a], [b]) => a.localeCompare(b))
    .map(([periodEnd, info]) => ({
     fiscalYear: Number(periodEnd.slice(0, 4)),
     periodEnd, value: info.value, filedDates: [...info.filings].sort(),
    }))};
 });
 if (reconciled.size !== sampleValues.size) return fail("unmatched_sample_observations");
 const fiscalYears = [...new Set([...allPeriods].map(x => Number(x.slice(0, 4))))]
  .sort((a, b) => a - b);
 const lastYear = fiscalYears[fiscalYears.length - 1];
 const requestedFiveYears = Array.from({length: 5}, (_, i) => lastYear - 4 + i);
 const missingFiscalYears = requestedFiveYears.filter(y => !fiscalYears.includes(y));

 // Reconcile the balance sheet using fiscal period-end, not the comparative fy.
 const balanceSheetChecks = [...allPeriods].sort().map(periodEnd => {
  const amount = (name: string) => metrics.find(x => x.metric === name)?.periods
   .find(x => x.periodEnd === periodEnd)?.value;
  const assets = amount("assets"), liabilities = amount("liabilities");
  const equity = amount("stockholdersEquity");
  if (assets === undefined || liabilities === undefined || equity === undefined)
   return fail("balance_sheet_period_missing");
  const difference = assets - liabilities - equity;
  const tolerance = Math.max(1, Math.abs(assets) * 0.00001);
  if (Math.abs(difference) > tolerance) return fail("balance_sheet_does_not_reconcile");
  return {periodEnd, difference, reconciled: true};
 });
 return {
  kind: "sec_transformed_validation_fixture" as const,
  sourceMode: "unverified_user_transformed_fixture" as const,
  fixtureOnly: true as const,
  eligibleForProduction: false as const,
  productionCacheWrites: false as const,
  issuer: {cik: a.cikPadded, name: a.issuer, claimedSourceUrl: a.claimedSourceUrl},
  coverage: {conceptCount: a.totalConcepts, sampleObservations: samples.length,
   keyMetricCount: metrics.length, keyObservations: totalObservations,
   comparativeDuplicates, uniqueFiscalPeriodEnds: [...allPeriods].sort(),
   fiscalYears, requestedFiveYears, missingFiscalYears},
  balanceSheetChecks, metrics,
  proofGate: {status: "blocked" as const,
   reason: "Transformed files omit SEC accession, annual period start and XBRL fp; SEC origin is not independently authenticated."},
 };
}
