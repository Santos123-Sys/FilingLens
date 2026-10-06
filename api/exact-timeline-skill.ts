import type { HistoryResult, Market } from "../contracts/analysis";
import { SkillRuntimeError, validateTimelineWithExactSkill } from "./skill-runtime";

type Context = {
  jurisdiction: Market;
  filingType: string;
  filingDate?: string | null;
  issuerName?: string;
  filingPeriod?: string;
  currency?: string;
};

type HistoryEvent = HistoryResult["events"][number];
type Flag = NonNullable<HistoryResult["validationFlags"]>[number];

const CATEGORIES = new Set([
  "incorporation_founding", "ipo_listing", "ma_acquisition", "capital_raise",
  "leadership_change", "regulatory_legal", "product_launch", "partnership_contract",
  "dividend_distribution", "restructuring", "accounting_restatement", "subsequent_event", "other",
]);

function filingDateOnly(value?: string | null): string | null {
  if (!value) return null;
  const direct = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (direct) return direct;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function granularity(date: string): "day" | "month" | "year" {
  if (/^\d{4}$/.test(date)) return "year";
  if (/^\d{4}-\d{2}$/.test(date)) return "month";
  return "day";
}

function eventId(event: HistoryEvent): string {
  if (event.id?.trim()) return event.id;
  const slug = event.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "event";
  return `evt-${event.date}-${slug}`;
}

function payload(history: HistoryResult, context: Context, filingDate: string, events = history.events) {
  return {
    module: "historian",
    module_status: events.length || history.timeline.length ? "complete" : "incomplete",
    issuer_context: {
      issuer_name: context.issuerName ?? "",
      jurisdiction: context.jurisdiction === "br" ? "CVM" : "SEC",
      form_type: context.filingType,
      filing_period: context.filingPeriod ?? "",
      filing_date: filingDate,
      currency: context.currency ?? "",
    },
    events: events.map(event => ({
      id: eventId(event),
      date: event.date,
      date_granularity: event.dateGranularity ?? granularity(event.date),
      title: event.title.slice(0, 120),
      summary: (event.impact ?? event.title).slice(0, 200),
      category: CATEGORIES.has(event.category) ? event.category : "other",
      materiality: event.materiality ?? "implied",
      source_type: event.sourceType ?? (event.sourceRef?.kind === "citation" ? "external" : "filing"),
      source_ref: event.sourceType === "external" || event.sourceRef?.kind === "citation"
        ? {
          kind: "citation",
          url: event.sourceRef?.url ?? event.source?.url,
          publisher: event.sourceRef?.publisher ?? event.source?.publisher,
          accessed: event.sourceRef?.accessed ?? event.source?.accessed,
        }
        : {
          kind: "excerpt",
          section: event.sourceRef?.section ?? event.source?.section,
          page_hint: event.sourceRef?.pageHint ?? event.source?.page ?? undefined,
          quote: event.sourceRef?.quote ?? event.source?.quote,
        },
      confidence: event.confidence ?? (event.sourceType === "external" ? "medium" : "high"),
    })),
    enrichment_status: history.enrichmentStatus ?? "none",
    validation_flags: history.validationFlags ?? [],
    generated_at: new Date().toISOString(),
  };
}

async function passes(history: HistoryResult, context: Context, filingDate: string, events: HistoryEvent[]) {
  try {
    await validateTimelineWithExactSkill(payload(history, context, filingDate, events));
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the exact attached validate_timeline.py before events are bound. If a
 * combined payload fails, it isolates events, drops only those the exact
 * validator rejects, records each drop, and validates the retained set again.
 */
export async function applyExactTimelineValidation(history: HistoryResult, context: Context): Promise<HistoryResult> {
  const filingDate = filingDateOnly(context.filingDate);
  const flags: Flag[] = [...(history.validationFlags ?? [])];
  if (!filingDate) {
    flags.push({
      code: "TIMELINE_EXACT_VALIDATOR_SKIPPED",
      note: "The exact supplied timeline validator requires a disclosed YYYY-MM-DD filing date; no date was invented.",
      reason: "filing_date_unavailable",
    });
    return { ...history, enrichmentStatus: history.enrichmentStatus ?? "skipped", validationFlags: flags };
  }

  try {
    await validateTimelineWithExactSkill(payload(history, context, filingDate));
    return { ...history, validationFlags: flags };
  } catch (error) {
    const initialReason = error instanceof SkillRuntimeError
      ? (error.stderr || error.message).slice(0, 500)
      : String(error).slice(0, 500);
    flags.push({
      code: "TIMELINE_EXACT_VALIDATOR_REPAIR",
      note: "The combined timeline failed the exact supplied validator; FilingLens isolated events and retained only events that pass the validator.",
      reason: initialReason,
    });
  }

  const retained: HistoryEvent[] = [];
  for (const event of history.events) {
    if (await passes(history, context, filingDate, [event])) {
      retained.push({ ...event, id: eventId(event) });
    } else {
      flags.push({
        code: "DROPPED_EXACT_VALIDATOR",
        eventId: eventId(event),
        note: "Event removed because the exact supplied timeline validator rejected it.",
        reason: "exact_validator_rejected_event",
      });
    }
  }

  const repaired = { ...history, events: retained, validationFlags: flags };
  if (await passes(repaired, context, filingDate, retained)) return repaired;

  flags.push({
    code: "TIMELINE_EXACT_VALIDATOR_UNAVAILABLE",
    note: "The exact supplied validator still rejected the repaired event set; event binding was suppressed while filing-derived timeline items were retained.",
    reason: "combined_validation_failed_after_repair",
  });
  return { ...history, events: [], enrichmentStatus: "skipped", validationFlags: flags };
}
