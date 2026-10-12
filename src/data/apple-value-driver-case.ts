import type { ValuationInputs } from "../../contracts/value-driver-intelligence";

/**
 * Reproducible real-data acceptance case (snapshot, NOT live prices).
 * Financials in USD billions converted from SEC filing amounts in USD millions.
 * The forecast parameters are analyst simulations, NOT company guidance or consensus.
 */
export const APPLE_2026_CASE = {
  identity: { name: "Apple Inc.", ticker: "AAPL", country: "US", currency: "USD" },
  market: {
    asOf: "2026-10-09",
    closeUsd: 336.64,
    sharesBn: 14.59418038,
    marketCapBn: 4912.9848831232,
    url: "https://stockanalysis.com/stocks/aapl/history/",
    sharesUrl: "https://stockanalysis.com/stocks/aapl/statistics/",
    method: "Closing share price × vendor-reported shares outstanding; excludes after-hours trading.",
  },
  annual: {
    period: "FY2025",
    end: "2025-09-27",
    revenueBn: 416.161,
    operatingIncomeBn: 133.050,
    operatingMarginPct: 133.050 / 416.161 * 100,
    operatingCashFlowBn: 111.482,
    cashCapexBn: 12.715,
    simpleFcfBn: 111.482 - 12.715,
    iphoneSalesBn: 209.586,
    servicesSalesBn: 109.158,
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
  },
  quarterly: {
    period: "FY2026 Q3",
    end: "2026-06-27",
    revenueBn: 109.417,
    priorRevenueBn: 94.036,
    iphoneSalesBn: 54.252,
    servicesSalesBn: 30.739,
    grossMarginPct: 50.1,
    disclosedTariffRefundMarginBenefitPp: 2,
    yearToDateRevenueBn: 364.357,
    priorYearToDateRevenueBn: 313.695,
    yearToDateOperatingCashFlowBn: 116.996,
    yearToDateCashCapexBn: 6.799,
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
  },
  consensus: {
    asOf: "2026-10-12",
    // A dated external forecast observation, not reported Apple financials.
    fy2026RevenueBn: 477.85,
    fy2027RevenueBn: 528.21,
    fy2026GrowthPct: (477.85 / 416.161 - 1) * 100,
    fy2027GrowthPct: (528.21 / 477.85 - 1) * 100,
    fy2026EpsUsd: 8.83,
    fy2026OperatingIncomeBn: 156.40,
    fy2026OperatingMarginPct: (156.40 / 477.85) * 100,
    fy2026ReportedConsensusGrossMarginPct: 48.60,
    fy2026FreeCashFlowBn: 143.68,
    analystCount: 40,
    source: "S&P Global Market Intelligence / TipRanks, republished by Stock Analysis",
    url: "https://stockanalysis.com/stocks/aapl/forecast/",
    corroborationUrl: "https://finance.yahoo.com/quote/AAPL/analysis/",
    note: "External near-term analyst estimates are not SEC historical results, Apple guidance, or the model-implied reverse-DCF multi-year growth rate.",
  },
  capitalBridge: {
    asOf: "2026-06-27",
    commercialPaperBn: 1.997,
    currentTermDebtBn: 11.007,
    longTermDebtBn: 71.340,
    cashBn: 39.544,
    currentMarketableSecuritiesBn: 22.855,
    nonCurrentMarketableSecuritiesBn: 84.118,
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
    limitation: "June 2026 financial position is paired with October 2026 equity value. It is not an October 2026 debt/cash snapshot.",
  },
} as const;

const b = APPLE_2026_CASE.capitalBridge;
export const APPLE_NET_DEBT_BN =
  b.commercialPaperBn + b.currentTermDebtBn + b.longTermDebtBn -
  b.cashBn - b.currentMarketableSecuritiesBn - b.nonCurrentMarketableSecuritiesBn;
export const APPLE_MARKET_EV_BN = APPLE_2026_CASE.market.marketCapBn + APPLE_NET_DEBT_BN;

/**
 * Chosen research assumptions, intentionally separate from empirical facts.
 * Reinvestment = net reinvestment as a proportion of modeled NOPAT, NOT reported capex.
 * The initial growth rate persists for half the explicit forecast then fades.
 */
export const APPLE_ANALYST_ASSUMPTIONS: ValuationInputs = {
  revenueBn: APPLE_2026_CASE.annual.revenueBn,
  growthPct: 10,
  operatingMarginPct: 33,
  cashTaxPct: 18,
  reinvestmentPct: 17,
  waccPct: 8,
  terminalGrowthPct: 3,
  terminalRoicPct: 25,
  netDebtBn: APPLE_NET_DEBT_BN,
  sharesBn: APPLE_2026_CASE.market.sharesBn,
  horizonYears: 10,
};
