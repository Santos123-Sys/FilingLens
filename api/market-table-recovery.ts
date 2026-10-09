import type { MarketResult } from "../contracts/analysis";

/** Read explicitly labeled business-unit revenue rows before asking a model to fill gaps. */
export function recoverMarketTables(input: MarketResult, text: string): MarketResult {
  const market = { ...input.market };
  const heading = /Quarterly Business Unit Financial Results/i.exec(text);
  if (heading) {
    const section = text.slice(heading.index, heading.index + 10_000).split(/Business Outlook|Product highlights/i)[0];
    const header = section.slice(0, section.search(/\n[^\n]*Business Unit/i));
    const periods = [...header.matchAll(/FQ([1-4])[- ](\d{2})/g)].map(m => `20${m[2]} Q${m[1]}`);
    const unitDisclosed = /in millions/i.test(text.slice(0, heading.index));
    const currency = /\bUSD\b|US\$/i.test(text) ? "USD" : /\bBRL\b|R\$/i.test(text) ? "BRL" : /Micron Technology,? Inc\./i.test(text) ? "USD" : null;
    if (periods.length >= 2 && periods.length <= 5 && new Set(periods).size === periods.length && unitDisclosed && currency) {
      const order = periods.map((period, index) => ({ period, index })).sort((a, b) => a.period.localeCompare(b.period));
      const recovered = [...section.matchAll(/([^\n]+Business Unit)\s*\n(Revenue[^\n]+)/g)].flatMap(match => {
        const values = [...match[2].matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1].replaceAll(",", "")));
        if (values.length !== periods.length || values.some(v => !Number.isFinite(v))) return [];
        return [{ name: match[1].trim(), revenue: order.map(p => values[p.index]), earnings: null,
          periods: order.map(p => p.period), unit: "millions", currency, sourceType: "filing" as const,
          source: { section: "Quarterly Business Unit Financial Results", kind: "excerpt" as const, quote: match[0] } }];
      });
      const names = new Set(recovered.map(s => s.name.toLowerCase()));
      // Exact table values replace the same model-proposed row, never duplicate it.
      market.segments = [...market.segments.filter(s => !names.has(s.name.toLowerCase())), ...recovered].slice(0, 12);
    }
  }
  const segmentHeading = /business unit financial results|segment information|operating segments|reportable segments|receita.{0,30}segmento/i.test(text);
  const geographyHeading = /geographic (?:revenue|information)|revenue by (?:country|geograph)|receita.{0,30}geogr/i.test(text);
  market.dataCoverage = {
    segments: market.segments.length ? "captured" : segmentHeading ? "extraction_gap" : "not_disclosed",
    geographies: market.geographies.length ? "captured" : geographyHeading ? "extraction_gap" : "not_disclosed",
    notes: [
      ...(market.segments.length ? [] : [segmentHeading ? "A segment heading was found, but no source-bound numeric series was recovered. Review the table or upload a clearer PDF." : "No segment table was identified in the supplied filing. Add the annual report or segment note to the document bundle."]),
      ...(market.geographies.length ? [] : [geographyHeading ? "A geographic heading was found, but its numeric series could not be bound. Review the table or upload the geographic note." : "No geographic revenue table was identified in this filing. Add the annual report's geographic revenue note; peer locations are not issuer revenue geography."]),
    ],
  };
  return { market };
}
