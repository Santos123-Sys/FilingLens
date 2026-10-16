import type { FilingAnalysis } from "@contracts/analysis";
import {
  actualNodeId,
  buildFinancialLineage,
} from "@contracts/financial-lineage";
import { FinancialEvidenceProvider, FinancialValue } from "./FinancialEvidence";
export default function FinancialEvidenceTable({
  analysis,
}: {
  analysis: FilingAnalysis;
}) {
  const lineage = buildFinancialLineage(analysis);
  const history = Boolean(analysis.financials.annualHistory?.years.length);
  const f = history ? analysis.financials.annualHistory! : analysis.financials;
  return (
    <FinancialEvidenceProvider lineage={lineage}>
      <section
        className="mt-4 rounded-xl border border-slate-700 p-4"
        aria-label="Auditable financial actuals"
      >
        <h3 className="text-sm font-semibold text-white">
          Reported actuals · inspect any value
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          {f.unit} · Source links identify evidence; they do not establish
          reconciliation. This table is an accessible alternative to the
          historical chart.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Reported financial actuals and original evidence
            </caption>
            <thead>
              <tr>
                <th className="p-2 text-left">Metric</th>
                {f.years.map((y, i) => (
                  <th key={i} className="p-2 text-right">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                "revenue",
                "ebit",
                "netIncome",
                "operatingCashFlow",
                "capex",
                "freeCashFlow",
                "totalDebt",
                "cash",
              ].map(key => (
                <tr key={key} className="border-t border-slate-800">
                  <th className="p-2 text-left font-medium">
                    {lineage.nodes[actualNodeId(key, 0, history)]?.label ?? key}
                  </th>
                  {f.years.map((_, i) => {
                    const id = actualNodeId(key, i, history),
                      node = lineage.nodes[id];
                    return (
                      <td key={i} className="p-2 text-right">
                        {node ? (
                          <FinancialValue
                            id={id}
                            label={`${node.label} ${node.period}`}
                          >
                            {typeof node.value === "number"
                              ? node.value.toLocaleString("en-US", {
                                  maximumFractionDigits: 2,
                                })
                              : "Unavailable"}
                          </FinancialValue>
                        ) : (
                          "Unavailable"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </FinancialEvidenceProvider>
  );
}
