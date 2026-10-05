import type { HistoryResult } from "../contracts/analysis";

export function extractDatedFilingEvents(text: string): HistoryResult["events"] {
  const eventWords = /\b(acquired|acquisition|merged|merger|founded|incorporated|listed|ipo|issued|dividend|appointed|launched|signed|approved|adquiriu|aquisi(?:ç|c)(?:ão|ao)|fus[aã]o|constitui(?:ç|c)(?:ão|ao)|constitu[ií]da|fundada|abertura de capital|oferta p[uú]blica|dividendos|emiss[aã]o|nomeou|lan(?:ç|c)ou|aprovou)\b/i;
  const isoDate = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
  const brDate = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(20\d{2})\b/;
  const yearOnly = /\b(19\d{2}|20\d{2})\b/;
  const datedLines = text.split(/\n+/).map(line => line.trim()).filter(line => line.length >= 25 && line.length <= 450);
  const events: HistoryResult["events"] = [];
  for (const line of datedLines) {
    if (!eventWords.test(line)) continue;
    const iso = isoDate.exec(line), br = brDate.exec(line), year = !iso && !br ? yearOnly.exec(line) : null;
    if (!iso && !br && !year) continue;
    const date = iso?.[0] ?? (br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : year![0]);
    if (date.length === 10) { const timestamp = Date.parse(`${date}T00:00:00Z`); if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) continue; }
    const title = line.replace(/\s+/g, " ").slice(0, 110);
    if (events.some(event => event.date === date && event.title === title)) continue;
    events.push({ date, dateGranularity: date.length === 4 ? "year" : "day", title, category: "other", impact: null, sourceType: "filing", confidence: "medium", materiality: "implied", source: { section: "Dated filing excerpt", quote: line }, sourceRef: { kind: "excerpt", section: "Dated filing excerpt", quote: line } });
    if (events.length === 8) break;
  }
  return events;
}
