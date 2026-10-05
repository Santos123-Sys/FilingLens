import { describe, expect, it } from "vitest";
import { financialsSchema } from "../contracts/analysis";
import { computeFinancialMetrics } from "../contracts/financial-metrics";

const financials = financialsSchema.parse({ financials: {
  unit: "R$ milhões", years: ["2024", "2025"], revenue: [100, 120], netIncome: [10, 15],
  grossProfit: [40, 54], ebit: [20, 30], ebitda: [25, 36],
  incomeBeforeTax: [16, 25], incomeTaxExpense: [4, 6.25], reportedRoic: [10, 12],
  eps: null, grossMargin: null, operatingMargin: null, operatingCashFlow: [22, 31],
  capex: [-8, -11], freeCashFlow: null, dividends: null, buybacks: null,
  totalAssets: [200, 240], totalDebt: [80, 90], totalEquity: [100, 120], cash: [20, 30],
  currentAssets: [60, 70], currentLiabilities: [30, 35], shortTermDebt: [20, 30], interestExpense: [4, 5],
} }).financials;
const values = (key: string, overrides: Partial<typeof financials> = {}) => computeFinancialMetrics({ ...financials, ...overrides }).find(item => item.key === key)?.values;

describe("filing-only additional indicators", () => {
  it("reconciles nine indicators to financial statement inputs in consistent million units", () => {
    expect(values("workingCapital")).toEqual([30, 35]);
    expect(values("cashLiabilityCoverage")).toEqual([0.67, 0.86]);
    expect(values("debtToEquity")).toEqual([0.8, 0.75]);
    expect(values("debtToAssets")).toEqual([40, 37.5]);
    expect(values("shortTermDebtShare")).toEqual([25, 33.33]);
    expect(values("assetTurnover")).toEqual([null, 0.55]);
    expect(values("operatingCashFlowMargin")).toEqual([22, 25.83]);
    expect(values("earningsCashConversion")).toEqual([2.2, 2.07]);
    expect(values("capexIntensity")).toEqual([8, 9.17]);
    const computed = computeFinancialMetrics(financials);
    expect(computed.length).toBeGreaterThan(24);
    expect(() => financialsSchema.parse({ financials: { ...financials, computed } })).not.toThrow();
  });
  it("does not turn missing series, mismatched lengths or non-meaningful denominators into numbers", () => {
    expect(values("workingCapital", { currentAssets: null })).toBeUndefined();
    expect(values("cashLiabilityCoverage", { currentLiabilities: [0, -1] })).toBeUndefined();
    expect(values("debtToEquity", { totalEquity: [0, -120] })).toBeUndefined();
    expect(values("earningsCashConversion", { netIncome: [0, -15] })).toBeUndefined();
    expect(values("operatingCashFlowMargin", { revenue: [100] })).toBeUndefined();
    expect(values("shortTermDebtShare", { shortTermDebt: [-1, 100] })).toBeUndefined();
    expect(values("debtToEquity", { totalDebt: [0, 90] })).toEqual([0, 0.75]);
  });
  it("requires consecutive labelled annual balances for asset turnover, without annualizing quarters", () => {
    for (const years of [["2023", "2025"], ["Q1 2024", "Q1 2025"], ["YTD 2024", "YTD 2025"]]) {
      expect(values("assetTurnover", { years })).toBeUndefined();
    }
    expect(values("assetTurnover", { years: ["FY2024", "FY2025"] })).toEqual([null, 0.55]);
  });
  it("ports filing-only liquidity, period-end ROE/ROA, turnover and DuPont ratios", () => {
    const source = { ...financials, years: ["2024", "2025"], inventory: [10, 12], accountsReceivable: [20, 24], accountsPayable: [15, 18], costOfGoodsSold: [60, 66] };
    const computed = computeFinancialMetrics(source);
    const result = (key: string) => computed.find(item => item.key === key)?.values;
    expect(result("quickRatio")).toEqual([1.67, 1.66]);
    expect(result("cashRatio")).toEqual([0.67, 0.86]);
    expect(result("roePeriodEnd")).toEqual([10, 12.5]);
    expect(result("roaPeriodEnd")).toEqual([5, 6.25]);
    expect(result("inventoryTurnover")).toEqual([6, 5.5]);
    expect(result("daysInventoryOutstanding")).toEqual([61, 66.36]);
    expect(result("daysSalesOutstanding")?.[1]).toBe(73);
    expect(result("daysPayablesOutstanding")?.[1]).toBe(99.55);
    expect(result("dupontRoe")?.[1]).toBe(12.5);
    expect(result("dupontRoe")?.[1]).toBe(result("roePeriodEnd")?.[1]);
  });
  it("uses the disclosed quarter duration for operating days, without annualizing the quarter", () => {
    const quarter = computeFinancialMetrics({
      ...financials, years: ["2024Q1"], revenue: [100], costOfGoodsSold: [50], inventory: [25],
      accountsReceivable: [20], accountsPayable: [10], totalAssets: [200], totalEquity: [100], netIncome: [5],
    });
    expect(quarter.find(item => item.key === "daysInventoryOutstanding")?.values).toEqual([45.5]);
    expect(quarter.find(item => item.key === "assetTurnover")?.values).toBeUndefined();
  });
  it("defines revenue growth against the same disclosed quarter in the prior year", () => {
    const quarterly = computeFinancialMetrics({
      ...financials, years: ["2024Q1", "2024Q2", "2025Q1", "2025Q2", "2025Q3"],
      revenue: [100, 110, 120, 132, 140], netIncome: [10, 11, 12, 13, 14],
    });
    expect(quarterly.find(item => item.key === "revenueGrowth")?.values).toEqual([null, null, 20, 20, null]);
  });
});
