import { safeEvidenceUrl } from "@contracts/financial-lineage";
import { useEffect, useRef, useState } from "react";
import type { FilingAnalysis } from "@contracts/analysis";
import type { DebateResult, AssumptionEntry } from "@contracts/dcf-swarm";
import { analysisFetch, analysisAccessMessage } from "@/lib/gpi-access";
export default function DcfDebatePanel({
  analysis,
  lang,
  onTransfer,
  canTransfer,
}: {
  analysis: FilingAnalysis;
  lang: "en" | "pt";
  onTransfer: (run: DebateResult, key: AssumptionEntry["key"]) => void;
  canTransfer: boolean;
}) {
  const registry =
    analysis.jurisdiction === "us"
      ? analysis.metadata?.cik?.padStart(10, "0")
      : analysis.metadata?.cnpj?.replace(/\D/g, "");
  const issuerId = registry ? analysis.jurisdiction + ":" + registry : "";
  const [run, setRun] = useState<DebateResult | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [question, setQuestion] = useState(
    "Which DCF assumptions are defensible from the available annual evidence, and what could invalidate them?"
  );
  const [endYear, setEndYear] = useState(new Date().getFullYear() - 1);
  const abort = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [issuerId]
  );
  const request = async (action: "read" | "run") => {
    const version = ++generation.current;
    setBusy(true);
    setMessage("");
    abort.current = new AbortController();
    try {
      const response = await analysisFetch("/api/dcf-swarm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify(
          action === "read"
            ? { action, issuerId }
            : {
                action,
                issuerId,
                runId: crypto.randomUUID(),
                brief: {
                  question,
                  startYear: endYear - 4,
                  endYear,
                  language: lang,
                },
              }
        ),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? "debate_unavailable");
      if (version !== generation.current) return;
      const result = action === "read" ? body.run?.result : body.result;
      setRun(result ?? null);
      setMessage(
        result
          ? "Draft saved. Review estimates, sources and dissent before transferring any proposal."
          : body.run
            ? `Saved run: ${body.run.status}. No completed ledger is available.`
            : body.enabled
              ? "No saved debate for this issuer."
              : "Debate generation is disabled pending quality evaluation. Existing valuation tools remain available."
      );
    } catch (e) {
      if (version === generation.current)
        setMessage(
          abort.current?.signal.aborted
            ? "Stopped waiting and requested cancellation. Reload the saved run to check its final state."
            : (analysisAccessMessage(
                e instanceof Error ? e.message : "",
                lang
              ) ?? (e instanceof Error ? e.message : "Debate unavailable."))
        );
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  return (
    <section
      className="mt-4 rounded-xl border border-slate-600 p-4 space-y-3"
      aria-label="DCF assumption debate"
    >
      <h3 className="font-semibold">Hybrid DCF assumption review · AI draft</h3>
      <p className="text-sm">
        Five specialists and one selection judge examine the same evidence. At
        most six model calls, two at a time, within a bounded run. Only
        FilingLens calculates value after you review the inputs.
      </p>
      <p className="text-sm">
        Issuer: {issuerId || "Verified CIK/CNPJ required"}. Uses archived
        regulator facts; no private document text is sent by this feature.
      </p>
      <label className="block text-sm">
        Debate question
        <textarea
          className="block w-full bg-slate-900 border border-slate-500 p-2"
          value={question}
          maxLength={1600}
          onChange={e => setQuestion(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="block text-sm">
        Last fiscal year of evidence
        <input
          className="ml-2 bg-slate-900 border border-slate-500 p-1"
          type="number"
          min={2004}
          max={new Date().getFullYear()}
          value={endYear}
          onChange={e => setEndYear(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="border rounded px-3 py-2"
          disabled={busy || !issuerId || question.length < 20}
          onClick={() => void request("run")}
        >
          Start assumption debate
        </button>
        <button
          type="button"
          className="border rounded px-3 py-2"
          disabled={busy || !issuerId}
          onClick={() => void request("read")}
        >
          Reload saved debate
        </button>
        {busy && (
          <button
            type="button"
            className="border rounded px-3 py-2"
            onClick={() => abort.current?.abort()}
          >
            Stop request
          </button>
        )}
      </div>
      <p role="status" className="text-sm">
        {busy
          ? "Review in progress. Your current valuation inputs remain available."
          : message}
      </p>
      {run && run.issuerId === issuerId && (
        <>
          <p className="text-sm">
            {run.status.replaceAll("_", " ")} · {run.modelCalls} calls · saved{" "}
            {new Date(run.createdAt).toLocaleString()}
          </p>
          <ul className="text-sm list-disc pl-5">
            {run.limitations.map(t => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {run.consensus?.rows.map(row => (
            <article
              key={row.key}
              className="border border-slate-600 rounded p-3 space-y-2"
            >
              <h4 className="font-medium">
                {row.key.replaceAll("_", " ")} · {row.status}
              </h4>
              {row.proposal ? (
                <>
                  <p>
                    {row.proposal.value} {row.proposal.unit} ·{" "}
                    {row.proposal.basis === "analyst_estimate"
                      ? "AI estimate — no source substantiation"
                      : "Copied historical source value — forward use requires review"}
                  </p>
                  <p className="text-sm">{row.proposal.rationale}</p>
                  <button
                    type="button"
                    className="border rounded px-3 py-2"
                    disabled={!canTransfer || busy}
                    onClick={() => onTransfer(run, row.key)}
                  >
                    Copy to pending DCF inputs
                  </button>
                </>
              ) : (
                <p>No proposal. Enter a documented assumption manually.</p>
              )}
              {row.dissent.length > 0 && (
                <details>
                  <summary>
                    Inspect disagreement and challenges ({row.dissent.length})
                  </summary>
                  {row.dissent.map((d, i) => (
                    <p key={i}>
                      {d.from.replaceAll("_", " ")}: {d.note}
                    </p>
                  ))}
                </details>
              )}
            </article>
          ))}
          {!canTransfer && (
            <p>
              Prepare the DCF ledger first to copy a proposal. Copying resets
              affected rows to pending review and clears calculated results.
            </p>
          )}
          <details>
            <summary>Sources, specialists and run receipt</summary>
            <p className="break-all">
              {run.runId} · {run.snapshotId}
            </p>
            {run.evidence.map(e => (
              <div key={e.id}>
                <p>{e.text}</p>
                {e.sourceUrls
                  .filter(url => safeEvidenceUrl(url))
                  .map(url => (
                    <a
                      className="underline mr-3"
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Regulator source
                    </a>
                  ))}
              </div>
            ))}
            {run.opinions.map(o => (
              <div key={o.role}>
                <h4>
                  {o.role} · {o.error ?? "validated draft"}
                </h4>
                {o.opinion?.assumptions.map(a => (
                  <p key={a.key}>
                    {a.key}: {a.value} {a.unit} · {a.basis} · {a.rationale}
                  </p>
                ))}
              </div>
            ))}
            {run.gaps.map((gap, i) => (
              <p key={i}>{gap}</p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
