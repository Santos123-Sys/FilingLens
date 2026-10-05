export type FilingNumberLocale = "pt-BR" | "en-US";

function parseNumericToken(token: string): number | null {
  const raw = token.trim();
  if (!raw || !/[0-9]/.test(raw)) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;

  if (hasComma && hasDot) {
    // The final separator is the decimal separator in a fully formatted value.
    normalized = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replaceAll(".", "").replace(",", ".")
      : raw.replaceAll(",", "");
  } else if (hasComma) {
    const fraction = raw.split(",").at(-1) ?? "";
    normalized = fraction.length <= 2 ? raw.replace(",", ".") : raw.replaceAll(",", "");
  } else if (hasDot) {
    const fraction = raw.split(".").at(-1) ?? "";
    normalized = fraction.length <= 2 ? raw : raw.replaceAll(".", "");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Formats a standalone number using the filing's reporting convention. */
export function formatFilingNumber(
  value: number,
  locale: FilingNumberLocale,
  maximumFractionDigits = 2,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

/**
 * Formats numeric fragments in an extracted KPI string. This is deliberately
 * limited to KPI display fields so filing identifiers, dates and source refs
 * are never rewritten.
 */
export function formatKpiValue(value: string, locale: FilingNumberLocale): string {
  if (locale !== "pt-BR") return value;

  return value.replace(/(?<![A-Za-z0-9])[-+]?\d+(?:[.,]\d+)*(?![A-Za-z0-9])/g, token => {
    const parsed = parseNumericToken(token);
    return parsed === null ? token : formatFilingNumber(parsed, locale);
  });
}
