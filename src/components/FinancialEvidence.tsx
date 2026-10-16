import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import type { FinancialLineage } from "@contracts/financial-lineage";
import {
  safeEvidenceUrl,
  financialQuoteMatch,
} from "@contracts/financial-lineage";

const EvidenceContext = createContext<{
  open: (id: string, trigger: HTMLElement) => void;
} | null>(null);
const labels = {
  source_linked: "Source linked",
  user_supplied: "User supplied",
  unverified: "Unverified",
  conflicting_evidence: "Conflicting evidence",
  calculated: "Calculated",
};
function display(value: number | string | null, unit: string) {
  return value === null
    ? "Unavailable"
    : `${typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : value} ${unit}`;
}

export function FinancialEvidenceProvider({
  lineage,
  children,
}: {
  lineage: FinancialLineage;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [trail, setTrail] = useState<string[]>([]);
  const trigger = useRef<HTMLElement | null>(null);
  const open = useMemo(
    () => ({
      open: (id: string, button: HTMLElement) => {
        trigger.current = button;
        setTrail([]);
        setSelected(id);
      },
    }),
    []
  );
  const node = selected ? lineage.nodes[selected] : undefined;
  const navigate = (id: string) => {
    if (selected) setTrail(prev => [...prev, selected]);
    setSelected(id);
  };
  return (
    <EvidenceContext.Provider value={open}>
      {children}
      <Sheet
        open={Boolean(selected)}
        onOpenChange={value => {
          if (!value) setSelected(null);
        }}
      >
        <SheetContent
          className="w-full overflow-y-auto border-slate-700 bg-slate-950 text-slate-100 sm:max-w-xl"
          onCloseAutoFocus={event => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle className="pr-6 text-white">
              {node?.label ?? "Financial evidence"}
            </SheetTitle>
            <SheetDescription className="text-slate-400">
              {lineage.issuer.name} ·{" "}
              {lineage.issuer.registryId ?? "Registry unverified"} ·{" "}
              {node?.period ?? "Unknown period"}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6 text-sm">
            {trail.length > 0 && (
              <button
                className="rounded border border-slate-600 px-3 py-2 focus-visible:outline focus-visible:outline-cyan-300"
                onClick={() => {
                  setSelected(trail.at(-1)!);
                  setTrail(prev => prev.slice(0, -1));
                }}
              >
                Back to previous calculation
              </button>
            )}
            {!node ? (
              <p>
                Lineage is unavailable for this saved value. Recalculate using
                the reviewed ledger.
              </p>
            ) : (
              <>
                <p className="text-xl font-semibold text-white">
                  {display(node.value, node.unit)}
                </p>
                <p className="text-cyan-200">
                  {labels[node.status]} ·{" "}
                  {node.classification.replaceAll("_", " ")}
                </p>
                <p className="text-xs text-slate-400">
                  Source linked means a metric/period locator is attached. It
                  does not mean the amount was independently reconciled.
                  Calculated values inherit input limitations.
                </p>
                <dl className="space-y-2 text-xs text-slate-300">
                  <div>
                    <dt className="font-semibold">Accounting / scope</dt>
                    <dd>
                      {lineage.accountingBasis} · {lineage.scope}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">
                      Retrieval or calculation method
                    </dt>
                    <dd>{node.retrievalMethod}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">
                      Calculation version / valuation date
                    </dt>
                    <dd>
                      {lineage.calculationVersion} ·{" "}
                      {lineage.valuationDate ?? "Not recorded"}
                    </dd>
                  </div>
                </dl>
                {node.formula && (
                  <section>
                    <h3 className="font-semibold">
                      Formula / transformation rationale
                    </h3>
                    <p className="mt-2 rounded-lg bg-slate-900 p-3 text-xs leading-relaxed">
                      {node.formula}
                    </p>
                  </section>
                )}
                {node.inputs.length > 0 && (
                  <section>
                    <h3 className="font-semibold">Inspect inputs</h3>
                    <ul className="mt-2 space-y-2">
                      {node.inputs.map(id => (
                        <li key={id}>
                          <button
                            className="w-full rounded-lg border border-slate-700 p-3 text-left text-xs text-cyan-200 hover:bg-slate-900 focus-visible:outline focus-visible:outline-cyan-300"
                            onClick={() => navigate(id)}
                          >
                            {lineage.nodes[id]?.label ?? id}:{" "}
                            {display(
                              lineage.nodes[id]?.value ?? null,
                              lineage.nodes[id]?.unit ?? ""
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section>
                  <h3 className="font-semibold">
                    Original supporting evidence
                  </h3>
                  {!node.sources.length && (
                    <p className="mt-2 text-xs text-amber-200">
                      No direct source attached. Inspect input lineage or
                      provide documentary support. An AI explanation is not
                      financial evidence.
                    </p>
                  )}
                  {node.sources.map((source, i) => {
                    const url = safeEvidenceUrl(source.url);
                    const match = financialQuoteMatch(source.quote, node.value);
                    const token = match?.token ?? "";
                    const parts = match
                      ? [
                          source.quote!.slice(0, match.index),
                          source.quote!.slice(match.index + token.length),
                        ]
                      : null;
                    return (
                      <article
                        key={i}
                        className="mt-3 rounded-lg border border-slate-700 p-3 text-xs"
                      >
                        <p className="font-medium">
                          {source.publisher ?? "Publisher not recorded"} ·{" "}
                          {source.sourceForm ?? "Document type not recorded"}
                        </p>
                        <p className="mt-1">
                          {source.section}
                          {source.page ? ` · page ${source.page}` : ""}
                          {source.item ? ` · ${source.item}` : ""}
                        </p>
                        <blockquote className="mt-2 whitespace-pre-wrap leading-relaxed text-slate-300">
                          {parts
                            ? parts.map((part, j) => (
                                <span key={j}>
                                  {j > 0 && (
                                    <mark className="bg-amber-200 text-slate-950">
                                      {token}
                                    </mark>
                                  )}
                                  {part}
                                </span>
                              ))
                            : (source.quote ??
                              "No supporting excerpt retained.")}
                        </blockquote>
                        <p className="mt-2 text-slate-400">
                          Retrieved: {source.accessed ?? "not recorded"} ·
                          Publication/version fingerprint: not available in this
                          reference
                        </p>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-cyan-200 underline focus-visible:outline"
                          >
                            Open original source
                          </a>
                        ) : (
                          <p className="mt-2 text-amber-200">
                            Original source access unavailable. No new
                            permission is granted by this panel.
                          </p>
                        )}
                      </article>
                    );
                  })}
                </section>
                {node.checks.length > 0 && (
                  <section>
                    <h3 className="font-semibold">Checks completed</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-300">
                      {node.checks.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {node.limitations.length > 0 && (
                  <section>
                    <h3 className="font-semibold text-amber-200">
                      Limitations and review
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-100">
                      {node.limitations.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <section>
                  <h3 className="font-semibold">Used by</h3>
                  <ul className="mt-2 space-y-1">
                    {Object.values(lineage.nodes)
                      .filter(n => n.inputs.includes(node.id))
                      .map(n => (
                        <li key={n.id}>
                          <button
                            className="rounded p-1 text-xs text-cyan-200 underline focus-visible:outline"
                            onClick={() => navigate(n.id)}
                          >
                            {n.label}
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </EvidenceContext.Provider>
  );
}
export function FinancialValue({
  id,
  children,
  label,
}: {
  id: string;
  children: ReactNode;
  label?: string;
}) {
  const evidence = useContext(EvidenceContext);
  return (
    <button
      type="button"
      data-lineage-id={id}
      aria-label={label ? `Inspect ${label}` : undefined}
      title="Inspect financial evidence and calculation"
      className="rounded px-1 text-inherit underline decoration-dotted underline-offset-4 hover:bg-cyan-900/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      onClick={event => evidence?.open(id, event.currentTarget)}
    >
      {children}
    </button>
  );
}
