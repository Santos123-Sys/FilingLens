import type { EvidenceReference, FinancialsResult } from "./analysis";

type Financials = FinancialsResult["financials"];
type ComputedMetric = NonNullable<Financials["computed"]>[number];

function aligned(
  values: number[] | null | undefined,
  periods: string[],
): Array<number | null> {
  if (!Array.isArray(values) || values.length !== periods.length) {
    return periods.map(() => null);
  }
  return values.map(value => Number.isFinite(value) ? value : null);
}

function divide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function rounded(value: number | null, decimals = 2): number | null {
  return value === null ? null : Number(value.toFixed(decimals));
}

function parsePeriod(value: string): { year: number; quarter: number | null } | null {
  const text = value.trim();
  const yearFirst = /^(?:FY\s*)?(\d{4})\s*[- ]?\s*[Qq]([1-4])$/i.exec(text);
  const quarterFirst = /^[Qq]([1-4])\s+(\d{4})$/i.exec(text);
  if (yearFirst) return { year: Number(yearFirst[1]), quarter: Number(yearFirst[2]) };
  if (quarterFirst) return { year: Number(quarterFirst[2]), quarter: Number(quarterFirst[1]) };
  const annual = /^(?:FY\s*)?(\d{4})$/i.exec(text);
  return annual ? { year: Number(annual[1]), quarter: null } : null;
}

function sourcesFor(financials: Financials, keys: string[]): EvidenceReference[] {
  return (financials.evidence ?? [])
    .filter(item => keys.includes(item.metric))
    .map(item => item.source)
    .filter((source, index, list) =>
      list.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(source)) === index,
    )
    .slice(0, 8);
}

function metric(
  financials: Financials,
  key: string,
  values: Array<number | null>,
  unit: ComputedMetric["unit"],
  type: ComputedMetric["type"],
  formula: string | null,
  components: string[],
  note?: string,
  relationship?: { numerator: string; denominator: string },
): ComputedMetric {
  const sources = sourcesFor(financials, components);
  return {
    key,
    values,
    unit,
    type,
    formula,
    components,
    numerator: relationship?.numerator ?? components[0] ?? null,
    denominator: relationship?.denominator ?? (components.length > 1 ? components.at(-1) ?? null : null),
    periods: financials.years,
    sources,
    confidence: components.every(key => (financials.evidence ?? []).some(item => item.metric === key)) ? "high" : "medium",
    note: note ?? null,
  };
}

