import { describe, expect, it } from "vitest";
import type { FilingAnalysis, ValuationAssumption } from "../contracts/analysis";
import { calculateValuation, reconcileValuations, ValuationGateError } from "./valuation-manager";

const analysis:FilingAnalysis={schemaVersion:"2.0",jurisdiction:"us",metadata:{jurisdiction:"us",filingType:"10-K",reportingPeriod:"2025",filedAt:null,confidence:1,cnpj:null,cvmDocumentClass:null,registryData:null,cik:"1",sicCode:null,fiscalYearEnd:null,stateOfIncorporation:null,sources:[]},company:{name:"Test Co",ticker:"TST",exchange:"NYSE",filingType:"10-K",periodEnd:"2025-12-31",filedAt:null,description:"test"},kpis:[],market:{industry:"Software",competitors:["A","B","C"],geographies:[],segments:[]},risks:[],financials:{unit:"USD millions",accountingBasis:"us_gaap",statementScope:"consolidated",years:["2024","2025"],revenue:[300,360],ebit:[30,36],ebitda:[36,43.2],incomeBeforeTax:[27,32],incomeTaxExpense:[5.4,6.4],netIncome:[22,24],eps:[2.2,2.4],grossMargin:null,operatingMargin:[.1,.1],operatingCashFlow:[40,45],capex:[-12,-14.4],freeCashFlow:[28,30.6],dividends:null,buybacks:null,totalAssets:[500,550],totalDebt:[80,90],cash:[25,30],currentAssets:[150,165],currentLiabilities:[100,110],interestExpense:[4,4.5],accountsReceivable:[60,72],inventory:[12,14],accountsPayable:[30,36]},timeline:[],events:[],summary:[],confidenceNotes:[],missingData:[]};
const a=(id:string,value:number|string,status:ValuationAssumption["status"]="accepted"):ValuationAssumption=>({id,method:"dcf",category:"test",label:id,proposed_value:value,rationale:"test",confidence:"high",impact:"high",status});

describe("valuation assumption gate",()=>{
 it("blocks DCF while assumptions are proposed",()=>{expect(()=>calculateValuation(analysis,"dcf",[a("x",1,"proposed")])).toThrow(ValuationGateError)});
 it("calculates comps only from approved dated market cap, net debt and financial source components",()=>{
  const base=(id:string,value:number|string,category="framework"):ValuationAssumption=>({
    id,method:"comps",category,label:id,proposed_value:value,rationale:"test",
    confidence:"high",impact:"high",status:"accepted"});
  const peer=(name:string,multiple:number,index:number):ValuationAssumption=>{
    const quoted=new Date().toISOString().slice(0,10);
    const quoteUrl="https://market.example.com/quote/"+index;
    const filingUrl="https://investor.example.com/2025/report/"+index;
    return {...base("comps.peer."+index,multiple,"peer_multiple"),
      label:name+" — EV/EBITDA",source:{section:"Quoted enterprise components",kind:"citation",url:quoteUrl},
      snapshotOrigin:"analyst_attested",
      tradingSnapshot:{name,currency:"USD",basis:"us_gaap",consolidated:true,
        quotation_date:quoted,financial_period_end:"2025-12-31",debt_as_of:"2025-12-31",
        market_cap_millions:multiple*100-100,net_debt_millions:100,
        ebitda_millions:100,revenue_millions:400,net_income_millions:40,
        quotation_source_url:quoteUrl,financial_source_url:filingUrl}};
  };
  const rows=[base("comps.multiple_metric","EV/EBITDA"),base("comps.selected_multiple",8),
    base("comps.target_metric",36),base("comps.net_debt",60),
    base("comps.shares_outstanding",10),
    peer("Alpha Inc.",7,1),peer("Beta Inc.",8,2),peer("Gamma Inc.",9,3)];
  const result=calculateValuation(analysis,"comps",rows);
  if(result.method!=="comps")throw new Error("invalid_comps_result");
  expect(result.quartiles.q1.value).toBe(7.5);
  expect(result.quartiles.median.value).toBe(8);
  expect(result.quartiles.q3.value).toBe(8.5);
  expect(result.figures.implied_per_share.value).toBe(22.8);
  const unsupported=rows.map(x=>({...x}));
  delete unsupported[5].tradingSnapshot;
  expect(()=>calculateValuation(analysis,"comps",unsupported)).toThrow(ValuationGateError);
  const manipulated=rows.map(x=>({...x}));
  manipulated[5].final_value=14;manipulated[5].status="edited";
  expect(()=>calculateValuation(analysis,"comps",manipulated)).toThrow("comps_peer_multiple_component_mismatch");
  const unsynced=rows.map(x=>({...x,tradingSnapshot:x.tradingSnapshot?{...x.tradingSnapshot}:undefined}));
  unsynced[5].tradingSnapshot!.quotation_date="2026-01-01";
  expect(()=>calculateValuation(analysis,"comps",unsynced)).toThrow(ValuationGateError);
 });
 it("marks reconciliation unavailable until both methods exist",()=>{expect(reconcileValuations(undefined,undefined).status).toBe("unavailable")});
});
