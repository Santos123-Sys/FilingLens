import { useRef, useState } from "react";
import summary from "../data/forecast-qualification-summary.json";
import type {
  ForecastQuality,
  RevenueVintage,
} from "@contracts/forecast-qualification";

const names: Record<string, string> = {
  filinglens_growth_v1: "Legacy growth taper",
  naive: "Naive · last revenue",
  drift: "Linear drift",
  three_year_cagr: "Trailing 3-year CAGR",
  median_ensemble: "Median ensemble",
  adaptive_v2: "Historical selector v2",
};
const fmt = (v: number | null, digits = 2) =>
  v === null
    ? "Unavailable"
    : v.toLocaleString("en-US", { maximumFractionDigits: digits });
const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export default function ForecastQualification() {
  const [horizon, setHorizon] = useState(1),
    [split, setSplit] = useState("locked_test");
  const [issuer, setIssuer] = useState(summary.byIssuer[0].code);
  const [preview, setPreview] = useState<ForecastQuality | null>(null);
  const [sources, setSources] = useState<RevenueVintage[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0);
  const run = summary.summaries.find(
    s => s.horizon === horizon && s.split === split
  )!;
  const q = summary.qualification;
  const previewRow = preview?.forecasts.find(f => f.horizon === horizon);
  const selectedIssuer = summary.byIssuer.find(i => i.code === issuer)!;
  const evaluate = async () => {
    const v = ++version.current;
    setPreview(null);
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/evaluations/forecast-cohort-cvm.json");
      if (!response.ok) throw Error("Source dataset unavailable; try again.");
      const dataset = (await response.json()) as {
        observations: RevenueVintage[];
      };
      const observations = dataset.observations.filter(
        o => o.issuer === issuer
      );
      const result = await fetch("/api/forecast/quality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ observations, origin: "2026-07-01" }),
      });
      const body = await result.json();
      if (!result.ok) throw Error(body.error ?? "Evaluation unavailable");
      if (v === version.current) {
        setPreview(body.result);
        setSources(observations);
      }
    } catch (e) {
      if (v === version.current)
        setError(e instanceof Error ? e.message : "Evaluation unavailable");
    } finally {
      if (v === version.current) setLoading(false);
    }
  };
  return (
    <section
      aria-labelledby="expanded-forecast-title"
      className="space-y-4 rounded-xl border border-cyan-800 p-4 sm:p-6"
    >
      <h2 id="expanded-forecast-title" className="text-xl font-semibold">
        Expanded forecast evidence · 60-company CVM cohort
      </h2>
      <p className="text-sm leading-6 text-slate-300">
        Fixed from 301 eligible 2018 reporters before scoring FY2023–2025.{" "}
        {summary.observationCount} retained annual revenue observations; exact
        filing-version dates determine what each July 1 forecast could use.
        Missing vintages and issuer exits remain in the coverage denominator.
      </p>
      <div className="rounded-lg border border-cyan-800 bg-cyan-950/30 p-4 text-sm">
        <strong>
          One-year qualification:{" "}
          {q.status === "qualified_in_declared_cohort"
            ? "passed declared cohort gates"
            : "failed"}
          .
        </strong>
        <p className="mt-2">
          {q.pairedCases} paired forecasts · {q.pairedIssuers} issuers · macro
          scaled absolute error: legacy {fmt(q.legacyMacroErrorPercent)}%,
          selector {fmt(q.adaptiveMacroErrorPercent)}%, naive{" "}
          {fmt(q.naiveMacroErrorPercent)}%. Relative improvement over legacy:{" "}
          {fmt(q.relativeImprovementVsLegacyPercent)}%.
        </p>
        <p className="mt-2 text-amber-200">
          Only horizon 1 is qualified in this historical cohort. Large errors
          persist; horizons 2–5 are comparison scenarios. This evidence does not
          establish accuracy for another issuer, other financial drivers, fair
          value or returns.
        </p>
      </div>
      <details>
        <summary className="text-sm">
          Inspect frozen qualification gates
        </summary>
        <ul className="mt-2 space-y-1 text-xs">
          {q.gates.map(g => (
            <li key={g.name}>
              {g.pass ? "Pass" : "Fail"} · {g.name}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          Protocol committed at {summary.protocolCommit} before the expanded
          outcomes were evaluated. No candidate was retuned after the locked
          test. Overlapping horizon errors are dependent; no statistical
          significance claim.
        </p>
      </details>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>
          Evaluation split
          <select
            className="ml-2 rounded border border-slate-600 bg-slate-950 p-2"
            value={split}
            onChange={e => setSplit(e.target.value)}
          >
            <option value="locked_test">Locked test · FY2023–2025</option>
            <option value="validation">Validation · FY2022</option>
            <option value="development">Development · through FY2021</option>
          </select>
        </label>
        <label>
          Expanded forecast horizon
          <select
            className="ml-2 rounded border border-slate-600 bg-slate-950 p-2"
            value={horizon}
            onChange={e => setHorizon(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map(h => (
              <option key={h} value={h}>
                {h} year{h > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm">
        {run.attempted - run.excluded} scored / {run.attempted} attempted ·{" "}
        {run.excluded} excluded. Qualification at this horizon:{" "}
        {horizon === 1 && split === "locked_test"
          ? "measured one-year cohort pass"
          : "comparison only"}
        .
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] text-left text-xs">
          <caption className="pb-2 text-left">
            Annual reported revenue · horizon {horizon} · errors divided by last
            known revenue
          </caption>
          <thead>
            <tr>
              {[
                "Model",
                "Cases / issuers",
                "Macro error %",
                "Mean error %",
                "Median error %",
                "MAPE %",
                "Band cases",
                "Band coverage %",
                "Mean band width / base %",
              ].map(h => (
                <th key={h} className="border-b border-slate-700 p-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.scores.map(s => (
              <tr key={s.model}>
                <th className="p-2 font-normal">{names[s.model]}</th>
                <td className="p-2">
                  {s.count} / {s.issuerCount}
                </td>
                {[
                  s.macroScaledAbsoluteErrorPercent,
                  s.meanScaledAbsoluteErrorPercent,
                  s.medianScaledAbsoluteErrorPercent,
                  s.mapePercent,
                ].map((v, i) => (
                  <td className="p-2" key={i}>
                    {fmt(v)}
                  </td>
                ))}
                <td className="p-2">{s.intervalCount}</td>
                <td className="p-2">{fmt(s.intervalCoveragePercent)}</td>
                <td className="p-2">{fmt(s.meanIntervalWidthPercentOfBase)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-5 text-slate-400">
        Macro error gives each issuer equal weight; mean and median use cases.
        Small revenue bases and business restructurings can produce very large
        scaled errors. MAPE excludes nonpositive actuals. Bands target 80%
        empirically, use only earlier available errors and require at least
        five; observed coverage and band availability vary by horizon. They are
        not guaranteed probabilities. One-year mean band width exceeds 2,500% of
        base revenue: high coverage can come from impractically wide bands.
      </p>
      <details>
        <summary className="text-sm">
          Coverage exclusions for this split and horizon
        </summary>
        <ul className="mt-2 text-xs">
          {Object.entries(run.reasons).map(([reason, n]) => (
            <li key={reason}>
              {reason.replaceAll("_", " ")}: {n}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="text-sm">
          One-year locked-test sectors and worst cases
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr>
                {[
                  "CVM sector (current label)",
                  "Test issuers",
                  "Selector macro error %",
                  "Evidence",
                ].map(x => (
                  <th className="p-2" key={x}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.sectors.map(s => (
                <tr key={s.sector}>
                  <th className="p-2 font-normal">{s.sector}</th>
                  <td className="p-2">{s.testIssuers}</td>
                  <td className="p-2">
                    {fmt(
                      s.scores.find(x => x.model === "adaptive_v2")!
                        .macroScaledAbsoluteErrorPercent
                    )}
                  </td>
                  <td className="p-2">{s.evidence.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="my-2 text-xs">
          Largest one-year selector errors, retained without clipping:
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-xs">
          {summary.worstCases.slice(0, 6).map(r => (
            <li key={r.issuer + r.origin}>
              {summary.byIssuer.find(i => i.code === r.issuer)!.name} · FY
              {r.targetYear} ·{" "}
              {fmt(
                (Math.abs(r.predictions.adaptive_v2 - r.actual) / r.scale) * 100
              )}
              % of base revenue
            </li>
          ))}
        </ol>
      </details>
      <div className="space-y-3 border-t border-slate-700 pt-4">
        <h3 className="font-semibold">
          Inspect an issuer scenario and its evidence gaps
        </h3>
        <p className="text-xs text-slate-400">
          Reconstruction at July 1, 2026 using retained disclosures available
          before that date. Created today, not registered in July; later market
          or interim information is excluded. No future outcome is scored.
        </p>
        <label className="block text-sm">
          CVM scenario issuer
          <select
            className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-2"
            value={issuer}
            onChange={e => {
              version.current++;
              setIssuer(e.target.value);
              setPreview(null);
              setSources([]);
              setError("");
              setLoading(false);
            }}
          >
            {summary.byIssuer.map(i => (
              <option key={i.code} value={i.code}>
                {i.name} · CVM {i.code}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-400">
          {selectedIssuer.sector} · {selectedIssuer.testCases} one-year
          locked-test cases · selector macro error{" "}
          {fmt(
            selectedIssuer.scores.find(s => s.model === "adaptive_v2")!
              .macroScaledAbsoluteErrorPercent
          )}
          % of base revenue.{" "}
          {selectedIssuer.testCases < 3
            ? "Sparse issuer evidence."
            : "Historical results only."}
        </p>
        <button
          className="rounded border border-cyan-700 px-3 py-2 text-sm disabled:opacity-50"
          disabled={loading}
          onClick={evaluate}
        >
          {loading ? "Evaluating…" : "Inspect source-dated scenario"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
        )}
        {preview && (
          <div className="space-y-2 rounded border border-slate-700 p-3 text-sm">
            <p>
              {selectedIssuer.name} · source cutoff {preview.sourceCutoff}{" "}
              (exclusive) · {preview.trainingIds.length} training years.
            </p>
            {previewRow ? (
              <>
                <p>
                  FY{previewRow.targetYear} revenue:{" "}
                  {fmt(previewRow.prediction)} BRL millions ·{" "}
                  {names[previewRow.selectedModel]} ·{" "}
                  {previewRow.selectionStatus.replaceAll("_", " ")} ·{" "}
                  {previewRow.selectionErrors} historical selection errors.
                </p>
                <p>
                  Empirical band:{" "}
                  {previewRow.interval
                    ? `${fmt(previewRow.interval.lower)}–${fmt(previewRow.interval.upper)} BRL millions`
                    : "Unavailable"}{" "}
                  · {previewRow.calibrationErrors} pre-origin errors.{" "}
                  {horizon > 1
                    ? "This horizon is not qualified for an automatic proposal."
                    : "Historical cohort qualification does not guarantee this future result."}
                </p>
              </>
            ) : (
              <p className="text-amber-200">
                Unavailable: {preview.reason?.replaceAll("_", " ")}. No missing
                values were filled.
              </p>
            )}
            <button
              className="text-cyan-200 underline"
              onClick={() =>
                download(`FilingLens-CVM-${issuer}-scenario-evidence.json`, {
                  qualification: q,
                  issuer: selectedIssuer,
                  proposal: preview,
                  observations: sources,
                  userEdits:
                    "Any change creates an unvalidated scenario; historical bands do not transfer.",
                })
              }
            >
              Export scenario, qualification and filing vintages
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-cyan-200 underline">
        <a href="/evaluations/forecast-qualification-v2.json" download>
          Download every forecast and exclusion
        </a>
        <a href="/evaluations/forecast-cohort-cvm.json" download>
          Download source rows and exact receipts
        </a>
      </div>
      <details>
        <summary className="text-xs">
          Scope, source attribution and limitations
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-400">
          {summary.limitations.map(x => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          CVM DFP and issuer register · derivative database{" "}
          <a
            className="text-cyan-200 underline"
            href="https://opendatacommons.org/licenses/odbl/1-0/"
          >
            ODbL 1.0
          </a>{" "}
          · acquired {summary.acquiredOn}. CVM does not endorse the evaluation.
        </p>
      </details>
    </section>
  );
}
