import { describe, expect, it } from "vitest";
import { forecastObservationState } from "./forecast-observation-state";
describe("observable evidence versus future accuracy", () => {
  it("distinguishes unelapsed years, missing disclosures and completed scores without qualifying accuracy", () => {
    expect(forecastObservationState(2026, "2026-10-18", 0, 91).label).toBe(
      "Reporting year not complete"
    );
    expect(forecastObservationState(2026, "2026-12-31", 0, 91).label).toBe(
      "Reporting year not complete"
    );
    expect(forecastObservationState(2026, "2027-01-01", 0, 91).label).toBe(
      "Annual disclosures pending"
    );
    expect(forecastObservationState(2026, "2027-05-01", 91, 0).label).toBe(
      "Scored; validation decision pending"
    );
    expect(forecastObservationState(2026, "2027-05-01", 0, 0).label).toBe(
      "No eligible scored outcomes"
    );
  });
});
