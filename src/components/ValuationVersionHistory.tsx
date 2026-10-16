import { useState } from "react";
import type { ValuationBundle, ValuationAssumption } from "@contracts/analysis";
const value = (row: ValuationAssumption | undefined) =>
  row ? String(row.final_value ?? row.proposed_value ?? "") : "";
export default function ValuationVersionHistory({
  bundle,
  onRestore,
  locale,
}: {
  bundle: ValuationBundle;
  onRestore: (b: ValuationBundle) => void;
  locale: string;
}) {
  const [versions, setVersions] = useState<
    Array<{ date: string; bundle: ValuationBundle }>
  >([]);
  const prior = versions.at(-1)?.bundle;
  const before = prior?.dcf?.figures.implied_per_share.value,
    after = bundle.dcf?.figures.implied_per_share.value;
  const changes = (bundle.assumptions.dcf ?? []).filter(row => {
    const old = prior?.assumptions.dcf?.find(x => x.id === row.id);
    return old && value(old) !== value(row);
  });
  return (
    <section
      className="mt-5 rounded-xl border border-slate-700 p-4 text-xs text-slate-300"
      aria-label="Session versions and recovery"
    >
      <h3 className="font-semibold">Session versions and recovery</h3>
      <p className="mt-1 text-slate-400">
        Keep up to five versions in this open session. Export each audit for a
        durable copy; approved publications retain their own server audit.
        Editing inputs clears dependent results.
      </p>
      <button
        disabled={!bundle.dcf && !bundle.comps}
        onClick={() =>
          setVersions(prev => [
            ...prev.slice(-4),
            { date: new Date().toISOString(), bundle: structuredClone(bundle) },
          ])
        }
        className="mt-3 rounded border border-slate-500 px-3 py-2 disabled:opacity-40"
      >
        Save session version
      </button>
      {versions.map((version, i) => (
        <div
          key={`${version.date}-${i}`}
          className="mt-2 flex flex-wrap items-center gap-3"
        >
          <span>
            {i + 1} · {version.date}
          </span>
          <button
            className="rounded border border-slate-600 px-2 py-1"
            onClick={() => onRestore(structuredClone(version.bundle))}
          >
            Restore version {i + 1}
          </button>
        </div>
      ))}
      {prior && (
        <details className="mt-3">
          <summary>Changes from last saved version</summary>
          <p className="mt-2">
            Value/share change:{" "}
            {typeof before === "number" && typeof after === "number"
              ? (after - before).toLocaleString(locale, {
                  maximumFractionDigits: 2,
                })
              : "Recalculate to compare"}
            . Total change is not a causal attribution to individual drivers.
          </p>
          <ul className="mt-2 list-disc pl-4">
            {changes.map(row => (
              <li key={row.id}>
                {row.label}:{" "}
                {value(prior.assumptions.dcf?.find(x => x.id === row.id))} →{" "}
                {value(row)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
