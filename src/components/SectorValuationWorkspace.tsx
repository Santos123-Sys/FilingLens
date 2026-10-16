import { useEffect, useRef, useState } from "react";
import type { SectorValuationResult } from "@contracts/sector-valuation";
import { FinancialEvidenceProvider, FinancialValue } from "./FinancialEvidence";

type Sector = "bank" | "insurer" | "equity_reit";
type Field = { id: string; label: string; unit: string };
const labels: Record<Sector, string> = {
  bank: "Bank · residual income",
  insurer: "Insurer · residual income",
  equity_reit: "Equity REIT · property NAV",
};
const moneyFields = [
  "cash",
  "otherAssets",
  "grossDebt",
  "otherLiabilities",
  "preferredEquity",
  "nonControllingInterests",
  "corporateCostValue",
];
const moneyLabels = [
  "Unrestricted cash",
  "Other asset value",
  "Attributable gross debt",
  "Other liabilities",
  "Preferred equity claims",
  "Remaining noncontrolling claims",
  "Capitalized corporate costs",
];
const box =
  "mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm";

function SectorForm({ sector, issuer }: { sector: Sector; issuer?: string }) {
  const [values, setValues] = useState<Record<string, string>>({
    issuer: issuer ?? "",
    currency: "USD",
    valuationDate: new Date().toISOString().slice(0, 10),
    inputAsOf: "",
  });
  const [sources, setSources] = useState<Record<string, string>>({});
  const [properties, setProperties] = useState(1),
    [sample, setSample] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<SectorValuationResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const version = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    []
  );
  const invalidate = () => {
    version.current++;
    controller.current?.abort();
    setResult(null);
    setReviewed(false);
    setBusy(false);
    setError("");
  };
  const edit = (id: string, value: string) => {
    invalidate();
    setValues(v => ({ ...v, [id]: value }));
  };
  const fields: Field[] = [
    {
      id: "dilutedShares",
      label: "Valuation-date diluted common shares",
      unit: "million shares",
    },
    ...(sector === "equity_reit"
      ? [
          ...Array.from({ length: properties }, (_, i) => [
            {
              id: `properties.${i}.annualForwardNoi`,
              label: `Property ${i + 1} annual forward NOI`,
              unit: "millions · next 12 months",
            },
            {
              id: `properties.${i}.capRatePercent`,
              label: `Property ${i + 1} capitalization rate`,
              unit: "%",
            },
            {
              id: `properties.${i}.ownershipPercent`,
              label: `Property ${i + 1} economic ownership`,
              unit: "%",
            },
          ]).flat(),
          ...moneyFields.map((id, i) => ({
            id,
            label: moneyLabels[i],
            unit: "millions",
          })),
        ]
      : [
          {
            id: "openingCommonEquity",
            label: "Opening common book equity",
            unit: "millions",
          },
          {
            id: "costOfEquityPercent",
            label: "Cost of common equity",
            unit: "%",
          },
          ...Array.from({ length: 5 }, (_, i) => [
            {
              id: `netIncome.${i}`,
              label: `Common net income Y${i + 1}`,
              unit: "millions",
            },
            {
              id: `dividends.${i}`,
              label: `Common distributions Y${i + 1}`,
              unit: "millions",
            },
            {
              id: `minimumCommonEquity.${i}`,
              label: `Reviewed common-equity capital floor Y${i + 1}`,
              unit: "millions",
            },
          ]).flat(),
          {
            id: "terminalRoePercent",
            label: "Sustainable terminal ROE",
            unit: "%",
          },
          {
            id: "terminalGrowthPercent",
            label: "Terminal book-equity growth",
            unit: "%",
          },
        ]),
  ];
  const loadExample = () => {
    invalidate();
    setSample(true);
    setProperties(1);
    setSources({});
    const next: Record<string, string> = {
      issuer: `Synthetic ${sector === "equity_reit" ? "equity REIT" : sector}`,
      currency: "USD",
      valuationDate: "2026-10-16",
      inputAsOf: "2026-10-16",
      dilutedShares: "10",
    };
    if (sector === "equity_reit") {
      Object.assign(next, {
        "properties.0.annualForwardNoi": "12",
        "properties.0.capRatePercent": "6",
        "properties.0.ownershipPercent": "100",
        "properties.0.name": "Synthetic property",
      });
      moneyFields.forEach(k => {
        next[k] = k === "cash" ? "10" : k === "grossDebt" ? "50" : "0";
      });
    } else {
      Object.assign(next, {
        openingCommonEquity: "100",
        costOfEquityPercent: "10",
        terminalRoePercent: "10",
        terminalGrowthPercent: "2",
      });
      for (let i = 0; i < 5; i++) {
        next[`netIncome.${i}`] = String(15 + i);
        next[`dividends.${i}`] = String((15 + i) / 2);
        next[`minimumCommonEquity.${i}`] = "80";
      }
    }
    setValues(next);
  };
  const calculate = async () => {
    const current = ++version.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setBusy(true);
    setResult(null);
    try {
      const n = (id: string) => {
        if (!values[id]?.trim())
          throw Error(
            `Enter ${fields.find(f => f.id === id)?.label ?? id}; missing values are not zero.`
          );
        const v = Number(values[id]);
        if (!Number.isFinite(v)) throw Error(`Invalid ${id}`);
        return v;
      };
      const base = {
        issuer: values.issuer,
        currency: values.currency,
        valuationDate: values.valuationDate,
        inputAsOf: values.inputAsOf,
        dilutedShares: n("dilutedShares"),
        reviewed,
        sample,
        evidence: Object.fromEntries(
          Object.entries(sources)
            .filter(([, url]) => url.trim())
            .map(([id, url]) => [
              id,
              {
                url,
                note: `Analyst link for ${fields.find(f => f.id === id)?.label ?? id}; not a verified quotation.`,
              },
            ])
        ),
      };
      const body =
        sector === "equity_reit"
          ? {
              ...base,
              method: "reit_nav",
              sector,
              properties: Array.from({ length: properties }, (_, i) => ({
                name: values[`properties.${i}.name`] || `Property ${i + 1}`,
                annualForwardNoi: n(`properties.${i}.annualForwardNoi`),
                capRatePercent: n(`properties.${i}.capRatePercent`),
                ownershipPercent: n(`properties.${i}.ownershipPercent`),
              })),
              ...Object.fromEntries(moneyFields.map(k => [k, n(k)])),
              ownershipAndClaimsReviewed: reviewed,
            }
          : {
              ...base,
              method: "residual_income",
              sector,
              openingCommonEquity: n("openingCommonEquity"),
              costOfEquityPercent: n("costOfEquityPercent"),
              netIncome: Array.from({ length: 5 }, (_, i) =>
                n(`netIncome.${i}`)
              ),
              dividends: Array.from({ length: 5 }, (_, i) =>
                n(`dividends.${i}`)
              ),
              minimumCommonEquity: Array.from({ length: 5 }, (_, i) =>
                n(`minimumCommonEquity.${i}`)
              ),
              terminalRoePercent: n("terminalRoePercent"),
              terminalGrowthPercent: n("terminalGrowthPercent"),
              cleanSurplusConfirmed: reviewed,
              regulatoryCapitalReviewed: reviewed,
            };
      const response = await fetch("/api/valuation/sector", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Calculation unavailable");
      if (current === version.current) setResult(data.result);
    } catch (e) {
      if (current === version.current && !abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Calculation unavailable");
    } finally {
      if (current === version.current) setBusy(false);
    }
  };
  const exportResult = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "FilingLens-sector-valuation-audit.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-300">
        {sector === "equity_reit"
          ? "Attributable forward NOI / cap rate, followed by a complete common-equity claims bridge. Equity REITs only."
          : "Beginning common book equity plus discounted residual income. Use normalized common earnings and reconcile capital floors; no unmodeled OCI or net common issuance/buybacks."}
      </p>
      <p className="text-xs text-amber-200">
        Reviewed scenario calculator. These methods support evidence inspection
        and export; GPI portfolio publication remains limited to its existing
        approved DCF/comps contract. No inputs are saved on the server.
      </p>
      <button
        className="rounded-lg border border-slate-600 px-3 py-2 text-sm"
        onClick={loadExample}
      >
        Load synthetic {sector === "equity_reit" ? "REIT" : sector} example
      </button>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={sample}
          onChange={e => {
            invalidate();
            setSample(e.target.checked);
          }}
        />
        Synthetic example inputs
      </label>
      {sample && (
        <p role="status" className="text-sm text-amber-200">
          Synthetic illustration — no company facts or investment
          recommendation.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Issuer name
          <input
            className={box}
            value={values.issuer ?? ""}
            onChange={e => edit("issuer", e.target.value)}
          />
        </label>
        <label className="text-sm">
          Currency
          <select
            className={box}
            value={values.currency}
            onChange={e => edit("currency", e.target.value)}
          >
            {["USD", "BRL", "EUR", "GBP", "CHF"].map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Valuation date
          <input
            type="date"
            className={box}
            value={values.valuationDate}
            onChange={e => edit("valuationDate", e.target.value)}
          />
        </label>
        <label className="text-sm">
          Input snapshot as of
          <input
            type="date"
            className={box}
            value={values.inputAsOf}
            onChange={e => edit("inputAsOf", e.target.value)}
          />
        </label>
      </div>
      {sector === "equity_reit" && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              invalidate();
              setProperties(n => Math.min(30, n + 1));
            }}
            disabled={properties >= 30}
            className="rounded border border-slate-600 p-2"
          >
            Add property
          </button>
          <button
            onClick={() => {
              invalidate();
              setProperties(n => Math.max(1, n - 1));
            }}
            disabled={properties <= 1}
            className="rounded border border-slate-600 p-2"
          >
            Remove last property
          </button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(f => (
          <div key={f.id} className="rounded-lg border border-slate-800 p-3">
            <label className="text-xs text-slate-200">
              {f.label}
              <input
                className={box}
                aria-label={f.label}
                type="number"
                step="any"
                value={values[f.id] ?? ""}
                onChange={e => edit(f.id, e.target.value)}
              />
              <span className="text-xs text-slate-400">{f.unit}</span>
            </label>
            <details className="mt-2 text-xs text-slate-400">
              <summary>Attach input source</summary>
              <label>
                Source URL for {f.label}
                <input
                  type="url"
                  className={box}
                  aria-label={`Source URL for ${f.label}`}
                  value={sources[f.id] ?? ""}
                  onChange={e => {
                    invalidate();
                    setSources(s => ({ ...s, [f.id]: e.target.value }));
                  }}
                />
              </label>
            </details>
          </div>
        ))}
      </div>
      <label className="flex gap-2 text-sm leading-6">
        <input
          className="mt-1"
          type="checkbox"
          checked={reviewed}
          onChange={e => {
            version.current++;
            controller.current?.abort();
            setResult(null);
            setBusy(false);
            setReviewed(e.target.checked);
          }}
        />
        {sector === "equity_reit"
          ? "I reviewed forward NOI/cap-rate conventions, economic ownership, look-through debt, all common-equity claims and share dilution; no minority claim is counted twice."
          : "I reviewed normalized common earnings, distributions, dilution and reconciled regulatory capital to each common-equity floor; no unmodeled OCI or net issuance/buybacks violate clean surplus."}
      </label>
      <button
        className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        disabled={!reviewed || busy}
        onClick={calculate}
      >
        {busy ? "Calculating sector model…" : "Calculate sector model"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      )}
      {result && (
        <FinancialEvidenceProvider lineage={result.lineage}>
          <div className="space-y-4 rounded-xl border border-cyan-800 p-4">
            <h3 className="font-semibold">
              {result.lineage.calculationVersion} ·{" "}
              {result.input.sample
                ? "synthetic result"
                : "analyst-reviewed result"}
            </h3>
            <div className="text-2xl">
              <FinancialValue
                id="perShare"
                label="Sector value per common share"
              >
                {result.valuePerShare.toFixed(2)} {result.unit}
              </FinancialValue>
            </div>
            <div>
              <FinancialValue id="equity" label="Common equity value">
                {result.equityValue.toFixed(2)} {result.input.currency} millions
              </FinancialValue>
            </div>
            {result.reconciliation && (
              <p className="text-xs text-slate-300">
                Independent dividend-discount tie-out difference:{" "}
                {result.reconciliation.difference.toExponential(2)}{" "}
                {result.input.currency} millions.
              </p>
            )}
            <details>
              <summary className="text-sm">
                Inspect full calculation schedule
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.values(result.lineage.nodes)
                  .filter(n => n.classification === "calculated_metric")
                  .map(n => (
                    <div className="text-xs" key={n.id}>
                      <FinancialValue id={n.id} label={n.label}>
                        {n.label}:{" "}
                        {typeof n.value === "number"
                          ? n.value.toFixed(2)
                          : n.value}{" "}
                        {n.unit}
                      </FinancialValue>
                    </div>
                  ))}
              </div>
            </details>
            <ul className="list-disc space-y-2 pl-5 text-xs text-amber-100">
              {result.limitations.map(l => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <button
              className="rounded border border-slate-600 px-3 py-2 text-sm"
              onClick={exportResult}
            >
              Export sector inputs, sources and calculations
            </button>
          </div>
        </FinancialEvidenceProvider>
      )}
    </div>
  );
}

export default function SectorValuationWorkspace({
  issuer,
  initialSector = "bank",
}: {
  issuer?: string;
  initialSector?: Sector | "";
}) {
  const [sector, setSector] = useState<Sector | "">(initialSector);
  return (
    <section className="rounded-xl border border-slate-700 p-4 sm:p-6">
      <h2 className="text-xl font-semibold">Specialist sector valuation</h2>
      <label className="mt-4 block text-sm">
        Sector model
        <select
          className={box}
          value={sector}
          onChange={e => setSector(e.target.value as Sector)}
        >
          <option value="" disabled>
            Choose the reviewed sector and method
          </option>
          {Object.entries(labels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {sector && (
        <SectorForm
          key={`${sector}:${issuer ?? ""}`}
          sector={sector}
          issuer={issuer}
        />
      )}
    </section>
  );
}
