import { lazy, Suspense } from "react";
const ValuationReference = lazy(() => import("./pages/ValuationReference"));
const ValuationValidation = lazy(() => import("./pages/ValuationValidation"));
import { Routes, Route } from "react-router";
import HomeV2 from "./pages/HomeV2";
import ValueDriverIntelligence from "./components/ValueDriverIntelligence";

export default function App() {
  return (
    <Routes>
      <Route path="/valuation/validation" element={<Suspense fallback={<p role="status">Loading valuation validation…</p>}><ValuationValidation /></Suspense>} />
      <Route
        path="/valuation/reference/apple"
        element={
          <Suspense fallback={<p role="status">Loading reference workflow…</p>}>
            <ValuationReference />
          </Suspense>
        }
      />
      <Route path="/" element={<HomeV2 />} />
      <Route
        path="/value-drivers/apple"
        element={
          <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
            <div className="mx-auto max-w-6xl space-y-5">
              <a href="/" className="text-sm text-cyan-300 underline">
                ← FilingLens dashboard
              </a>
              <h1 className="text-2xl font-bold">
                Apple — real-data value-driver case
              </h1>
              <ValueDriverIntelligence lang="en" />
            </div>
          </main>
        }
      />
    </Routes>
  );
}
