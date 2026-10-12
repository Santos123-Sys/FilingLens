import { describe, expect, it } from "vitest";
import { APPLE_ANALYST_ASSUMPTIONS } from "../src/data/apple-value-driver-case";
import { DEFAULT_RISK_RANGES, simulateValueDriverRisk } from "./value-driver-risk";
import { runDcf } from "./value-driver-intelligence";

describe("scenario-conditional value driver risk", () => {
  const p=APPLE_ANALYST_ASSUMPTIONS;
  it("has deterministic quantiles, histogram accounting, and finite scores",()=>{
    const x=simulateValueDriverRisk(p,{draws:300,seed:3025});
    const y=simulateValueDriverRisk(p,{draws:300,seed:3025});
    expect(x).toEqual(y);
    expect(x.accepted).toBe(300);
    expect(x.p10EvBn).toBeLessThan(x.p50EvBn);
    expect(x.p50EvBn).toBeLessThan(x.p90EvBn);
    expect(x.histogram.reduce((sum,h)=>sum+h.count,0)).toBe(300);
    expect(x.driverRiskPriority.length).toBe(7);
    expect(x.assumptionStatus).toBe("scenario_conditional_not_calibrated");
    expect(x.probabilityBelowObservedEV).toBeNull();
  });
  it("degenerates to the exact deterministic DCF if every assumed range is zero",()=>{
    const noUncertainty=DEFAULT_RISK_RANGES.map(x=>({...x,halfWidthPp:0}));
    const x=simulateValueDriverRisk(p,{draws:200,distributions:noUncertainty,observedEnterpriseValueBn:runDcf(p).enterpriseValueBn*1.01});
    const base=runDcf(p).enterpriseValueBn;
    expect(x.p10EvBn).toBeCloseTo(base,8);
    expect(x.p90EvBn).toBeCloseTo(base,8);
    expect(x.probabilityBelowObservedEV).toBe(1);
  });
  it("rejects invalid distributions, out-of-range correlation and invalid observed market price",()=>{
    expect(()=>simulateValueDriverRisk(p,{draws:99})).toThrow();
    expect(()=>simulateValueDriverRisk(p,{growthMarginCorrelation:1.2})).toThrow();
    expect(()=>simulateValueDriverRisk(p,{observedEnterpriseValueBn:-1})).toThrow();
    expect(()=>simulateValueDriverRisk(p,{distributions:[{key:"growthPct",basis:"analyst_scenario",halfWidthPp:100}]})).toThrow();
  });
  it("honors controlled correlations without claiming empirical probabilities",()=>{
    const a=simulateValueDriverRisk(p,{draws:260,seed:42,growthMarginCorrelation:0.7});
    const b=simulateValueDriverRisk(p,{draws:260,seed:42,growthMarginCorrelation:-0.7});
    expect(a.p90EvBn).not.toBe(b.p90EvBn);
    expect(a.correlationGrowthMargin).toBe(0.7);
    expect(b.correlationGrowthMargin).toBe(-0.7);
  });
});
