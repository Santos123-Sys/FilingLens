import ForecastValidation from "../components/ForecastValidation";
import SectorValuationWorkspace from "../components/SectorValuationWorkspace";
export default function ValuationValidation() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <a className="text-sm text-cyan-200 underline" href="/">
          FilingLens workspace
        </a>
        <h1 className="text-2xl font-bold">
          Valuation methods and forecast evidence
        </h1>
        <p className="text-sm text-slate-300">
          Inspect measured forecast errors and run reviewed specialist
          scenarios. Deterministic correctness, predictive performance and
          authenticated product access are separate evidence.
        </p>
        <ForecastValidation />
        <SectorValuationWorkspace />
      </div>
    </main>
  );
}