/** Builds reproducible ratios only from period-aligned reported inputs. */
export function computeFinancialMetrics(financials: Financials): ComputedMetric[] {
  const periods = financials.years;
  const revenue = aligned(financials.revenue, periods);
  const grossProfit = aligned(financials.grossProfit, periods);
  const ebit = aligned(financials.ebit, periods);
  const ebitda = aligned(financials.ebitda, periods);
  const netIncome = aligned(financials.netIncome, periods);
  const operatingCashFlow = aligned(financials.operatingCashFlow, periods);
  const capex = aligned(financials.capex, periods);
  const reportedFcf = aligned(financials.freeCashFlow, periods);
  const totalDebt = aligned(financials.totalDebt, periods);
  const cash = aligned(financials.cash, periods);
  const currentAssets = aligned(financials.currentAssets, periods);
  const currentLiabilities = aligned(financials.currentLiabilities, periods);
  const totalAssets = aligned(financials.totalAssets, periods);
  const totalEquity = aligned(financials.totalEquity, periods);
  const interestExpense = aligned(financials.interestExpense, periods);
  const inventory = aligned(financials.inventory, periods);
  const receivables = aligned(financials.accountsReceivable, periods);
  const payables = aligned(financials.accountsPayable, periods);
  const costOfGoodsSold = aligned(financials.costOfGoodsSold, periods);
  const incomeBeforeTax = aligned(financials.incomeBeforeTax, periods);
  const incomeTaxExpense = aligned(financials.incomeTaxExpense, periods);
  const shortTermDebt = aligned(financials.shortTermDebt, periods);
  const reportedRoic = aligned(financials.reportedRoic, periods);

  const growth = (values: Array<number | null>) => values.map((value, index) => {
    const current = parsePeriod(periods[index]);
    if (!current || value === null) return null;
    let priorIndex = -1;
    for (let candidate = index - 1; candidate >= 0; candidate--) {
      const prior = parsePeriod(periods[candidate]);
      if (prior?.quarter === current.quarter && prior.year === current.year - 1) {
        priorIndex = candidate;
        break;
      }
    }
    const priorValue = priorIndex >= 0 ? values[priorIndex] : null;
    return priorValue === null || priorValue === 0 ? null : rounded((value - priorValue) / Math.abs(priorValue) * 100);
  });
  const netDebt = totalDebt.map((debt, index) =>
    debt === null || cash[index] === null ? null : rounded(debt - cash[index]!),
  );
  const calculatedFcf = operatingCashFlow.map((ocf, index) =>
    ocf === null || capex[index] === null ? null : rounded(ocf - Math.abs(capex[index]!)),
  );
  const fcf = reportedFcf.some(value => value !== null) ? reportedFcf : calculatedFcf;
  const fcfType: ComputedMetric["type"] = reportedFcf.some(value => value !== null) ? "reported" : "calculated";
  const effectiveTaxRate = incomeBeforeTax.map((pretaxIncome, index) => {
    const taxExpense = incomeTaxExpense[index];
    if (pretaxIncome === null || taxExpense === null || pretaxIncome <= 0 || taxExpense < 0) return null;
    const value = divide(taxExpense, pretaxIncome);
    return value === null || value > 1 ? null : rounded(value * 100);
  });
  const investedCapital = totalDebt.map((debt, index) => {
    const equity = totalEquity[index];
    const cashBalance = cash[index];
    return debt === null || equity === null || cashBalance === null
      ? null
      : rounded(debt + equity - cashBalance);
  });
  const roic = ebit.map((operatingIncome, index) => {
    const taxRate = effectiveTaxRate[index];
    const openingCapital = index > 0 ? investedCapital[index - 1] : null;
    const closingCapital = investedCapital[index];
    if (operatingIncome === null || taxRate === null || openingCapital === null || closingCapital === null) return null;
    const averageCapital = (openingCapital + closingCapital) / 2;
    if (averageCapital <= 0) return null;
    return rounded((operatingIncome * (1 - taxRate / 100) / averageCapital) * 100);
  });
  const nopat = ebit.map((operatingIncome, index) =>
    operatingIncome === null || effectiveTaxRate[index] === null
      ? null
      : rounded(operatingIncome * (1 - effectiveTaxRate[index]! / 100)),
  );
  const averageInvestedCapital = investedCapital.map((closingCapital, index) =>
    index === 0 || closingCapital === null || investedCapital[index - 1] === null
      ? null
      : rounded((closingCapital + investedCapital[index - 1]!) / 2),
  );

  const positiveRatio = (numerator: number | null, denominator: number | null, scale = 1) =>
    denominator !== null && denominator > 0 ? rounded(divide(numerator, denominator) === null ? null : divide(numerator, denominator)! * scale) : null;
  const annualYear = (period: string) => /^(?:FY\s*)?(\d{4})$/.exec(period)?.[1];
  const daysInPeriod = (period: string): number | null => {
    const annual = annualYear(period);
    if (annual) {
      const year = Number(annual);
      return new Date(Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)).getTime() / 86_400_000;
    }
    const yearFirstQuarter = /^(\d{4})\s*[- ]?\s*[Qq]([1-4])$/.exec(period);
    const quarterFirst = /^[Qq]([1-4])\s+(\d{4})$/.exec(period);
    if (!yearFirstQuarter && !quarterFirst) return null;
    const year = Number(yearFirstQuarter ? yearFirstQuarter[1] : quarterFirst![2]);
    const quarter = Number(yearFirstQuarter ? yearFirstQuarter[2] : quarterFirst![1]);
    const startMonth = (quarter - 1) * 3;
    return (Date.UTC(year, startMonth + 3, 1) - Date.UTC(year, startMonth, 1)) / 86_400_000;
  };
  const assetTurnover = revenue.map((value, index) => {
    const current = annualYear(periods[index]);
    const prior = index > 0 ? annualYear(periods[index - 1]) : undefined;
    if (!current || !prior || Number(current) - Number(prior) !== 1 || totalAssets[index] === null || totalAssets[index - 1] === null) return null;
    return positiveRatio(value, (totalAssets[index]! + totalAssets[index - 1]!) / 2);
  });
  const assetTurnoverPeriodEnd = revenue.map((value, index) => positiveRatio(value, totalAssets[index]));
  const periodEndRoe = netIncome.map((value, index) => positiveRatio(value, totalEquity[index], 100));
  const periodEndRoa = netIncome.map((value, index) => positiveRatio(value, totalAssets[index], 100));
  const equityMultiplier = totalAssets.map((value, index) => positiveRatio(value, totalEquity[index]));
  const workingCapital = currentAssets.map((value, index) => value === null || currentLiabilities[index] === null ? null : rounded(value - currentLiabilities[index]!));
  const quickRatio = currentAssets.map((value, index) => {
    const liabilities = currentLiabilities[index];
    const stock = inventory[index];
    return value === null || stock === null || liabilities === null || liabilities <= 0
      ? null
      : positiveRatio(value - stock, liabilities);
  });
  const cashRatio = cash.map((value, index) => positiveRatio(value, currentLiabilities[index]));
  const inventoryTurnover = costOfGoodsSold.map((value, index) => positiveRatio(value, inventory[index]));
  const receivablesTurnover = revenue.map((value, index) => positiveRatio(value, receivables[index]));
  const payablesTurnover = costOfGoodsSold.map((value, index) => positiveRatio(value, payables[index]));
  const periodDaysRatio = (numerator: number | null, denominator: number | null, index: number) => {
    const days = daysInPeriod(periods[index]);
    return days === null || denominator === null || denominator <= 0 || numerator === null
      ? null
      : rounded(days / (numerator / denominator));
  };
  const daysInventoryOutstanding = costOfGoodsSold.map((value, index) => periodDaysRatio(value, inventory[index], index));
  const daysSalesOutstanding = revenue.map((value, index) => periodDaysRatio(value, receivables[index], index));
  const daysPayablesOutstanding = costOfGoodsSold.map((value, index) => periodDaysRatio(value, payables[index], index));
  const workingCapitalTurnover = revenue.map((value, index) => positiveRatio(value, workingCapital[index]));
  const netMarginForDupont = netIncome.map((value, index) => rounded(divide(value, revenue[index]) === null ? null : divide(value, revenue[index])! * 100));
  const dupontRoe = netMarginForDupont.map((margin, index) => margin === null || assetTurnoverPeriodEnd[index] === null || equityMultiplier[index] === null
    ? null
    : rounded(margin * assetTurnoverPeriodEnd[index]! * equityMultiplier[index]!));
  const metrics: ComputedMetric[] = [
    metric(financials, "cashLiabilityCoverage", cash.map((v, i) => positiveRatio(v, currentLiabilities[i])), "multiple", "calculated", "Cash and cash equivalents ÷ Current liabilities", ["cash", "currentLiabilities"], "Cash-only coverage; excludes separately reported short-term investments. Not the broader cash ratio."),
    metric(financials, "workingCapital", currentAssets.map((v, i) => v === null || currentLiabilities[i] === null ? null : rounded(v - currentLiabilities[i]!)), "currency", "calculated", "Current assets − Current liabilities", ["currentAssets", "currentLiabilities"], "Balance-sheet net working capital; not operating working capital."),
    metric(financials, "quickRatio", quickRatio, "ratio", "calculated", "(Current assets − inventory) ÷ Current liabilities", ["currentAssets", "inventory", "currentLiabilities"]),
    metric(financials, "cashRatio", cashRatio, "ratio", "calculated", "Cash and cash equivalents ÷ Current liabilities", ["cash", "currentLiabilities"]),
    metric(financials, "debtToEquity", totalDebt.map((v, i) => positiveRatio(v, totalEquity[i])), "multiple", "calculated", "Interest-bearing debt ÷ Total equity", ["totalDebt", "totalEquity"], "Not meaningful with zero or negative equity."),
    metric(financials, "debtToAssets", totalDebt.map((v, i) => positiveRatio(v, totalAssets[i], 100)), "percent", "calculated", "Interest-bearing debt ÷ Total assets × 100", ["totalDebt", "totalAssets"]),
    metric(financials, "shortTermDebtShare", shortTermDebt.map((v, i) => v === null || totalDebt[i] === null || v < 0 || v > totalDebt[i]! ? null : positiveRatio(v, totalDebt[i], 100)), "percent", "calculated", "Short-term debt ÷ Total debt × 100", ["shortTermDebt", "totalDebt"], "Requires consistent debt scope and short-term debt no greater than total debt."),
    metric(financials, "assetTurnover", assetTurnover, "multiple", "calculated", "Annual revenue ÷ Average opening and closing total assets", ["revenue", "totalAssets"], "Only consecutive explicitly labelled fiscal years. No quarterly annualization or substitution of closing assets."),
    metric(financials, "assetTurnoverPeriodEnd", assetTurnoverPeriodEnd, "multiple", "calculated", "Revenue for disclosed period ÷ period-end total assets", ["revenue", "totalAssets"], "Period-end balance basis, matching the attached ratio toolkit; not an annualized return."),
    metric(financials, "equityMultiplier", equityMultiplier, "multiple", "calculated", "Period-end total assets ÷ period-end total equity", ["totalAssets", "totalEquity"], "Period-end balance basis."),
    metric(financials, "roePeriodEnd", periodEndRoe, "percent", "calculated", "Net income ÷ period-end total equity × 100", ["netIncome", "totalEquity"], "Period-end equity basis, matching the attached ratio toolkit. Kept separate from average-balance ROE."),
    metric(financials, "roaPeriodEnd", periodEndRoa, "percent", "calculated", "Net income ÷ period-end total assets × 100", ["netIncome", "totalAssets"], "Period-end asset basis, matching the attached ratio toolkit. Kept separate from average-balance ROA."),
    metric(financials, "inventoryTurnover", inventoryTurnover, "multiple", "calculated", "Cost of goods sold ÷ period-end inventory", ["costOfGoodsSold", "inventory"], "Disclosed-period turnover; not annualized."),
    metric(financials, "daysInventoryOutstanding", daysInventoryOutstanding, "days", "calculated", "Disclosed period days ÷ inventory turnover", ["costOfGoodsSold", "inventory"], "Only annual or explicitly labelled quarter periods; no quarterly annualization."),
    metric(financials, "receivablesTurnover", receivablesTurnover, "multiple", "calculated", "Revenue for disclosed period ÷ period-end accounts receivable", ["revenue", "accountsReceivable"], "Disclosed-period turnover; not annualized."),
    metric(financials, "daysSalesOutstanding", daysSalesOutstanding, "days", "calculated", "Disclosed period days ÷ receivables turnover", ["revenue", "accountsReceivable"], "Only annual or explicitly labelled quarter periods; no quarterly annualization."),
    metric(financials, "payablesTurnover", payablesTurnover, "multiple", "calculated", "Cost of goods sold ÷ period-end accounts payable", ["costOfGoodsSold", "accountsPayable"], "Disclosed-period turnover; not annualized."),
    metric(financials, "daysPayablesOutstanding", daysPayablesOutstanding, "days", "calculated", "Disclosed period days ÷ payables turnover", ["costOfGoodsSold", "accountsPayable"], "Only annual or explicitly labelled quarter periods; no quarterly annualization."),
    metric(financials, "workingCapitalTurnover", workingCapitalTurnover, "multiple", "calculated", "Revenue for disclosed period ÷ positive net working capital", ["revenue", "currentAssets", "currentLiabilities"], "Suppressed if net working capital is zero or negative."),
    metric(financials, "dupontNetMargin", netMarginForDupont, "percent", "calculated", "Net income ÷ revenue × 100", ["netIncome", "revenue"]),
    metric(financials, "dupontRoe", dupontRoe, "percent", "calculated", "Net margin × period-end asset turnover × period-end equity multiplier", ["netIncome", "revenue", "totalAssets", "totalEquity"], "DuPont decomposition using period-end balances; does not use market data."),
    metric(financials, "operatingCashFlowMargin", operatingCashFlow.map((v, i) => positiveRatio(v, revenue[i], 100)), "percent", "calculated", "Operating cash flow ÷ Revenue × 100", ["operatingCashFlow", "revenue"]),
    metric(financials, "earningsCashConversion", operatingCashFlow.map((v, i) => positiveRatio(v, netIncome[i])), "multiple", "calculated", "Operating cash flow ÷ Net income", ["operatingCashFlow", "netIncome"], "Not meaningful with zero or negative net income. Cash-flow classification can differ under IFRS and US GAAP."),
    metric(financials, "capexIntensity", capex.map((v, i) => positiveRatio(v === null ? null : Math.abs(v), revenue[i], 100)), "percent", "calculated", "Absolute capital expenditure ÷ Revenue × 100", ["capex", "revenue"]),
    metric(financials, "revenueGrowth", growth(revenue), "percent", "calculated", "(Revenue ÷ prior-period Revenue) − 1", ["revenue"]),
    metric(financials, "netIncomeGrowth", growth(netIncome), "percent", "calculated", "(Net income ÷ prior-period Net income) − 1", ["netIncome"]),
    metric(financials, "grossMarginCalculated", grossProfit.map((value, index) => rounded(divide(value, revenue[index]) === null ? null : divide(value, revenue[index])! * 100)), "percent", "calculated", "Gross profit ÷ Revenue", ["grossProfit", "revenue"]),
    metric(financials, "ebitMargin", ebit.map((value, index) => rounded(divide(value, revenue[index]) === null ? null : divide(value, revenue[index])! * 100)), "percent", "calculated", "EBIT ÷ Revenue", ["ebit", "revenue"]),
    metric(financials, "ebitdaMargin", ebitda.map((value, index) => rounded(divide(value, revenue[index]) === null ? null : divide(value, revenue[index])! * 100)), "percent", "calculated", "EBITDA ÷ Revenue", ["ebitda", "revenue"]),
    metric(financials, "netMargin", netIncome.map((value, index) => rounded(divide(value, revenue[index]) === null ? null : divide(value, revenue[index])! * 100)), "percent", "calculated", "Net income ÷ Revenue", ["netIncome", "revenue"]),
    metric(financials, "netDebt", netDebt, "currency", "calculated", "Total debt − Cash and cash equivalents", ["totalDebt", "cash"]),
    metric(financials, "grossDebtToEbitda", totalDebt.map((value, index) => ebitda[index] !== null && ebitda[index]! > 0 ? rounded(divide(value, ebitda[index])) : null), "multiple", "calculated", "Total debt ÷ EBITDA", ["totalDebt", "ebitda"], "N/M when EBITDA is zero or negative."),
    metric(financials, "netDebtToEbitda", netDebt.map((value, index) => ebitda[index] !== null && ebitda[index]! > 0 ? rounded(divide(value, ebitda[index])) : null), "multiple", "calculated", "Net debt ÷ EBITDA", ["totalDebt", "cash", "ebitda"], "N/M when EBITDA is zero or negative."),
    metric(financials, "freeCashFlowCalculated", fcf, "currency", fcfType, fcfType === "reported" ? null : "Operating cash flow − Capex", ["operatingCashFlow", "capex", "freeCashFlow"]),
    metric(financials, "fcfMargin", fcf.map((value, index) => rounded(divide(value, revenue[index]) === null ? null : divide(value, revenue[index])! * 100)), "percent", "calculated", "Free cash flow ÷ Revenue", ["freeCashFlow", "operatingCashFlow", "capex", "revenue"]),
    metric(financials, "fcfConversion", fcf.map((value, index) => ebitda[index] !== null && ebitda[index]! > 0 ? rounded(divide(value, ebitda[index]) === null ? null : divide(value, ebitda[index])! * 100) : null), "percent", "calculated", "Free cash flow ÷ EBITDA", ["freeCashFlow", "operatingCashFlow", "capex", "ebitda"]),
    metric(financials, "currentRatio", currentAssets.map((value, index) => positiveRatio(value, currentLiabilities[index])), "ratio", "calculated", "Current assets ÷ Current liabilities", ["currentAssets", "currentLiabilities"]),
    metric(financials, "interestCoverage", ebit.map((value, index) => interestExpense[index] !== null && Math.abs(interestExpense[index]!) > 0 ? rounded(divide(value, Math.abs(interestExpense[index]!))) : null), "multiple", "calculated", "EBIT ÷ Net interest expense", ["ebit", "interestExpense"]),
    metric(financials, "roe", netIncome.map((value, index) => index === 0 || totalEquity[index] === null || totalEquity[index - 1] === null ? null : rounded(divide(value, (totalEquity[index]! + totalEquity[index - 1]!) / 2) === null ? null : divide(value, (totalEquity[index]! + totalEquity[index - 1]!) / 2)! * 100)), "percent", "calculated", "Net income ÷ average equity", ["netIncome", "totalEquity"], "Uses average opening and closing equity."),
    metric(financials, "roa", netIncome.map((value, index) => index === 0 || totalAssets[index] === null || totalAssets[index - 1] === null ? null : rounded(divide(value, (totalAssets[index]! + totalAssets[index - 1]!) / 2) === null ? null : divide(value, (totalAssets[index]! + totalAssets[index - 1]!) / 2)! * 100)), "percent", "calculated", "Net income ÷ average total assets", ["netIncome", "totalAssets"], "Uses average opening and closing assets."),
    metric(financials, "effectiveTaxRate", effectiveTaxRate, "percent", "calculated", "Income tax expense ÷ Income before tax", ["incomeTaxExpense", "incomeBeforeTax"]),
    metric(financials, "nopat", nopat, "currency", "calculated", "EBIT × (1 − reported effective tax rate)", ["ebit", "incomeTaxExpense", "incomeBeforeTax"]),
    metric(financials, "investedCapital", investedCapital, "currency", "calculated", "Total debt + Total equity − Cash and cash equivalents", ["totalDebt", "totalEquity", "cash"]),
    metric(financials, "averageInvestedCapital", averageInvestedCapital, "currency", "calculated", "(Opening invested capital + closing invested capital) ÷ 2", ["totalDebt", "totalEquity", "cash"]),
    metric(financials, "roic", roic, "percent", "calculated", "NOPAT ÷ average invested capital", ["ebit", "incomeTaxExpense", "incomeBeforeTax", "totalDebt", "totalEquity", "cash"], "NOPAT = EBIT × (1 − reported effective tax rate). Invested capital = total debt + total equity − cash; uses average opening and closing invested capital.", { numerator: "nopat", denominator: "averageInvestedCapital" }),
    metric(financials, "reportedRoic", reportedRoic, "percent", "reported", null, ["reportedRoic"], "Company-defined ROIC. It is presented separately and is not substituted for the system-calculated operating ROIC."),
  ];

  return metrics.filter(item => item.values.some(value => value !== null));
}

export function computedMetric(
  financials: Financials,
  key: string,
): ComputedMetric | undefined {
  return (financials.computed ?? []).find(metric => metric.key === key);
}
