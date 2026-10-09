import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {inspectSecTransformedFixture} from "./sec-transformed-fixture";
import {prepareSecOperatorJson} from "./sec-operator-json";

// User-supplied, transformed extracts. They are NOT the official SEC JSON.
// Preserve the original two-file format to detect future importer regressions.
const transformed = JSON.parse(readFileSync(new URL(
 "../tests/fixtures/sec/apple_sec_companyfacts_transformed.json", import.meta.url), "utf8"));
const financials = JSON.parse(readFileSync(new URL(
 "../tests/fixtures/sec/apple_sec_key_financials.json", import.meta.url), "utf8"));
const inspect = (a: unknown = transformed, b: unknown = financials) =>
 inspectSecTransformedFixture(a, b, "0000320193");

describe("Apple transformed SEC fixtures (unverified; never production cache)", () => {
 it("reconciles all 505 concepts and all 40 cross-file financial observations", () => {
  const report = inspect();
  expect(report.kind).toBe("sec_transformed_validation_fixture");
  expect(report.sourceMode).toBe("unverified_user_transformed_fixture");
  expect(report.fixtureOnly).toBe(true);
  expect(report.eligibleForProduction).toBe(false);
  expect(report.productionCacheWrites).toBe(false);
  expect(report.proofGate.status).toBe("blocked");
  expect(report.coverage).toMatchObject({
   conceptCount: 505, sampleObservations: 40, keyMetricCount: 8,
   keyObservations: 40, comparativeDuplicates: 16,
   fiscalYears: [2023, 2024, 2025], requestedFiveYears: [2021, 2022, 2023, 2024, 2025],
   missingFiscalYears: [2021, 2022],
   uniqueFiscalPeriodEnds: ["2023-09-30", "2024-09-28", "2025-09-27"],
  });
  expect(report.balanceSheetChecks).toHaveLength(3);
  expect(report.balanceSheetChecks.every(x => x.reconciled && x.difference === 0)).toBe(true);
  const revenue = report.metrics.find(x => x.metric === "revenue");
  expect(revenue?.periods.map(x => x.value)).toEqual([
   383285000000, 391035000000, 416161000000,
  ]);
  const dilutedEps = report.metrics.find(x => x.metric === "dilutedEps");
  expect(dilutedEps?.unit).toBe("USD/shares");
  expect(dilutedEps?.periods.map(x => x.value)).toEqual([6.13, 6.08, 7.46]);
 });
 it("does not turn comparative FY2025 observations for FY2023 into FY2025 earnings", () => {
  const revenue = inspect().metrics.find(x => x.metric === "revenue");
  expect(revenue?.periods).toHaveLength(3);
  expect(revenue?.periods[0]).toMatchObject({
   fiscalYear: 2023, periodEnd: "2023-09-30", value: 383285000000,
   filedDates: ["2024-11-01", "2025-10-31"],
  });
 });
 it("rejects altered values or a missing sample across the two uploaded files", () => {
  const changed = structuredClone(financials);
  changed.key_annual_facts.NetIncomeLoss.data.USD[0].val += 1;
  expect(() => inspect(transformed, changed)).toThrow(/key_sample_numeric_mismatch/);
  const removed = structuredClone(transformed);
  removed.sample_facts.pop();
  expect(() => inspect(removed, financials)).toThrow(/unmatched_sample_observations/);
 });
 it("rejects CIK mismatch, spoofed source URL and tampered concept inventories", () => {
  const wrongCik = structuredClone(financials);
  wrongCik.metadata.cik = 789019;
  expect(() => inspect(transformed, wrongCik)).toThrow();
  const spoofed = structuredClone(transformed);
  spoofed.metadata.source_url = "https://example.org/apple.json";
  expect(() => inspect(spoofed, financials)).toThrow(/source_url_mismatch/);
  const truncated = structuredClone(transformed);
  truncated.all_concepts.pop();
  expect(() => inspect(truncated, financials)).toThrow(/concept_count_mismatch/);
 });
 it("rejects conflicting comparative amounts instead of silently choosing a filing", () => {
  const changed = structuredClone(financials);
  const samples = structuredClone(transformed);
  changed.key_annual_facts.Assets.data.USD[1].val += 1_000_000;
  const sample = samples.sample_facts.find((x: {concept: string; fiscal_year: number; period_end: string}) =>
   x.concept === "Assets" && x.fiscal_year === 2024 && x.period_end === "2023-09-30");
  sample.value += 1_000_000;
  expect(() => inspect(samples, changed)).toThrow(/conflicting_comparative_values/);
 });
 it("refuses to pass transformed metadata into the official CompanyFacts import", () => {
  expect(() => prepareSecOperatorJson("0000320193",
   Buffer.from(JSON.stringify(transformed)), "2026-10-09",
   Date.parse("2026-10-09T12:00:00Z"))).toThrow(/sec_member_issuer_identity_or_taxonomy_mismatch/);
  expect(() => prepareSecOperatorJson("0000320193",
   Buffer.from(JSON.stringify(financials)), "2026-10-09",
   Date.parse("2026-10-09T12:00:00Z"))).toThrow(/sec_member_issuer_identity_or_taxonomy_mismatch/);
 });
});
