import type { FilingAnalysis } from "../../contracts/analysis";

const annualYear = (label: string) => /^(?:FY\s*)?(20\d{2})$/i.exec(label.trim())?.[1] ?? null;
export function moneyBasis(unit: string): { currency: string; toMillions: number } | null {
  const text = unit.toLowerCase();
  const currency = /\b(USD|BRL|EUR|GBP|CHF)\b/i.exec(unit)?.[1].toUpperCase()
    ?? (/us\$/.test(text) ? "USD" : /r\$/.test(text) ? "BRL" : null);
  if (!currency) return null;
  const toMillions = /billion|bilh[aã]o|bilh[oõ]es/.test(text) ? 1000
    : /million|milh[aã]o|milh[oõ]es/.test(text) ? 1
      : /thousand|milhar|milhares/.test(text) ? 0.001
        : /^(usd|brl|eur|gbp|chf|us\$|r\$)$/i.test(unit.trim()) ? 0.000001 : null;
  return toMillions === null ? null : { currency, toMillions };
}

/** Annual cohorts only. Quarter/YTD values are never annualized automatically. */
export function annualBasis(a: FilingAnalysis) {
  const f = a.financials;
  const annualForm = /10-K|20-F|DFP|annual|full.year/i.test(a.company.filingType);
  const indices = f.years.map((label, index) => ({ year: annualForm || /^FY\s*20\d{2}$/i.test(label.trim()) ? annualYear(label) : null, index })).filter(p => p.year !== null);
  if (new Set(indices.map(i => i.year)).size !== indices.length) return null;
  const sorted = indices.sort((a, b) => Number(a.year) - Number(b.year));
  const anchor = sorted.at(-1);
  if (!anchor) {
    const history = f.annualHistory;
    if (!history || !["issuer_disclosure", "regulatory_api", "reconciled"].includes(history.provenance ?? "")) return null;
    const candidates = history.years.map((label, index) => ({ year: annualYear(label), index })).filter(p => p.year !== null);
    if (new Set(candidates.map(p => p.year)).size !== candidates.length) return null;
    const selected = candidates.sort((a, b) => Number(a.year) - Number(b.year)).at(-1);
    const basis = moneyBasis(history.unit);
    if (!selected || !basis || basis.currency !== moneyBasis(f.unit)?.currency) return null;
    return { period: `FY${selected.year}`, periodEnd: history.periodEndDates?.[selected.index] ?? null, currency: basis.currency, fromHistory: true,
      value(key: string): number | null {
        const series = history[key as keyof typeof history];
        const n = Array.isArray(series) && series.length === history.years.length ? series[selected.index] : null;
        return typeof n === "number" && Number.isFinite(n) ? n * basis.toMillions : null;
      }, growth: null as number | null };
  }
  const basis = moneyBasis(f.unit);
  if (!basis) return null;
  const valueAt = (key: string, index: number): number | null => {
    const series = f[key as keyof typeof f];
    const n = Array.isArray(series) && series.length === f.years.length ? series[index] : null;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const prior = sorted.at(-2), revenue = valueAt("revenue", anchor.index);
  const before = prior && Number(anchor.year) - Number(prior.year) === 1 ? valueAt("revenue", prior.index) : null;
  return { period: `FY${anchor.year}`, periodEnd: f.periodEndDates?.[anchor.index] ?? (/^20\d{2}-\d{2}-\d{2}$/.test(a.company.periodEnd) && a.company.periodEnd.startsWith(anchor.year!) ? a.company.periodEnd : null), currency: basis.currency, fromHistory: false,
    value(key: string) {
      const n = valueAt(key, anchor.index);
      return n === null ? null : n * (key === "eps" || /Margin$/.test(key) ? 1 : basis.toMillions);
    }, growth: revenue !== null && before !== null && before > 0 ? (revenue / before - 1) * 100 : null };
}
