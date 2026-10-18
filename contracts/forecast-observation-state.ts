/** Calendar-year outcome availability, not a precision or accuracy qualification. */
export function forecastObservationState(
  targetYear: number,
  asOf: string,
  scored: number,
  pending: number
) {
  const periodEnd = `${targetYear}-12-31`;
  if (asOf <= periodEnd)
    return {
      periodEnd,
      label: "Reporting year not complete",
      nextAction:
        "Wait for year-end and a qualifying annual disclosure; do not substitute quarterly data.",
    };
  if (pending > 0)
    return {
      periodEnd,
      label: "Annual disclosures pending",
      nextAction:
        "Acquire retained annual filing vintages, verify publication dates and score the fixed cohort.",
    };
  return {
    periodEnd,
    label:
      scored > 0
        ? "Scored; validation decision pending"
        : "No eligible scored outcomes",
    nextAction:
      "Inspect errors, exclusions and coverage. Scoring alone does not qualify forecast accuracy.",
  };
}
