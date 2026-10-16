import { expect, it } from "vitest";
import { prepareDcf } from "../api/valuation/dcf";
import { valuationFixture } from "../api/fixtures/valuation-case";
import { reviewableDcfAssumptions } from "./revenue-proposal-policy";

it("clears old unreviewed automatic growth on load/restore, preserving reviewed scenarios and source records", () => {
  const old = prepareDcf(valuationFixture()).assumptions;
  const growth = old.find(r => r.id === "dcf.revenue_growth_y1")!;
  growth.proposed_value = 20;
  const accepted = {
    ...growth,
    id: "dcf.revenue_growth_y2",
    status: "accepted" as const,
    final_value: 12,
  };
  const edited = {
    ...growth,
    id: "dcf.revenue_growth_y3",
    status: "edited" as const,
    final_value: 8,
  };
  const mapped = reviewableDcfAssumptions([growth, accepted, edited, old[0]]);
  expect(mapped[0].proposed_value).toBeNull();
  expect(mapped[0].rationale).toContain(
    "Source cutoff and error band unavailable"
  );
  expect(mapped[1]).toBe(accepted);
  expect(mapped[2]).toBe(edited);
  expect(mapped[3]).toBe(old[0]);
  expect(growth.proposed_value).toBe(20);
});
