import {describe,it,expect} from 'vitest';
import {financialsSchema} from '../contracts/analysis';
import {bindFinancialEvidence,hasCompleteMetricEvidence} from './financial-evidence';
import {applyFinancialValidation} from './financial-validation';

const excerpt='Revenue\n100\n120\nNet income\n10\n15';
const input=()=>financialsSchema.parse({financials:{
 unit:'USD millions',years:['FY2024','FY2025'],revenue:[100,120],netIncome:[10,15],
 eps:null,grossMargin:null,operatingMargin:null,operatingCashFlow:null,capex:null,freeCashFlow:null,
 dividends:null,buybacks:null,totalAssets:null,totalDebt:null,cash:null,
 evidence:[{metric:'revenue',period:'FY2025',source:{section:'Income statement',quote:'Revenue 100 120'}}],
}});
describe('financial source binding',()=>{
 it('requires every component and period before a calculated series can claim high evidence confidence',()=>{
  const result=input();expect(hasCompleteMetricEvidence(result.financials,['revenue'])).toBe(false);
  result.financials.evidence!.push({metric:'revenue',period:'FY2024',source:{section:'Income statement',quote:'Revenue 100 120'}});
  expect(hasCompleteMetricEvidence(result.financials,['revenue'])).toBe(true);
  expect(hasCompleteMetricEvidence(result.financials,['revenue','netIncome'])).toBe(false);
 });
 it('keeps contiguous source spans with whitespace normalization, without modifying values',()=>{
  const result=bindFinancialEvidence(input(),excerpt);
  expect(result.financials.evidence).toHaveLength(1);expect(result.financials.revenue).toEqual([100,120]);
  expect(result.financials.validationFlags?.some(f=>f.code==='FINANCIAL_EVIDENCE_INCOMPLETE')).toBe(true);
 });
 it.each([
  {metric:'revenue',period:'FY2025',quote:'The annual revenue was 120.'},
  {metric:'Revenue and net income',period:'FY2025',quote:'Revenue 100 120'},
  {metric:'revenue',period:'Q4 2025',quote:'Revenue 100 120'},
  {metric:'years',period:'FY2025',quote:'Revenue 100 120'},
 ])('removes paraphrased, aggregated or incorrectly bound citations: %j',row=>{
  const result=input();result.financials.evidence=[{metric:row.metric,period:row.period,source:{section:'Statements',quote:row.quote}}];
  const bound=bindFinancialEvidence(result,excerpt);
  expect(bound.financials.evidence).toHaveLength(0);
  expect(bound.financials.validationFlags?.some(f=>f.code==='FINANCIAL_EVIDENCE_REJECTED')).toBe(true);
 });
 it('preserves evidence warnings through deterministic financial tools',async()=>{
  const bound=bindFinancialEvidence(input(),excerpt);
  const result=await applyFinancialValidation(bound);
  expect(result.financials.validationFlags?.some(f=>f.code==='FINANCIAL_EVIDENCE_INCOMPLETE')).toBe(true);
 });
});
