import { describe, expect, it } from "vitest";
import { alignSegmentSeries } from "../src/lib/segment-series";

describe("alignSegmentSeries", () => {
  it("right-aligns shorter segment history to the latest company periods", () => {
    expect(alignSegmentSeries([10, 20], 4)).toEqual([null, null, 10, 20]);
  });

  it("keeps the most recent values when the segment series is longer", () => {
    expect(alignSegmentSeries([10, 20, 30], 2)).toEqual([20, 30]);
  });

  it("returns an empty series when there are no dashboard periods", () => {
    expect(alignSegmentSeries([10, 20], 0)).toEqual([]);
  });
});
