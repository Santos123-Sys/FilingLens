import { describe, expect, it } from "vitest";
import {
  analyzeDrivers, reverseDcfGrowth, runDcf, validateValuationInputs,
} from "./value-driver-intelligence";
import {
  APPLE_2026_CASE, APPLE_ANALYST_ASSUMPTIONS, APPLE_MARKET_EV_BN, APPLE_NET_DEBT_BN,
} from "../src/data/apple-value-driver-case";

describe("Value Driver Intelligence", () => {
  const p = APPLE_ANALYST_ASSUMPTIONS;
  it("anchors Apple inputs to exact SEC historical periods without annualizing Q3", () => {
    expect(APPLE_2026_CASE.annual.end).toBe("2025-09-27");
    expect(APPLE_2026_CASE.annual.revenueBn).toBe(416.161);
    expect(APPLE_2026_CASE.annual.operatingIncomeBn).toBe(133.05);
    expect(APPLE_2026_CASE.annual.simpleFcfBn).toBeCloseTo(98.767, 8);
    expect(APPLE_2026_CASE.quarterly.end).toBe("2026-06-27");
    expect(APPLE_2026_CASE.quarterly.revenueBn).toBe(109.417);
    expect(APPLE_2026_CASE.quarterly.disclosedTariffRefundMarginBenefitPp).toBe(2);
    expect(APPLE_2026_CASE.consensus.asOf).toBe("2026-10-12");
    expect(APPLE_2026_CASE.consensus.fy2026RevenueBn).toBe(477.85);
    expect(APPLE_2026_CASE.consensus.fy2027RevenueBn).toBe(528.21);
    expect(APPLE_2026_CASE.consensus.fy2026GrowthPct).toBeCloseTo((477.85/416.161-1)*100, 8);
    expect(APPLE_2026_CASE.consensus.fy2027GrowthPct).toBeCloseTo((528.21/477.85-1)*100, 8);
    expect(APPLE_2026_CASE.consensus.fy2026EpsUsd).toBe(8.83);
    expect(APPLE_2026_CASE.consensus.analystCount).toBe(40);
    expect(APPLE_2026_CASE.consensus.fy2026OperatingMarginPct).toBeCloseTo(156.4/477.85*100, 8);
    expect(APPLE_2026_CASE.consensus.fy2026FreeCashFlowBn).toBe(143.68);
  });
  it("reconciles sourced debt and cash, including noncurrent marketable securities", () => {
    expect(APPLE_NET_DEBT_BN).toBeCloseTo(-62.173, 8);
    expect(APPLE_MARKET_EV_BN).toBeCloseTo(4850.8118831232, 6);
  });
  it("reproduces explicit FCFF and terminal-value arithmetic", () => {
    const result = runDcf(p);
    expect(result.years).toHaveLength(10);
    expect(result.years[0].revenueBn).toBeCloseTo(457.7771, 4);
    expect(result.pvForecastBn).toBeCloseTo(988.591393994, 6);
    expect(result.pvTerminalBn).toBeCloseTo(2017.0326850725, 6);
    expect(result.enterpriseValueBn).toBeCloseTo(3005.6240790669, 6);
    expect(result.equityValueBn).toBeCloseTo(3067.7970790669, 6);
    expect(result.impliedSharePrice).toBeCloseTo(210.2068769323, 6);
    expect(result.terminalSharePct).toBeGreaterThan(60);
    expect(result.years[9].growthPct).toBeCloseTo(p.terminalGrowthPct);
  });
  it("reverse DCF solves growth consistent with the observed market snapshot", () => {
    const implied = reverseDcfGrowth(p, APPLE_MARKET_EV_BN);
    expect(implied.status).toBe("solved");
    expect(implied.impliedGrowthPct).toBeCloseTo(18.49856925192, 5);
    const reproduced = runDcf({ ...p, growthPct: implied.impliedGrowthPct! });
    expect(reproduced.enterpriseValueBn).toBeCloseTo(APPLE_MARKET_EV_BN, 6);
  });
  it("does not invent a market implied forecast when a quote is missing or unbracketed", () => {
    expect(reverseDcfGrowth(p, null).status).toBe("missing-market");
    expect(reverseDcfGrowth(p, 1e7).status).toBe("unreachable");
  });
  it("moves valuation in economically consistent directions", () => {
    const base = runDcf(p).enterpriseValueBn;
    expect(runDcf({ ...p, waccPct: p.waccPct + 1 }).enterpriseValueBn).toBeLessThan(base);
    expect(runDcf({ ...p, operatingMarginPct: p.operatingMarginPct + 1 }).enterpriseValueBn).toBeGreaterThan(base);
    expect(runDcf({ ...p, reinvestmentPct: p.reinvestmentPct + 5 }).enterpriseValueBn).toBeLessThan(base);
    const drivers = analyzeDrivers(p);
    expect(drivers).toHaveLength(7);
    expect(drivers.every(d => d.uncertainty === "unrated")).toBe(true);
    expect(drivers.every((d, i) => i === 0 || drivers[i - 1].maxAbsImpactPct >= d.maxAbsImpactPct)).toBe(true);
  });
  it("rejects invalid perpetuities, nonfinite inputs and implausible rates", () => {
    expect(() => validateValuationInputs({ ...p, waccPct: 3, terminalGrowthPct: 3 })).toThrow();
    expect(() => runDcf({ ...p, revenueBn: Number.NaN })).toThrow();
    expect(() => runDcf({ ...p, terminalRoicPct: 2 })).toThrow();
    expect(() => runDcf({ ...p, reinvestmentPct: -1 })).toThrow();
  });
});
