import { useEffect, useRef, useState } from "react";
import type { ForecastEvaluation } from "@contracts/forecast-evaluation";
import reference from "../data/forecast-reference.json";

const names: Record<string, string> = {
  filinglens_growth_v1: "Legacy FilingLens mechanical growth",
  naive: "Naive · last annual revenue",
  drift: "Linear drift",
  three_year_cagr: "Trailing CAGR · up to 3 years",
};
const format = (v: number | null) =>
  v === null
    ? "Unavailable"
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
export default function ForecastValidation() {
  const [issuer, setIssuer] = useState("Apple"),
    [horizon, setHorizon] = useState(1),
    [report, setReport] = useState<ForecastEvaluation | null>(null),
    [error, setError] = useState("");
  const version = useRef(0);
  useEffect(() => {
    const run = ++version.current,
      abort = new AbortController();
    fetch("/api/forecast/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        observations: reference.observations.filter(o => o.issuer === issuer),
        minTraining: 3,
        maxHorizon: 5,
      }),
      signal: abort.signal,
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error ?? "Evaluation unavailable");
        return data.result as ForecastEvaluation;
      })
      .then(r => {
        if (run === version.current) setReport(r);
      })
      .catch(e => {
        if (!abort.signal.aborted && run === version.current)
          setError(e.message);
      });
    return () => abort.abort();
  }, [issuer]);
  const scores = report?.scores.filter(s => s.horizon === horizon) ?? [];
  const current = scores.find(s => s.model === "filinglens_growth_v1"),
    naive = scores.find(s => s.model === "naive");
  const exportReport = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `FilingLens-${issuer}-forecast-validation.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-4 sm:p-6">
      <h2 className="text-xl font-semibold">
        Development reference · Apple and Microsoft
      </h2>
      <p className="text-sm leading-6 text-slate-300">
        Rolling forecasts use only annual observations published before each
        origin. The legacy DCF proposal rule is compared with naive, drift and
        CAGR baselines, without fitting to the target. Each issuer and horizon
        is scored separately.
      </p>
      <p className="text-sm text-amber-200">
        Retrospective original-disclosure replay, not forecasts registered at
        the time. This small two-issuer benchmark cannot establish future
        accuracy, fair value or investment returns.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          Benchmark issuer
          <select
            className="ml-2 rounded border border-slate-600 bg-slate-950 p-2"
            value={issuer}
            onChange={e => {
              version.current++;
              setReport(null);
              setError("");
              setIssuer(e.target.value);
            }}
          >
            <option>Apple</option>
            <option>Microsoft</option>
          </select>
        </label>
        <label className="text-sm">
          Forecast horizon
          <select
            className="ml-2 rounded border border-slate-600 bg-slate-950 p-2"
            value={horizon}
            onChange={e => setHorizon(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map(h => (
              <option key={h} value={h}>
                {h} fiscal year{h > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-rose-200">
          {error}
        </p>
      )}
      {!report && !error && (
        <p role="status">Evaluating frozen source observations…</p>
      )}
      {report && (
        <>
          {current && naive && (
            <p
              role="status"
              className="rounded-lg border border-amber-700 p-3 text-sm"
            >
              {current.mae < naive.mae
                ? "The legacy rule has lower absolute error than naive in this selected sample."
                : "The legacy rule does not beat naive on absolute error in this selected sample."}{" "}
              {current.count} folds at this horizon; no automatic model
              replacement or confidence upgrade.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="pb-3 text-left">
                {issuer} · horizon {horizon} · USD millions · error = forecast −
                actual
              </caption>
              <thead>
                <tr>
                  {[
                    "Model",
                    "Folds",
                    "MAE",
                    "RMSE",
                    "Bias",
                    "MAPE %",
                    "MASE",
                  ].map(x => (
                    <th key={x} className="border-b border-slate-700 p-2">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scores.map(s => (
                  <tr key={s.model}>
                    <th className="p-2 font-normal">{names[s.model]}</th>
                    <td className="p-2">{s.count}</td>
                    {[s.mae, s.rmse, s.bias, s.mapePercent, s.mase].map(
                      (v, i) => (
                        <td className="p-2" key={i}>
                          {format(v)}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            MAE/RMSE measure absolute error; bias is signed. MASE scales each
            fold by its training-period naive error; a constant training series
            has no defined MASE. MAPE is supported here because all revenue
            observations are positive.
          </p>
          <details>
            <summary className="text-sm">
              Inspect legacy-rule forecasts and source dates
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    {[
                      "Origin",
                      "Target FY",
                      "Forecast",
                      "Actual",
                      "Absolute error",
                      "Last training disclosure",
                    ].map(x => (
                      <th key={x} className="p-2">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows
                    .filter(
                      r =>
                        r.model === "filinglens_growth_v1" &&
                        r.horizon === horizon
                    )
                    .map(r => {
                      const t = report.observations.find(
                        o => o.id === r.targetId
                      )!;
                      const last = report.observations.find(
                        o => o.id === r.trainingIds.at(-1)
                      )!;
                      return (
                        <tr key={r.targetId + r.origin}>
                          <td className="p-2">{r.origin}</td>
                          <td className="p-2">{r.targetYear}</td>
                          <td className="p-2">{format(r.prediction)}</td>
                          <td className="p-2">
                            <a
                              className="text-cyan-200 underline"
                              href={t.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {format(r.actual)}
                            </a>
                          </td>
                          <td className="p-2">{format(r.absoluteError)}</td>
                          <td className="p-2">
                            <a
                              className="text-cyan-200 underline"
                              href={last.publicationUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {last.publishedOn}
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary className="text-sm">
              Source observations, vintages and limitations
            </summary>
            <ul className="mt-3 space-y-3 text-xs">
              {report.observations.map(o => (
                <li key={o.id}>
                  <a
                    href={o.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-200 underline"
                  >
                    FY{o.fiscalYear}: {format(o.value)} {o.currency} millions
                  </a>
                  <p>
                    Period ended {o.periodEnd}; published {o.publishedOn}.{" "}
                    {o.locator}
                  </p>
                  <p>Original row: {o.sourceQuote}</p>
                  <p className="break-all text-slate-400">
                    SHA-256 of retrieved source: {o.sourceSha256}
                  </p>
                </li>
              ))}
            </ul>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-xs text-amber-100">
              {report.limitations.map(l => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Source copies retrieved {reference.retrievedOn}; historical date
              is supported by the original issuer release.
            </p>
          </details>
          <button
            onClick={exportReport}
            className="rounded border border-slate-600 px-3 py-2 text-sm"
          >
            Export forecast validation with all folds and sources
          </button>
        </>
      )}
    </section>
  );
}
