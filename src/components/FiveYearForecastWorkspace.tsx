import { useRef, useState } from "react";
import report from "../data/five-year-qualification-summary.json";
import watch from "../data/forecast-watch-summary.json";
import FiveYearScenarioEditor from "./FiveYearScenarioEditor";
import type { RevenueVintage } from "@contracts/forecast-qualification";
import type { PreparedFiveYearForecast } from "../../api/five-year-planner";
const fmt = (value: number | null) =>
  value === null
    ? "Unavailable"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
export default function FiveYearForecastWorkspace() {
  const [issuer, setIssuer] = useState(report.cohort[0].code),
    [origin, setOrigin] = useState("2026-07-01");
  const [plan, setPlan] = useState<PreparedFiveYearForecast | null>(null),
    [sources, setSources] = useState<RevenueVintage[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0),
    cache = useRef<RevenueVintage[] | null>(null);
  const invalidate = () => {
    version.current++;
    setPlan(null);
    setSources([]);
    setLoading(false);
    setError("");
  };
  const build = async () => {
    const run = ++version.current;
    setLoading(true);
    setError("");
    setPlan(null);
    try {
      if (!cache.current) {
        const r = await fetch("/evaluations/five-year-cohort-cvm-v3.json");
        if (!r.ok) throw Error("Source dataset unavailable");
        cache.current = (await r.json()).observations;
      }
      const observations = cache.current!.filter(o => o.issuer === issuer);
      const r = await fetch("/api/forecast/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ observations, origin }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error ?? "Five-year plan unavailable");
      if (run === version.current) {
        setPlan(body.result);
        setSources(observations);
      }
    } catch (e) {
      if (run === version.current)
        setError(e instanceof Error ? e.message : "Five-year plan unavailable");
    } finally {
      if (run === version.current) setLoading(false);
    }
  };
  const selected = report.cohort.find(i => i.code === issuer)!;
  return (
    <section
      aria-labelledby="five-year-title"
      className="space-y-4 rounded-xl border border-cyan-700 p-4 sm:p-6"
    >
      <h2 id="five-year-title" className="text-xl font-semibold">
        Five-year planning and horizon evidence
      </h2>
      <p className="text-sm leading-6 text-slate-300">
        Five years is a common explicit DCF/business-planning horizon—not a
        universal accuracy standard. The v3 model compounds one bounded, damped
        median-growth path instead of switching models independently at each
        year. It is tested on {report.heldOutIssuers} previously unused CVM
        issuers and {report.heldOutObservations} retained annual observations.
      </p>
      <p className="rounded border border-amber-800 p-3 text-sm text-amber-200">
        Point-comparison gates passed for years{" "}
        {report.qualifiedHorizons.join(", ") || "none"} in this fresh
        issuer-held-out cohort. Absolute errors grow sharply with horizon.
        Empirical precision is not established for years 3–5; comparison
        qualification is not a guarantee for a future company forecast. Failed
        years 3–5 bands are withheld from live plans and exports; the frozen
        report retains them for audit. No post-test parameter tuning or inflated
        accuracy claim is used to turn a failed precision gate into a pass.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-xs">
          <caption className="pb-2 text-left">
            Untouched issuer cohort · FY2023–2025 targets · macro error scaled
            by last known revenue, not MAPE
          </caption>
          <thead>
            <tr>
              {[
                "Horizon",
                "Scored / attempted",
                "Paired issuers",
                "V3 error %",
                "Naive error %",
                "V2 error %",
                "Point gates",
                "Band coverage %",
                "Median band width / base %",
                "Band usefulness",
              ].map(x => (
                <th className="border-b border-slate-700 p-2" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.summaries.map(s => (
              <tr key={s.horizon}>
                <th className="p-2">Year {s.horizon}</th>
                <td className="p-2">
                  {s.scored} / {s.attempted}
                </td>
                <td className="p-2">{s.pairedIssuers}</td>
                {["bounded_v3", "naive", "adaptive_v2"].map(m => (
                  <td className="p-2" key={m}>
                    {fmt(
                      s.scores.find(v => v.model === m)!
                        .macroScaledAbsoluteErrorPercent
                    )}
                  </td>
                ))}
                <td className="p-2">
                  {s.status === "qualified_in_fresh_issuer_cohort"
                    ? "Pass in cohort"
                    : "Conditional only"}
                </td>
                <td className="p-2">
                  {fmt(s.intervalCoveragePercent)} ({s.intervalCount} bands)
                </td>
                <td className="p-2">{fmt(s.medianIntervalWidthPercent)}</td>
                <td className="p-2">
                  {s.intervalUsefulness === "passes_project_precision_gate"
                    ? "Project gate passed"
                    : "Not established"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Bands target 80% empirically, calibrated only on earlier-filed outcomes
        from the original 60 development companies—not on these test issuers.
        Wide or under-covering bands are disclosed. Shared macro regimes,
        overlapping years and retained-vintage gaps limit generalization. This
        is not a prospective or global test.
      </p>
      <details className="rounded border border-slate-700 p-3 text-xs">
        <summary>
          Forward accuracy tracking · outcomes pending, not proven
        </summary>
        <p className="mt-2">
          Frozen {watch.issuedAt}; source cutoff {watch.sourceCutoff}. Fixed
          cohort: {watch.cohortSize} issuers, {watch.forecastIssuers} eligible
          and {watch.excluded} retained exclusions. Forecasts cover FY2026–2030.
          This October freeze is not a forecast issued in July and does not
          represent five full annual lead times from issuance.
        </p>
        <p className="mt-2">
          Independent timestamp: {watch.timestampStatus.replaceAll("_", " ")}.
          The initial local file is not independent prospective proof. The
          verifier must check successful GitHub CI metadata and exact committed
          snapshot bytes before classifying future scores as prospective.
        </p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[440px] text-left">
            <thead>
              <tr>
                <th>Year</th>
                <th>Fixed attempts</th>
                <th>Scored</th>
                <th>Pending outcomes</th>
                <th>Accuracy status</th>
              </tr>
            </thead>
            <tbody>
              {watch.summaries.map(s => (
                <tr key={s.horizon}>
                  <td>{s.horizon}</td>
                  <td>{s.fixedAttempts}</td>
                  <td>{s.scored}</td>
                  <td>{s.pending}</td>
                  <td>Not established</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2">
          Status snapshot as of {watch.asOf}; it is not a continuously refreshed
          production feed. Missing outcomes are never zero-filled. First annual
          FY2026 disclosures cannot mature before that reporting year ends;
          years 3–5 require later FY2028–2030 outcomes.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-cyan-200 underline">
          <a download href="/evaluations/forecast-watch-v1.json">
            Download frozen forward forecasts
          </a>
          <a download href="/evaluations/forecast-watch-score-v1.json">
            Download pending-outcome ledger
          </a>
        </div>
      </details>
      <details>
        <summary className="text-sm">
          Per-year gates, exclusions, sectors and worst cases
        </summary>
        <div className="mt-3 space-y-4 text-xs">
          {report.summaries.map(s => (
            <div key={s.horizon}>
              <h3 className="font-semibold">
                Year {s.horizon} · {s.excluded} exclusions
              </h3>
              <ul className="my-2 list-disc pl-5">
                {s.gates.map(g => (
                  <li key={g.name}>
                    {g.pass ? "Pass" : "Fail"}: {g.name}
                  </li>
                ))}
                {Object.entries(s.exclusions).map(([reason, n]) => (
                  <li key={reason}>
                    {reason.replaceAll("_", " ")}: {n}
                  </li>
                ))}
              </ul>
              <p>
                Sectors with fewer than three issuers:{" "}
                {s.sectors
                  .filter(x => x.evidence === "sparse")
                  .map(x => x.sector)
                  .join("; ") || "none"}
                .
              </p>
              <p className="mt-1">
                Largest retained error: {s.worstCases[0]?.name ?? "Unavailable"}{" "}
                ·{" "}
                {s.worstCases[0]
                  ? fmt(
                      (Math.abs(
                        s.worstCases[0].predictions.bounded_v3 -
                          s.worstCases[0].actual
                      ) /
                        s.worstCases[0].base) *
                        100
                    )
                  : "Unavailable"}
                % of base revenue. See complete exports for all cases and source
                IDs.
              </p>
            </div>
          ))}
        </div>
      </details>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Five-year model issuer
          <select
            aria-label="Five-year model issuer"
            value={issuer}
            onChange={e => {
              setIssuer(e.target.value);
              invalidate();
            }}
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2"
          >
            {report.cohort.map(i => (
              <option key={i.code} value={i.code}>
                {i.name} · CVM {i.code}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Source cutoff / origin (July 1)
          <input
            aria-label="Five-year forecast origin"
            type="date"
            value={origin}
            onChange={e => {
              setOrigin(e.target.value);
              invalidate();
            }}
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2"
          />
        </label>
      </div>
      <p className="text-xs text-slate-400">
        Historical reconstruction at the selected date, created today—not a
        forecast registered at that historical date. Only filings strictly
        before the date enter the plan.
      </p>
      <button
        disabled={loading}
        onClick={build}
        className="rounded border border-cyan-700 px-3 py-2 text-sm disabled:opacity-50"
      >
        {loading
          ? "Building five-year plan…"
          : "Build source-dated five-year plan"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      )}
      {plan && plan.status === "unavailable" && (
        <p role="status" className="text-sm text-amber-200">
          Unavailable: {plan.reason?.replaceAll("_", " ")}. Five consecutive
          positive annual inputs are required; missing years are not filled.
        </p>
      )}
      {plan &&
        plan.status === "conditional_five_year_plan" &&
        plan.currency &&
        plan.baseYear !== null &&
        plan.baseRevenue !== null && (
          <>
            <p className="text-xs">
              {plan.modelVersion} · {plan.trainingIds.length} available training
              years · source cutoff {plan.sourceCutoff} (exclusive) ·{" "}
              {plan.boundsApplied
                ? "historical growth bound applied"
                : "historical growth within bounds"}{" "}
              · {plan.calibrationEligibility.replaceAll("_", " ")}. Reported
              actuals are not capped.
            </p>
            <FiveYearScenarioEditor
              key={issuer + origin}
              context={{
                issuer: selected.name,
                baseYear: plan.baseYear,
                baseRevenue: plan.baseRevenue,
                currency: plan.currency,
                growthPercent: plan.rows.map(r => r.growthPercent),
                terminalGrowthPercent: null,
              }}
              modelPlan={plan}
              initialSourceUrl={
                sources.find(o => o.id === plan.trainingIds.at(-1))
                  ?.sourceUrl ?? ""
              }
            />
            <details>
              <summary className="text-xs">
                Inspect training disclosures and model formula
              </summary>
              <p className="my-2 text-xs">
                Median of up to five annual log changes; bounded to −20%/+25%
                initial growth; log trend damped by 0.8^(year−1). These are
                project controls, not economic laws. Revenue[h] = revenue[h−1] ×
                (1 + growth[h]/100).
              </p>
              <ul className="space-y-1 text-xs">
                {plan.trainingIds.map(id => {
                  const row = sources.find(o => o.id === id)!;
                  return (
                    <li key={id}>
                      <a
                        className="text-cyan-200 underline"
                        href={row.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        FY{row.fiscalYear} · {fmt(row.value)} {row.currency}{" "}
                        millions · filed {row.publishedOn} · {row.id}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </details>
          </>
        )}
      <div className="flex flex-wrap gap-4 text-sm text-cyan-200 underline">
        <a download href="/evaluations/five-year-evaluation-v3.json">
          Download five-year test, calibration references and exclusions
        </a>
        <a download href="/evaluations/five-year-cohort-cvm-v3.json">
          Download fresh cohort source rows
        </a>
      </div>
      <p className="text-xs text-slate-400">
        CVM DFP and issuer register · derivative database ODbL 1.0. No margins,
        cash-flow, terminal-value, WACC or return accuracy is inferred.
        Reference:{" "}
        <a
          href="https://rpc.cfainstitute.org/blogs/enterprising-investor/2026/rethinking-exit-multiples-in-high-growth-company-valuations"
          className="text-cyan-200 underline"
        >
          CFA Institute discussion of five-year forecasting limits
        </a>
        .
      </p>
    </section>
  );
}
