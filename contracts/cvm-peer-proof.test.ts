import {describe,expect,it} from "vitest";
import type {RegulatoryDataSnapshot} from "./regulatory-data";
import type {FilingAnalysis,MarketResult} from "./analysis";
import {verifiedCvmDfpPeerFacts} from "./cvm-peer-proof";
import {secHistoricalPeerCohorts} from "./sec-peer-history";
import {buildPeerFinancialBenchmarks} from "./peer-financial-benchmark";

const CNPJ="33000167000101";
const cvm:RegulatoryDataSnapshot={
 jurisdiction:"br",provider:"cvm_open_data",status:"complete",
 resolvedIdentifier:CNPJ,company:{name:"PETROLEO BRASILEIRO S.A. - PETROBRAS"},
 metrics:[{
  key:"revenue",value:120000,unit:"BRL thousands",period:"2025-12-31",
  fiscalYear:2025,statementType:"annual",status:"verified",
  source:{provider:"cvm_open_data",sourceType:"CVM DFP",form:"DFP",
    url:"https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_2025.zip",
    retrievedAt:"2026-10-08"},
 },{
  key:"netIncome",value:24000,unit:"BRL thousands",period:"2025-12-31",
  fiscalYear:2025,statementType:"annual",status:"verified",
  source:{provider:"cvm_open_data",sourceType:"CVM DFP",form:"DFP",
    url:"https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_2025.zip",
    retrievedAt:"2026-10-08"},
 }],
 sources:[],warnings:[],raw:{}
};
describe("CVM official peer facts",()=>{
 it("admits matching official DFP company, CNPJ, scale and FY",()=>{
  const rows=verifiedCvmDfpPeerFacts("PETROLEO BRASILEIRO S.A. - PETROBRAS",CNPJ,cvm);
  expect(rows).toHaveLength(2);
  expect(rows.find(x=>x.metric==="revenue")?.amountMillions).toBe(120);
  expect(rows.every(x=>x.accountingBasis==="br_gaap"&&x.currency==="BRL")).toBe(true);
 });
 it("rejects unresolved CNPJ and mismatched legal name",()=>{
  expect(verifiedCvmDfpPeerFacts("Other issuer",CNPJ,cvm)).toHaveLength(0);
  expect(verifiedCvmDfpPeerFacts("PETROLEO BRASILEIRO S.A. - PETROBRAS","33000167000102",cvm)).toHaveLength(0);
 });
 it("refuses ambiguous unit, interim data and non-CVM source hosts",()=>{
  const altered={...cvm,metrics:cvm.metrics.map(x=>({...x,
   unit:"BRL",statementType:"interim" as const,
   source:{...x.source!,url:"https://dados.cvm.gov.br.attacker.tld/dfp_cia_aberta_2025.zip"}}))};
  expect(verifiedCvmDfpPeerFacts("PETROLEO BRASILEIRO S.A. - PETROBRAS",CNPJ,altered)).toHaveLength(0);
 });
 it("drops differing duplicate CVM values without selecting the larger one",()=>{
  const data={...cvm,metrics:[...cvm.metrics,{...cvm.metrics[0],value:99999}]};
  expect(verifiedCvmDfpPeerFacts("PETROLEO BRASILEIRO S.A. - PETROBRAS",CNPJ,data)
   .some(x=>x.metric==="revenue")).toBe(false);
 });
 it("allows only like-for-like BRL/BR-GAAP peer comparisons",()=>{
  const facts=verifiedCvmDfpPeerFacts("PETROLEO BRASILEIRO S.A. - PETROBRAS",CNPJ,cvm);
  const analysis={jurisdiction:"br",company:{name:"Issuer",periodEnd:"2025-12-31"},
   financials:{years:["FY2025"],revenue:[100],netIncome:[10],unit:"BRL millions",
    accountingBasis:"br_gaap",statementScope:"consolidated"},
   market:{competitiveAnalysis:{peerProfiles:[{name:"PETROLEO BRASILEIRO S.A. - PETROBRAS",officialHistory:facts}]}}
  } as unknown as FilingAnalysis;
  const comparisons=buildPeerFinancialBenchmarks(analysis);
  expect(comparisons.facts.length).toBe(2);
  expect(comparisons.comparisons.find(x=>x.metric==="revenue")?.differencePercent).toBe(20);
  analysis.financials.accountingBasis="ifrs";
  expect(buildPeerFinancialBenchmarks(analysis).comparisons).toHaveLength(0);
 });
 it("preserves BRL currency in historical cohorts, not falsely USD",()=>{
  const officialHistory=verifiedCvmDfpPeerFacts("PETROLEO BRASILEIRO S.A. - PETROBRAS",CNPJ,cvm);
  const peers=[{name:"Petrobras A",officialHistory},{name:"Petrobras B",officialHistory}] as unknown as
    NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"];
  const c=secHistoricalPeerCohorts(peers);
  expect(c.matched.length).toBeGreaterThan(0);
  expect(c.matched[0].currency).toBe("BRL");
 });
});
