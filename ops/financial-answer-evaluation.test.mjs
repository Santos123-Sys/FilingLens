import {describe,it,expect} from 'vitest';
import {gradeFinancialAnswer,summarizeAnswers,unitScale,financialAnswerCases} from './financial-answer-evaluation.mjs';

const sample={id:'control',text:'Annual revenue for FY2025 was 281,724 USD millions.',gold:[{metric:'revenue',year:2025,value:281724}],absentMetrics:['totalAssets']};
const answer=()=>({evaluation:{schemaValid:true},result:{financials:{unit:'USD millions',years:['2025'],revenue:[281724],totalAssets:null,
 evidence:[{metric:'revenue',period:'FY2025',source:{quote:sample.text}}]}}});
describe('financial answer grading',()=>{
 it('counts amounts, supporting quotes and abstention independently',()=>{
  const good=gradeFinancialAnswer(sample,answer());expect(summarizeAnswers([good]).pass).toBe(true);
  const unsupported=answer();unsupported.result.financials.evidence=[];
  const row=gradeFinancialAnswer(sample,unsupported);expect(row.correct).toBe(1);expect(row.groundedCorrect).toBe(0);
  expect(summarizeAnswers([row]).pass).toBe(false);
 });
 it('rejects wrong units, quarter labels, duplicate periods, fabricated quotes and invented missing amounts',()=>{
  for(const mutate of [
   f=>{f.unit='BRL millions';},f=>{f.years=['Q4 2025'];},f=>{f.years=['2025','FY2025'];},
   f=>{f.revenue=[999999];},
  ]){const run=answer();mutate(run.result.financials);expect(gradeFinancialAnswer(sample,run).correct).toBe(0);}
  const fabricated=answer();fabricated.result.financials.evidence[0].source.quote='The amount is 281,724 in an invented statement.';
  expect(gradeFinancialAnswer(sample,fabricated).groundedCorrect).toBe(0);
  const hallucinated=answer();hallucinated.result.financials.totalAssets=[100];
  expect(gradeFinancialAnswer(sample,hallucinated).abstained).toBe(0);
 });
 it('normalizes explicit USD scales without inferring an ambiguous currency',()=>{
  expect(unitScale('USD billions')).toBe(1000);expect(unitScale('US$ thousands')).toBe(.001);
  expect(unitScale('$ millions')).toBeNull();
  const run=answer();run.result.financials.unit='USD billions';run.result.financials.revenue=[281.724];
  expect(gradeFinancialAnswer(sample,run).correct).toBe(1);
 });
 it('fails closed on endpoint errors and empty evaluation suites',()=>{
  expect(summarizeAnswers([]).pass).toBe(false);
  const row=gradeFinancialAnswer(sample,{evaluationError:'HTTP 500'});
  expect(row.correct).toBe(0);expect(row.abstained).toBe(0);expect(row.schemaValid).toBe(false);
 });
 it('keeps original public sources distinct from adversarial and withheld controls',async()=>{
  const cases=await financialAnswerCases();expect(cases).toHaveLength(6);
  expect(cases.every(c=>c.text.length>=2000)).toBe(true);
  expect(cases.filter(c=>c.category==='public_issuer_statement').reduce((n,c)=>n+c.gold.length,0)).toBe(34);
 });
});
