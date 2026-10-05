import type {
  FilingClassification,
  Jurisdiction,
  MetadataResult,
} from "../contracts/analysis";

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includes(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function detectFilingType(text: string, jurisdiction: Jurisdiction): string {
  if (jurisdiction === "br") {
    if (includes(text, /formulario\s+de\s+referencia/)) return "Formulário de Referência";
    if (includes(text, /demonstracoes\s+financeiras\s+padronizadas|\bdfp\b/)) return "DFP";
    if (includes(text, /informacoes\s+trimestrais|\bitr\b/)) return "ITR";
    if (includes(text, /fato\s+relevante/)) return "Fato Relevante";
    return "Documento CVM";
  }

  const match = text.match(/\b(10-k|10-q|8-k|s-1|20-f)\b/i);
  return match?.[1]?.toUpperCase() ?? "SEC filing";
}

export function classifyFiling(
  text: string,
  preferred?: Jurisdiction,
): FilingClassification {
  const sample = normalized(text.slice(0, 70_000));
  const brSignals = [
    ["CVM", /comissao\s+de\s+valores\s+mobiliarios|\bcvm\b/],
    ["CNPJ", /\bcnpj\b|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/],
    ["CVM document class", /formulario\s+de\s+referencia|demonstracoes\s+financeiras\s+padronizadas|informacoes\s+trimestrais|fato\s+relevante/],
    ["Portuguese financial headings", /balanco\s+patrimonial|demonstracao\s+do\s+resultado|fluxos?\s+de\s+caixa/],
  ] as const;
  const usSignals = [
    ["SEC", /securities\s+and\s+exchange\s+commission|\bsec\b/],
    ["CIK", /central\s+index\s+key|\bcik\b/],
    ["SEC form", /form\s+(10-k|10-q|8-k|s-1|20-f)|\b(10-k|10-q|8-k|s-1|20-f)\b/],
    ["EDGAR item structure", /item\s+1a\.?\s+risk\s+factors|item\s+7\.?\s+management|item\s+8\.?\s+financial/],
  ] as const;

  const matchedBr = brSignals.filter(([, re]) => includes(sample, re));
  const matchedUs = usSignals.filter(([, re]) => includes(sample, re));
  const brScore = matchedBr.length;
  const usScore = matchedUs.length;
  const jurisdiction: Jurisdiction = brScore === usScore
    ? (preferred ?? (sample.includes("portugues") ? "br" : "us"))
    : brScore > usScore ? "br" : "us";
  const winner = Math.max(brScore, usScore);
  const loser = Math.min(brScore, usScore);
  const isTwentyF = includes(sample, /\b20-f\b/);
  const confidence = Math.max(0.35, Math.min(0.99, 0.45 + winner * 0.13 - loser * 0.08 - (isTwentyF ? 0.18 : 0)));
  const needsConfirmation = confidence < 0.75 || Math.abs(brScore - usScore) <= 1 || isTwentyF;

  return {
    jurisdiction,
    filingType: detectFilingType(sample, jurisdiction),
    confidence: Number(confidence.toFixed(2)),
    needsConfirmation,
    signals: (jurisdiction === "br" ? matchedBr : matchedUs).map(([label]) => label),
  };
}

export function metadataFallback(
  classification: FilingClassification,
): MetadataResult["metadata"] {
  return {
    jurisdiction: classification.jurisdiction,
    filingType: classification.filingType,
    reportingPeriod: null,
    filedAt: null,
    confidence: classification.confidence,
    cnpj: null,
    cvmDocumentClass: classification.jurisdiction === "br" ? classification.filingType : null,
    registryData: null,
    cik: null,
    sicCode: null,
    fiscalYearEnd: null,
    stateOfIncorporation: null,
    sources: [],
  };
}
