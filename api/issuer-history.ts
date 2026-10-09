import { createHash } from "node:crypto";
import type { FinancialsResult } from "../contracts/analysis";
import type { RegulatoryDataSnapshot } from "../contracts/regulatory-data";

type AnnualHistory = NonNullable<FinancialsResult["financials"]["annualHistory"]>;
type Table = string[][];
export const MICRON_RELEASES = [
  { year: 2026, released: "2026-09-30", url: "https://micron.gcs-web.com/node/50991" },
  { year: 2025, released: "2025-09-23", url: "https://micron.gcs-web.com/node/49371" },
  { year: 2024, released: "2024-09-25", url: "https://micron.gcs-web.com/node/47831" },
  { year: 2023, released: "2023-09-27", url: "https://micron.gcs-web.com/node/45791" },
  { year: 2022, released: "2022-09-29", url: "https://micron.gcs-web.com/node/43991" },
] as const;
type Release = { year: number; released: string; url: string; tables: Table[]; sha256: string };
const KEYS = ["revenue", "grossProfit", "ebit", "netIncome", "operatingCashFlow", "capex", "totalAssets", "totalLiabilities", "totalEquity", "totalDebt", "cash"] as const;

const plain = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ")
  .replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8212;|&mdash;/g, "—")
  .replace(/\s+/g, " ").trim();
/** Fixed issuer HTML only. Retain table/cell boundaries instead of guessing flattened columns. */
export function readIssuerTables(html: string): Table[] {
  return [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(table =>
    [...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plain(cell[1]))));
}
function values(row: string[]): number[] {
  return [...row.slice(1).join(" ").matchAll(/\(?\s*-?\d[\d,]*(?:\.\d+)?\s*\)?|—/g)].map(m => {
    const raw = m[0].trim();
    return raw === "—" ? 0 : Number(raw.replace(/[(),\s]/g, "")) * (raw.startsWith("(") ? -1 : 1);
  });
}
const rowValues = (table: Table | undefined, label: RegExp) => {
  const rows = table?.filter(row => label.test(row[0] ?? "")) ?? [];
  return rows.length === 1 ? values(rows[0]) : [];
};

/** Five annual years, GAAP columns only; issuer disclosures remain distinct from SEC proof. */
export function buildMicronHistory(releases: Release[]): AnnualHistory | undefined {
  const eligible = releases.filter(r => MICRON_RELEASES.some(m => m.url === r.url && m.year === r.year));
  if (!eligible.length) return undefined;
  const anchor = Math.max(...eligible.map(r => r.year));
  const years = Array.from({ length: 5 }, (_, i) => anchor - 4 + i);
  const periodEnds = new Map<number, string>();
  const byYear = new Map<number, Partial<Record<typeof KEYS[number], number>>>();
  const sources: AnnualHistory["sources"] = [];
  for (const release of [...eligible].sort((a, b) => b.year - a.year)) {
    const summary = release.tables.find(t => /Annual Financial Results/i.test(t[0]?.join(" ") ?? ""));
    if (!summary || !/GAAP/.test(summary.flat().join(" ")) || !/in millions/i.test(summary.flat().join(" "))) continue;
    const labels = summary.find(row => /FY[- ]\d{2}/.test(row.join(" ")));
    const fy = labels?.join(" ").match(/FY[- ](\d{2})/g)?.slice(0, 2).map(v => 2000 + Number(v.slice(-2)));
    if (fy?.[0] !== release.year || fy[1] !== release.year - 1) continue;
    const balance = release.tables.find(t => /^As of$/i.test(t[0]?.[0] ?? "") || t.some(row => /CONSOLIDATED BALANCE SHEETS/.test(row.join(" "))));
    const cashflow = release.tables.find(t => t.some(row => /^For the year ended$/i.test(row[0] ?? "")));
    const flowYears = cashflow?.find(row => /^For the year ended$/i.test(row[0] ?? ""))?.slice(1).map(v => Number(v.match(/20\d{2}$/)?.[0]));
    const balanceYears = balance?.find(row => /^As of$/i.test(row[0] ?? ""))?.slice(1).map(v => Number(v.match(/20\d{2}$/)?.[0]));
    const annualRows = {
      revenue: rowValues(summary, /^Revenue$/i), grossProfit: rowValues(summary, /^Gross margin$/i),
      ebit: rowValues(summary, /^Operating income(?: \(loss\))?$/i), netIncome: rowValues(summary, /^Net income(?: \(loss\))?$/i),
    };
    for (let i = 0; i < 2; i++) {
      const year = fy[i];
      if (!years.includes(year)) continue;
      const point: Partial<Record<typeof KEYS[number], number>> = {};
      for (const [key, series] of Object.entries(annualRows)) if (series.length === 4) point[key as keyof typeof point] = series[i];
      if (flowYears?.length === 2 && flowYears[0] === release.year && flowYears[1] === release.year - 1) {
        for (const [key, pattern] of [["operatingCashFlow", /^Net cash provided by operating activities$/i], ["capex", /^Expenditures for property, plant, and equipment$/i]] as const) {
          const series = rowValues(cashflow, pattern);
          if (series.length === 2) point[key] = series[i];
        }
      }
      const endLabel = cashflow?.find(row => /^For the year ended$/i.test(row[0] ?? ""))?.[i + 1];
      if (endLabel && !Number.isNaN(Date.parse(endLabel)) && !periodEnds.has(year)) periodEnds.set(year, new Date(endLabel).toISOString().slice(0, 10));
      const bi = balanceYears?.findIndex(y => y === year && (i === 0 ? y === balanceYears[0] : y === balanceYears.at(-1))) ?? -1;
      if (bi >= 0) {
        for (const [key, pattern] of [["totalAssets", /^Total assets$/i], ["totalLiabilities", /^Total liabilities$/i], ["totalEquity", /^Total equity$/i], ["cash", /^Cash and equivalents$/i]] as const) {
          const series = rowValues(balance, pattern);
          if (series.length === balanceYears?.length) point[key] = series[bi];
        }
        const current = rowValues(balance, /^Current debt$/i), long = rowValues(balance, /^Long-term debt$/i);
        if (current.length === balanceYears?.length && long.length === current.length) point.totalDebt = current[bi] + long[bi];
      }
      // Most recent publication wins, with the publication retained in the source inventory.
      byYear.set(year, { ...point, ...byYear.get(year) });
    }
    sources.push({ section: `Micron GAAP annual statements; SHA-256 ${release.sha256}`, kind: "citation",
      url: release.url, publisher: "Micron investor relations (issuer disclosure)", accessed: release.released, item: `FY${release.year}/FY${release.year - 1}` });
  }
  if (!byYear.size) return undefined;
  const data = Object.fromEntries(KEYS.map(key => [key, years.map(y => byYear.get(y)?.[key] ?? null)])) as Record<typeof KEYS[number], (number | null)[]>;
  return { years: years.map(y => `FY${y}`), periodEndDates: years.map(y => periodEnds.get(y) ?? null), unit: "USD millions", provider: "Micron issuer-published GAAP statements (unaudited)",
    provenance: "issuer_disclosure", status: Object.values(data).every(series => series.every(v => v !== null)) ? "complete" : "partial", ...data, sources };
}

