import { useState } from "react";
import { calculateFiveYearScenario } from "@contracts/five-year-scenario";
import type {
  FiveYearPlanningContext,
  FiveYearScenario,
} from "@contracts/five-year-scenario";
import { fiveYearPath } from "@contracts/five-year-forecast";
import type { FiveYearPlan } from "@contracts/five-year-forecast";
import {
  horizonReliability,
  usablePlanningBand,
} from "@contracts/forecast-reliability";

const fmt = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });
export default function FiveYearScenarioEditor({
  context,
  history,
  modelPlan,
  initialSourceUrl = "",
  onApply,
  disabled = false,
}: {
  context: FiveYearPlanningContext;
  history?: number[];
  modelPlan?: FiveYearPlan;
  initialSourceUrl?: string;
  onApply?: (input: FiveYearScenario) => void;
  disabled?: boolean;
}) {
  const [rates, setRates] = useState(() =>
    context.growthPercent.map(v => (v === null ? "" : String(v)))
  );
  const [note, setNote] = useState(
    modelPlan
      ? "Bounded, damped historical revenue path; review company drivers and exceptional events before use."
      : ""
  );
  const [source, setSource] = useState(initialSourceUrl),
    [reviewed, setReviewed] = useState(false),
    [edited, setEdited] = useState(false),
    [error, setError] = useState("");
  const [suggestionUsed, setSuggestionUsed] = useState(false);
  const input = {
    issuer: context.issuer,
    baseYear: context.baseYear,
    baseRevenue: context.baseRevenue,
    currency: context.currency,
    growthPercent: rates.map(v => (v.trim() === "" ? NaN : Number(v))),
    note,
    sourceUrl: source.trim() || null,
    origin: modelPlan?.origin ?? null,
    reviewed,
  };
  const preview = (() => {
    try {
      return calculateFiveYearScenario(input);
    } catch {
      return null;
    }
  })();
  const change = () => {
    setReviewed(false);
    setEdited(true);
    setError("");
  };
  const suggest = () => {
    if (!history) return;
    try {
      const path = fiveYearPath(history);
      setRates(path.rows.map(r => String(r.growthPercent)));
      setSuggestionUsed(true);
      setNote(
        "Bounded, damped historical planning suggestion. Publication vintages are incomplete; verify business drivers and do not infer calibration."
      );
      change();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Historical suggestion unavailable"
      );
    }
  };
  const exportPlan = () => {
    if (!preview) return;
    const value = {
      ...preview,
      method: suggestionUsed
        ? "bounded_median_damped_historical_suggestion"
        : "documented_analyst_scenario",
      modelReference: modelPlan
        ? {
            origin: modelPlan.origin,
            trainingIds: modelPlan.trainingIds,
            modelVersion: modelPlan.modelVersion,
          }
        : null,
      modelBands:
        !edited && modelPlan
          ? modelPlan.rows.map((r, i) => ({
              ...r.band,
              interval: usablePlanningBand(modelPlan, i, false),
              status: horizonReliability(i + 1, true).activeBandAllowed
                ? r.band.status
                : "withheld_failed_horizon_precision_gate",
            }))
          : null,
      horizonReliability: modelPlan
        ? modelPlan.rows.map(r => horizonReliability(r.horizon, !edited))
        : null,
      evidenceStatus:
        edited || !modelPlan
          ? "edited_or_manual_no_empirical_calibration"
          : "canonical_model_reference_only",
      limitation:
        "A planning horizon is not predictive proof. Transferred DCF drivers are analyst scenarios; revenue evidence does not validate fair value or returns.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "FilingLens-five-year-scenario.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const apply = () => {
    if (!preview || !reviewed || note.trim().length < 10) return;
    try {
      onApply?.(preview.input);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scenario transfer failed");
    }
  };
  const gap =
    preview && context.terminalGrowthPercent !== null
      ? Math.abs(preview.rows[4].growthPercent - context.terminalGrowthPercent)
      : null;
  return (
    <div
      aria-label="Five-year scenario editor"
      className="space-y-3 rounded-lg border border-slate-700 p-4"
    >
      <h3 className="font-semibold">Five-year driver workspace</h3>
      <p className="text-xs text-slate-400">
        {context.issuer} · base FY{context.baseYear}: {fmt(context.baseRevenue)}{" "}
        {context.currency} millions. One compounded path, not five independently
        selected forecasts. Draft edits do not change the DCF ledger until
        explicitly applied.
      </p>
      {history && (
        <button
          disabled={disabled}
          onClick={suggest}
          className="rounded border border-cyan-700 px-3 py-2 text-xs disabled:opacity-50"
        >
          Suggest a bounded historical planning path
        </button>
      )}
      {!modelPlan && (
        <p className="text-xs text-amber-200">
          Publication-vintage evidence is unavailable here. Historical
          suggestions and manual drivers are conditional planning assumptions,
          without empirical bands or issuer-specific accuracy qualification.
        </p>
      )}
      {modelPlan && (
        <p
          role="status"
          className="rounded border border-amber-800 p-3 text-xs text-amber-200"
        >
          Precision gate enforced: years 3–5 are planning-only. Their failed
          empirical bands are withheld from this table and scenario exports, not
          repaired by widening them. Years 1–2 have historical cohort evidence
          only; future and issuer-specific accuracy remain unproven.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-5">
        {rates.map((value, i) => (
          <label className="text-xs" key={i}>
            FY{context.baseYear + i + 1} growth %
            <input
              aria-label={`Planning growth year ${i + 1}`}
              type="number"
              step="any"
              min="-99"
              max="300"
              disabled={disabled}
              value={value}
              onChange={e => {
                setRates(old =>
                  old.map((v, j) => (i === j ? e.target.value : v))
                );
                change();
              }}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2"
            />
          </label>
        ))}
      </div>
      <label className="block text-xs">
        Scenario rationale
        <textarea
          aria-label="Five-year scenario rationale"
          rows={2}
          maxLength={1000}
          disabled={disabled}
          value={note}
          onChange={e => {
            setNote(e.target.value);
            change();
          }}
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2"
        />
      </label>
      <label className="block text-xs">
        Historical input or analyst source URL (optional)
        <input
          aria-label="Five-year scenario source URL"
          type="url"
          disabled={disabled}
          value={source}
          onChange={e => {
            setSource(e.target.value);
            change();
          }}
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2"
        />
      </label>
      {edited && modelPlan && (
        <p role="status" className="text-xs text-amber-200">
          Edited scenario: empirical bands and historical cohort qualification
          no longer apply.
        </p>
      )}
      {preview ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-xs">
            <caption className="pb-2 text-left">
              Five annual planning rows · {context.currency} millions
            </caption>
            <thead>
              <tr>
                {[
                  "Year",
                  "Growth %",
                  "Revenue / formula",
                  "Empirical model band",
                ].map(x => (
                  <th className="p-2" key={x}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => {
                const band = usablePlanningBand(modelPlan, i, edited);
                return (
                  <tr key={row.horizon}>
                    <td className="p-2">FY{row.targetYear}</td>
                    <td className="p-2">{fmt(row.growthPercent)}</td>
                    <td className="p-2">
                      <details>
                        <summary>{fmt(row.revenue)}</summary>
                        <p className="mt-2">
                          {fmt(row.previousRevenue)} × (1 + {row.growthPercent}%
                          / 100). Driver:{" "}
                          {edited || !modelPlan
                            ? "analyst scenario"
                            : "bounded damped historical model"}
                          .{" "}
                          {modelPlan
                            ? `Source cutoff ${modelPlan.sourceCutoff} (exclusive).`
                            : "Source cutoff unavailable."}
                        </p>
                      </details>
                    </td>
                    <td className="p-2">
                      {band
                        ? `${fmt(band.lower)}–${fmt(band.upper)}`
                        : modelPlan &&
                            !edited &&
                            !horizonReliability(i + 1, true).activeBandAllowed
                          ? "Withheld · precision gate failed"
                          : "Unavailable / uncalibrated"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-amber-200">
          Enter five explicit finite growth rates between −99% and 300%, with a
          valid source URL if provided. Blank rates are not treated as zero.
        </p>
      )}
      {gap !== null && gap > 3 && (
        <p className="text-xs text-amber-200">
          Year-five growth differs from the reviewed terminal growth by{" "}
          {fmt(gap)} percentage points. Review the transition; some businesses
          need an explicit period longer than five years. Terminal growth, ROIC
          and WACC are not changed by this planner.
        </p>
      )}
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          aria-label="Review five-year planning assumptions"
          checked={reviewed}
          disabled={disabled || !preview}
          onChange={e => setReviewed(e.target.checked)}
        />
        I reviewed all five growth drivers, base period, currency, source and
        rationale. These are conditional assumptions, not guaranteed outcomes or
        issuer guidance.
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          disabled={!preview || disabled}
          onClick={exportPlan}
          className="rounded border border-slate-600 px-3 py-2 text-xs disabled:opacity-50"
        >
          Export five-year scenario and evidence
        </button>
        {onApply && (
          <button
            disabled={
              !preview || !reviewed || note.trim().length < 10 || disabled
            }
            onClick={apply}
            className="rounded border border-cyan-700 px-3 py-2 text-xs disabled:opacity-50"
          >
            Apply reviewed five-year drivers to DCF
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}
