import { useEffect, useState } from "react";
import type {
  FilingAnalysis,
  ValuationAssumption,
  DcfValuationResult,
} from "@contracts/analysis";
import { valuationAssumptionSchema } from "@contracts/analysis";
import reference from "../data/apple-valuation-reference.json";
import ValuationWorkspace from "../components/ValuationWorkspace";
import FinancialEvidenceTable from "../components/FinancialEvidenceTable";

export default function ValuationReference() {
  const [analysis, setAnalysis] = useState<FilingAnalysis | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const assumptions = reference.reviewedDcfAssumptions.map(r =>
      valuationAssumptionSchema.parse(r)
    ) as ValuationAssumption[];

    fetch("/api/valuation/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        analysis: reference.analysis,
        method: "dcf",
        assumptions,
      }),
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok)
          throw Error("Reference calculation unavailable. Refresh to retry.");
        return response.json();
      })
      .then(({ result }: { result: DcfValuationResult }) =>
        setAnalysis({
          ...reference.analysis,
          valuation: { assumptions: { dcf: assumptions }, dcf: result },
        } as unknown as FilingAnalysis)
      )
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <a className="text-sm text-cyan-200 underline" href="/">
          FilingLens workspace
        </a>
        <h1 className="mt-4 text-2xl font-bold">
          Apple · auditable operating-company reference
        </h1>
        <p className="mt-3 max-w-4xl text-sm leading-relaxed text-slate-300">
          Public FY2025 issuer statement, USD millions. Operating-company FCFF
          is used to demonstrate reproducible calculations and evidence
          inspection. Market rates, growth, tax and terminal ROIC are
          illustrative analyst assumptions. This is not an investment
          recommendation, live quote, issuer guidance or consensus.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Source retrieved {reference.source.retrievedAt}. PDF fingerprint:{" "}
          {reference.source.pdfSha256}. Source dates and historical diluted
          shares are preserved; fingerprints identify bytes, not audited
          correctness.
        </p>
        <a
          className="mt-3 inline-block text-xs text-cyan-200 underline"
          href={reference.source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open original Apple statement
        </a>
        <details className="mt-4 rounded-xl border border-amber-700/40 p-4 text-xs text-amber-100">
          <summary>Material limitations and missing evidence</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {reference.limitations.map(x => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
        {error ? (
          <p role="alert" className="mt-5 text-rose-200">
            {error}
          </p>
        ) : !analysis ? (
          <p role="status" className="mt-5">
            Calculating reference through the deterministic server engine…
          </p>
        ) : (
          <>
            <FinancialEvidenceTable analysis={analysis} />
            <ValuationWorkspace analysis={analysis} lang="en" />
          </>
        )}
      </div>
    </main>
  );
}
