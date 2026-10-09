import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assessCompleteness } from "./completeness";
import { buildAgentInput } from "./analyze";
import { recoverMarketTables } from "./market-table-recovery";
import { validateMarketOutput } from "./market-validation";
import { buildMicronHistory, enrichIssuerHistory, MICRON_RELEASES, readIssuerTables } from "./issuer-history";
import fixtures from "./fixtures/micron-issuer-tables.json";
import type { RegulatoryDataSnapshot } from "../contracts/regulatory-data";

const source = readFileSync(new URL("./fixtures/micron-q3-business-units.txt", import.meta.url), "utf8");
const empty = { market: { industry: "Memory", competitors: [], geographies: [], segments: [] } };
const releases = MICRON_RELEASES.map(m => ({ ...fixtures[String(m.year) as keyof typeof fixtures], ...m }));
describe("screenshot regressions", () => {
  it("assesses earnings tables by data, including 8-K Exhibit 99.1", () => {
    expect(assessCompleteness("financials", { financials: { years: ["2025", "2026"], revenue: [37378, 133188], netIncome: [8539, 84969] } }, { jurisdiction: "us", filingType: "Form 8-K Exhibit 99.1" }).status).toBe("complete");
    expect(assessCompleteness("financials", { financials: { years: [], revenue: [], netIncome: [] } }, { jurisdiction: "us", filingType: "8-K", hasFinancialTables: true }).status).toBe("incomplete");
  });
  it("keeps the Micron heading in retrieval and binds all four real segment rows", () => {
    const text = "Micron Technology, Inc. (in millions)\n" + "front matter ".repeat(8000) + source + "\nend ".repeat(18000);
    expect(buildAgentInput("market", text)).toContain("Cloud Memory Business Unit");
    const recovered = validateMarketOutput(recoverMarketTables(empty, text), text);
    expect(recovered.market.segments).toHaveLength(4);
    expect(recovered.market.segments[0].periods).toEqual(["2025 Q3", "2026 Q2", "2026 Q3"]);
    expect(recovered.market.segments[0].revenue).toEqual([3386, 7749, 13769]);
    expect(recovered.market.segments.reduce((sum, s) => sum + s.revenue.at(-1)!, 0)).toBe(41448);
    expect(recovered.market.geographies).toEqual([]);
    expect(recovered.market.dataCoverage?.geographies).toBe("not_disclosed");
  });
  it("does not invent scale or parse incomplete columns", () => {
    expect(recoverMarketTables(empty, source.replace("Micron Technology, Inc.", "Unidentified issuer")).market.segments).toEqual([]);
    expect(recoverMarketTables(empty, source.replace("(in millions, except per share amounts)", "")).market.segments).toEqual([]);
    const incomplete = source.replace("$13,769", "unreadable");
    expect(recoverMarketTables(empty, incomplete).market.segments).toHaveLength(3);
  });
  it("recovers a real five-year GAAP cohort and preserves negative annual amounts", () => {
    const history = buildMicronHistory(releases.filter(r => [2026, 2024, 2022].includes(r.year)));
    expect(history?.years).toEqual(["FY2022", "FY2023", "FY2024", "FY2025", "FY2026"]);
    expect(history?.revenue).toEqual([30758, 15540, 25111, 37378, 133188]);
    expect(history?.netIncome[1]).toBe(-5833);
    expect(history?.capex.at(-1)).toBe(-30712);
    expect(history?.totalDebt.at(-1)).toBe(5179);
    expect(history?.status).toBe("complete");
    expect(history?.provenance).toBe("issuer_disclosure");
  });
  it("rejects mislabeled fiscal columns and records missing cells as partial", () => {
    const r = structuredClone(releases[0]);
    r.tables[0][2][0] = "FY-99";
    expect(buildMicronHistory([r])).toBeUndefined();
    expect(buildMicronHistory([releases[0]])?.status).toBe("partial");
  });
  it("uses fixed public URLs without future disclosures or other issuer identities", async () => {
    const unavailable: RegulatoryDataSnapshot = { status: "unavailable", jurisdiction: "us", provider: "sec_edgar", company: {}, metrics: [], sources: [], warnings: ["HTTP 403"], raw: {} };
    const requester = vi.fn(async (url: string) => {
      const r = releases.find(x => x.url === url)!;
      const html = `<h1>MICRON TECHNOLOGY, INC. full year of fiscal ${r.year}</h1>` + r.tables.map(t => `<table>${t.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`).join("");
      const response = new Response(html, { headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: url }); return response;
    });
    const result = await enrichIssuerHistory(unavailable, { text: "Micron Technology, Inc.", cik: "0000723125", reportingPeriod: "2026-05-28" }, requester as unknown as typeof fetch);
    expect(requester.mock.calls.map(c => c[0])).not.toContain(releases[0].url);
    expect(result.issuerHistory?.years).toEqual(["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]);
    expect(result.status).toBe("unavailable");
    expect(await enrichIssuerHistory(unavailable, { text: "Micron Technology, Inc.", cik: "320193" }, requester as unknown as typeof fetch)).toEqual(unavailable);
  });
  it("retains HTML cell boundaries for financial table parsing", () => {
    expect(readIssuerTables('<table><tr><td>Revenue</td><td>1,000</td><td>(200)</td></tr></table>')).toEqual([[["Revenue", "1,000", "(200)"]]]);
  });
});
