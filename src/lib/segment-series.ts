/**
 * Segment agent outputs can contain fewer periods than the company financial
 * series. Treat those values as the most recent reported periods so filtering
 * still shows the segment's available history instead of indexing it against
 * missing older periods.
 */
export function alignSegmentSeries(
  values: Array<number | null> | null | undefined,
  periodCount: number,
): Array<number | null> {
  const count = Math.max(0, periodCount);
  if (count === 0) return [];
  const source = Array.isArray(values) ? values : [];
  const aligned = source.slice(-count);
  return [...Array(Math.max(0, count - aligned.length)).fill(null), ...aligned];
}
