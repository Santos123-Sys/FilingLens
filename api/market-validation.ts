import type { MarketResult } from "../contracts/analysis";
import { buildSegmentIntelligence } from "../contracts/segment-intelligence";

function parsePeriod(period: string): { year: number; quarter: number | null } | null {
  const value = period.trim();
  const yearFirst = /^(?:FY\s*)?(\d{4})\s*[- ]?\s*[Qq]([1-4])$/i.exec(value);
  const quarterFirst = /^[Qq]([1-4])\s+(\d{4})$/i.exec(value);
  if (yearFirst) return { year: Number(yearFirst[1]), quarter: Number(yearFirst[2]) };
  if (quarterFirst) return { year: Number(quarterFirst[2]), quarter: Number(quarterFirst[1]) };
  const annual = /^(?:FY\s*)?(\d{4})$/i.exec(value);
  return annual ? { year: Number(annual[1]), quarter: null } : null;
}

function comparablePairs(periods: string[]) {
  const parsed = periods.map(parsePeriod);
  const pairs: Array<{ current: number; previous: number; comparison: "YoY" | "QoQ" }> = [];
  for (let current = 0; current < periods.length; current++) {
    const now = parsed[current];
    if (!now) continue;
    const previousSamePeriod = parsed.findIndex((before, index) => index < current
      && before?.quarter === now.quarter && before.year === now.year - 1);
    if (previousSamePeriod >= 0) pairs.push({ current, previous: previousSamePeriod, comparison: "YoY" });
    if (now.quarter !== null && current > 0) {
      const before = parsed[current - 1];
      if (before?.quarter !== null && before?.quarter !== undefined && (
        (before.year === now.year && before.quarter === now.quarter - 1)
        || (before.year === now.year - 1 && before.quarter === 4 && now.quarter === 1)
      )) pairs.push({ current, previous: current - 1, comparison: "QoQ" });
    }
  }
  return pairs;
}

function pctChange(now: number, before: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  const change = (now - before) / Math.abs(before) * 100;
  return Number.isFinite(change) ? Number(change.toFixed(2)) : null;
}

/** Filing-first market binding; external peers are added only by the verified search lane. */
export function validateMarketOutput(input: MarketResult, filingExcerpt?: string): MarketResult {
  const normalizeQuote = (text: string) => text.replace(/\s+/g, " ").trim();
  const sourceText = filingExcerpt === undefined ? undefined : normalizeQuote(filingExcerpt);
  const quoteExists = (quote?: string | null) => Boolean(quote?.trim())
    && (sourceText === undefined || sourceText.includes(normalizeQuote(quote ?? "")));
  const market = input.market;
  const flags = [...(market.validationFlags ?? [])];
  const peerEvidence = market.peerEvidence ?? [];
  const verifiedPeers = peerEvidence.filter(peer =>
    peer.sourceType === "filing"
    && Boolean(peer.source.section.trim())
    && quoteExists(peer.source.quote),
  );
  const peersByName = new Set(verifiedPeers.map(peer => peer.name.trim().toLowerCase()));
  const competitors = market.competitors.filter(name => peersByName.has(name.trim().toLowerCase()));
  const droppedPeers = market.competitors.length - competitors.length;
  if (droppedPeers) flags.push({
    code: "UNVERIFIED_PEERS_DROPPED",
    note: `${droppedPeers} peer name(s) were omitted because the quote was missing or did not resolve in the supplied filing excerpt.`,
  });

  const validatedSeries = <T extends { sourceType?: "filing" | "external"; source?: { section: string; quote?: string | null } | null }>(
    series: T[],
    kind: string,
  ) => {
    const valid = series.filter(item => item.sourceType === "filing" && Boolean(item.source?.section.trim()) && quoteExists(item.source?.quote));
    const removed = series.length - valid.length;
    if (removed) flags.push({
      code: `UNVERIFIED_${kind.toUpperCase()}_DROPPED`,
      note: `${removed} ${kind} item(s) were omitted because the source quote was missing or did not resolve in the supplied filing excerpt.`,
    });
    return valid.map(item => ({ ...item, sourceType: "filing" as const }));
  };

  const geographies = validatedSeries(market.geographies, "geography");
  const segments = validatedSeries(market.segments, "segment");
  // Deterministic, non-AI Phase 2 source and comparability audit.
  const segmentAudit = buildSegmentIntelligence({ ...market, segments });
  flags.push(...segmentAudit.flags.map(flag => ({
    code: `SEGMENT_${flag.code}`,
    note: `${flag.segment}: ${flag.detail}`,
  })));

  const insights: NonNullable<typeof market.insights> = [];
  const series = [
    ...segments.flatMap(item => [
      { dimension: "segment" as const, metric: "revenue" as const, name: item.name, values: item.revenue, periods: item.periods, source: item.source },
      ...(item.earnings ? [{ dimension: "segment" as const, metric: "earnings" as const, name: item.name, values: item.earnings, periods: item.periods, source: item.source }] : []),
    ]),
    ...geographies.map(item => ({ dimension: "geography" as const, metric: "revenue" as const, name: item.name, values: item.values, periods: item.periods, source: item.source })),
  ];
  for (const item of series) {
    if (!item.periods || item.periods.length !== item.values.length || !item.source) continue;
    for (const pair of comparablePairs(item.periods)) {
      const changePercent = pctChange(item.values[pair.current], item.values[pair.previous]);
      if (changePercent === null) continue;
      insights.push({
        dimension: item.dimension,
        metric: item.metric,
        name: item.name,
        period: item.periods[pair.current],
        comparisonPeriod: item.periods[pair.previous],
        comparison: pair.comparison,
        changePercent,
        sourceType: "filing",
        source: item.source,
      });
    }
  }

  return {
    market: {
      ...market,
      competitors,
      peerEvidence: verifiedPeers.filter(peer => peersByName.has(peer.name.trim().toLowerCase())),
      geographies,
      segments,
      insights: insights.slice(-12),
      validationFlags: flags,
    },
  };
}
