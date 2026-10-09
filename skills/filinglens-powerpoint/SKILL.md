---
name: filinglens-powerpoint
version: 1.0.0
description: "Generate a decision-ready company analysis PowerPoint from the validated FilingAnalysis contract. Use for SEC/CVM company decks, financial review decks, filing summaries, and management/investor-style informational presentations. The skill is filing-first, source-aware, PowerPoint-compatible, and must preserve data-quality caveats instead of inventing missing facts."
---

# FilingLens PowerPoint Skill

## 1. Canonical output

The canonical artifact is a **new `.pptx` file** generated from the validated `FilingAnalysis` object. Do not mutate the user's source filing and do not treat a browser preview, PDF export, or handcrafted ZIP as proof that Microsoft PowerPoint can open the file.

Default generation route: the private `filinglens-data-tools` Railway service using a typed PPT Agent-inspired planner and `python-pptx` renderer. The browser must request the deck through FilingLens' `/api/presentation` proxy. The service saves the deck to memory and reopens it with `python-pptx` before delivery.

## 2. Evidence boundary

Source priority is strict:

1. SEC EDGAR / CVM structured regulatory data.
2. Uploaded regulatory filing bundle.
3. Citation-backed external research.
4. Explicitly calculated metrics derived from documented inputs.

Never silently overwrite a filing-derived value with an external provider value. When authoritative values disagree, show a conflict or quality warning. Missing evidence remains missing.

## 3. Narrative objective

Build a professional informational company deck that answers, in order:

- What company / filing is being analyzed?
- What changed or matters most?
- What is the financial trajectory?
- What is the cash / balance-sheet position?
- Where does the company compete and earn money?
- What are the principal disclosed risks?
- What material events shape the current picture?
- How complete and reliable is the evidence?

Use message headlines rather than generic labels whenever supported by the analysis. Avoid investment recommendations, target prices, or unsupported forward-looking claims unless they are explicitly part of an approved valuation workflow and clearly labeled as assumptions.

## 4. Default slide architecture

Use 16:9 widescreen. Default deck length is 8–12 slides; the standard FilingLens company deck is 10 slides:

1. **Cover** — company, ticker, filing/form, reporting period, concise descriptor.
2. **Executive overview** — 4–6 supported takeaways and filing snapshot.
3. **Financial snapshot** — latest revenue, net income, operating cash flow, cash, debt, plus evidence discipline.
4. **Financial performance** — trend charts for revenue and earnings; annotate unusual changes only when supported.
5. **Balance sheet & cash conversion** — liquidity, leverage, operating cash flow, capex, assets/equity.
6. **Market & operating context** — industry, verified peers, segments, geographies.
7. **Principal risks** — ranked material filing-derived risks with concise implications.
8. **Timeline & material events** — dated, validated events; distinguish filing vs external sources.
9. **Data quality & controls** — module status, regulatory cross-check status, missing-data inventory and conflicts.
10. **Sources & methodology** — evidence hierarchy, provenance, calculation policy, PowerPoint QA note.

If a section has no reliable data, preserve the slide only when the absence is decision-useful; otherwise omit it and renumber. Do not fill empty slides with fabricated context.

## 5. Design system

Use a restrained institutional finance aesthetic:

- Background: deep navy / charcoal.
- Primary text: near-white.
- Secondary text: cool gray.
- Accents: cyan/blue for neutral information, green for verified/positive status, amber for partial/caution, rose for risk/conflict, violet for secondary dimensions.
- Default font: Aptos; use a widely available fallback if unavailable.
- Prefer one primary message per slide, one or two charts, and generous whitespace.
- Use cards for KPIs, not dense tables.
- Use native PowerPoint charts where practical so recipients can edit them.

Charts must have clear units, period labels, and readable category labels. Never imply precision beyond the underlying filing data.

## 6. Financial storytelling rules

- Use reported periods exactly as provided by the validated analysis.
- Distinguish quarterly, YTD and annual values.
- Do not combine currencies or scales without explicit conversion.
- Treat calculated metrics as calculated, not reported.
- When regulatory structured data and filing extraction match, label the metric as verified.
- When only one authoritative source exists, label it single-source.
- When sources disagree materially, surface a conflict and avoid a definitive headline based on the disputed figure.

## 7. Provenance on slides

Each data-bearing slide should include a compact footer or source note. Use labels such as:

- `SEC EDGAR`
- `CVM Dados Abertos`
- `Uploaded filing`
- `External cited source`
- `Calculated by FilingLens`

Do not dump long raw URLs into the visual body unless the sources slide requires them.

## 8. Generation mechanics

The presentation engine must:

1. receive a validated `FilingAnalysis` JSON payload;
2. create a typed, sequential slide plan with unique sections, purpose, source note and speaker notes;
3. derive action titles only from validated summaries or explicit calculations over comparable series;
4. construct the deck with `python-pptx`;
5. use a standard 16:9 slide size;
6. avoid handcrafted OOXML except for a narrowly justified unsupported feature;
7. save to an in-memory stream;
8. reopen the saved bytes with `python-pptx`;
9. verify the package starts with ZIP signature `PK`, slide count and planned titles;
10. verify that data-quality and source disclosures remain present;
11. return MIME type `application/vnd.openxmlformats-officedocument.presentationml.presentation`;
12. return a safe `.pptx` filename via `Content-Disposition` and expose the engine and QA result in response headers.

## 9. QA gate

Before returning a deck, verify:

- expected slide count;
- PPTX package can be reopened;
- no empty mandatory title fields;
- chart series lengths align with categories;
- no non-finite numeric values are passed to charts;
- sources / data-quality disclosure are present;
- the deck contains no unsupported facts added solely for visual completeness.

A successful library round-trip proves package integrity, not exact Microsoft PowerPoint rendering. Do not claim exact Windows/macOS PowerPoint rendering unless the file was actually opened and inspected there.

## 10. Failure behavior

If generation fails, return a specific `presentation_generation_failed` error to FilingLens. Do not silently fall back to the legacy browser OOXML renderer. The UI should preserve the analysis and allow the user to retry the export without rerunning the company analysis.

## 11. Information-only boundary

The standard deck is informational. It may summarize valuation outputs only when those outputs already exist in the validated analysis and assumptions are explicitly disclosed. It must not independently create recommendations, target prices, or investment advice.
