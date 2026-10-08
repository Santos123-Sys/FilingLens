import {describe,it,expect} from "vitest";
import {crosscheckCvmPeers} from "./cvm-peer-crosscheck";
import type {MarketResult} from "../contracts/analysis";
import type {RegulatoryDataSnapshot} from "../contracts/regulatory-data";
const CNPJ="33000167000101";
const source={
 provider:"cvm_open_data",sourceType:"CVM DFP",form:"DFP",
 url:"https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_2025.zip",
 retrievedAt:"2026-10-08",
};
const snapshot:RegulatoryDataSnapshot={
 status:"complete",jurisdiction:"br",provider:"cvm_open_data",
 resolvedIdentifier:CNPJ,company:{name:"PETROLEO BRASILEIRO S.A. - PETROBRAS"},
 metrics:[{key:"revenue",value:120000,unit:"BRL thousands",period:"2025-12-31",
  fiscalYear:2025,statementType:"annual",status:"verified",source}],
 sources:[],warnings:[],raw:{},
};
const research=()=>({
 peerEvidence:[] as NonNullable<MarketResult["market"]["peerEvidence"]>,
 competitiveAnalysis:{status:"partial",methodology:"market-research-brief",peerProfiles:[
  {name:"PETROLEO BRASILEIRO S.A. - PETROBRAS",candidateCnpj:CNPJ,
   relationship:"direct",positioning:"",strengths:[],vulnerabilities:[],
   source:{kind:"citation",section:"Corporate filing",url:source.url}}
 ],findings:[]}
} as unknown as {
 peerEvidence:NonNullable<MarketResult["market"]["peerEvidence"]>;
 competitiveAnalysis:NonNullable<MarketResult["market"]["competitiveAnalysis"]>;
});
describe("CVM private data-tools official peer verification",()=>{
 it("retrieves an official CNPJ and removes the unverified candidate after checking",async()=>{
  let called="";
  const output=await crosscheckCvmPeers(research(),async(cnpj)=>{called=cnpj;return snapshot;});
  expect(called).toBe(CNPJ);
  expect(output.competitiveAnalysis.peerProfiles[0].officialHistory).toHaveLength(1);
  expect(output.competitiveAnalysis.peerProfiles[0].candidateCnpj).toBeUndefined();
 });
 it("refuses invalid CNPJ checksum and skips network call",async()=>{
  const original=research();
  original.competitiveAnalysis.peerProfiles[0].candidateCnpj="33000167000102";
  let count=0;
  const output=await crosscheckCvmPeers(original,async()=>{count++;return snapshot;});
  expect(count).toBe(0);
  expect(output.competitiveAnalysis.peerProfiles[0].officialHistory).toBeUndefined();
 });
 it("does not accept an official response for a different CNPJ",async()=>{
  const mismatch={...snapshot,resolvedIdentifier:"00000000000000"};
  const output=await crosscheckCvmPeers(research(),async()=>mismatch);
  expect(output.competitiveAnalysis.peerProfiles[0].officialHistory).toBeUndefined();
 });
});