const cache = new Map<string, { expires: number; release: Release }>();
async function fetchRelease(manifest: typeof MICRON_RELEASES[number], requester: typeof fetch): Promise<Release | null> {
  const saved = cache.get(manifest.url);
  if (saved && saved.expires > Date.now()) return saved.release;
  try {
    const response = await requester(manifest.url, { redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok || response.url !== manifest.url || !response.headers.get("content-type")?.includes("text/html") || !response.body) return null;
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 1_000_000) { await reader.cancel(); return null; } chunks.push(part.value);
    } } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks), html = bytes.toString("utf8");
    if (!/MICRON TECHNOLOGY, INC\./i.test(html) || !/full year of fiscal|full.year 2026/i.test(plain(html))) return null;
    const release = { ...manifest, tables: readIssuerTables(html), sha256: createHash("sha256").update(bytes).digest("hex") };
    cache.set(manifest.url, { expires: Date.now() + 3_600_000, release }); return release;
  } catch { return null; }
}
export async function enrichIssuerHistory(snapshot: RegulatoryDataSnapshot, context: {
  text: string; cik: string | null; reportingPeriod?: string; filedAt?: string;
}, requester: typeof fetch = fetch): Promise<RegulatoryDataSnapshot> {
  if (snapshot.jurisdiction !== "us" || (snapshot.status === "complete" && (snapshot.coverageYears?.length ?? 0) >= 5)) return snapshot;
  const cik = context.cik?.replace(/^0+/, "");
  if (cik && cik !== "723125") return snapshot;
  if (!cik && !/Micron Technology,? Inc\./i.test(context.text)) return snapshot;
  const today = new Date().toISOString().slice(0, 10);
  const dates = [today, context.filedAt, context.reportingPeriod].filter((v): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v)));
  const cutoff = dates.sort()[0];
  const available = MICRON_RELEASES.filter(m => m.released <= cutoff);
  const manifests = available.filter((_, i) => i === 0 || i === 2 || i === Math.min(4, available.length - 1));
  const releases = (await Promise.all(manifests.map(m => fetchRelease(m, requester)))).filter((r): r is Release => r !== null);
  const issuerHistory = buildMicronHistory(releases);
  return issuerHistory ? { ...snapshot, issuerHistory, warnings: [
    `SEC access remains ${snapshot.status}; separately labeled Micron issuer disclosures recovered ${issuerHistory.years.length} annual slots (${issuerHistory.status}).`, ...snapshot.warnings,
  ] } : snapshot;
}
