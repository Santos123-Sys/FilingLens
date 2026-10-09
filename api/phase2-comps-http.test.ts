import {describe,it,expect} from "vitest";
import app from "./boot";
const today=()=>new Date().toISOString().slice(0,10);
const analysis={
 jurisdiction:"us",
 company:{name:"Synthetic Benchmark Issuer",ticker:"TEST",filingType:"10-K",periodEnd:"2025-12-31"},
 financials:{unit:"USD millions",years:["2024","2025"],accountingBasis:"us_gaap",
  statementScope:"consolidated",revenue:[800,900],ebitda:[80,100],
  totalDebt:[25,30],cash:[10,10],netIncome:[40,50],eps:[1.6,2]},
 market:{industry:"Software",competitors:["Alpha Inc.","Beta Inc.","Gamma Inc."],segments:[],geographies:[]},
};
const snapshots=()=>[7,8,9].map((multiple,i)=>({
 name:["Alpha Inc.","Beta Inc.","Gamma Inc."][i],currency:"USD",basis:"us_gaap",
 consolidated:true,quotation_date:today(),financial_period_end:"2025-12-31",
 financial_period_start:"2025-01-01",financial_period_kind:"FY",
 minority_interest_millions:0,preferred_equity_millions:0,
 debt_as_of:"2025-12-31",market_cap_millions:multiple*100-100,
 net_debt_millions:100,ebitda_millions:100,revenue_millions:400,
 net_income_millions:40,
 quotation_source_url:`https://market.example.com/quote/${i}`,
 financial_source_url:`https://investor.example.com/report/${i}`,
}));
const post=async(path:string,body:unknown)=>{
 const response=await app.request(path,{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify(body)});
 return {status:response.status,data:await response.json() as any};
};
describe("Phase 2 source-attested trading comps HTTP gate",()=>{
 it("denies unacknowledged third-party quote source claims",async()=>{
  const response=await post("/api/valuation/propose",{analysis,method:"comps",tradingSnapshots:snapshots()});
  expect(response.status).toBe(422);
  expect(response.data.error).toBe("trading_sources_require_analyst_attestation");
 });
 it("accepts component-verified proposals but rejects calculations until approval",async()=>{
  const proposal=await post("/api/valuation/propose",{analysis,method:"comps",
   tradingSnapshots:snapshots(),analystAttested:true});
  expect(proposal.status).toBe(200);
  const rows=proposal.data.proposal.assumptions;
  expect(rows.filter((r:any)=>r.tradingSnapshot&&r.snapshotOrigin==="analyst_attested")).toHaveLength(3);
  const blocked=await post("/api/valuation/calculate",{analysis,method:"comps",assumptions:rows});
  expect(blocked.status).toBe(409);
  expect(blocked.data.pending).toHaveLength(rows.length);
  const approved=rows.map((row:any)=>({...row,status:row.proposed_value===null?"rejected":"accepted",
   ...(row.id==="comps.equity_adjustment"?{status:"accepted",final_value:0}:{})}));
  const done=await post("/api/valuation/calculate",{analysis,method:"comps",assumptions:approved});
  expect(done.status).toBe(200);
  expect(done.data.result.status).toBe("complete");
  expect(done.data.result.peers).toHaveLength(3);
  expect(done.data.result.quartiles.median.value).toBe(8);
  const corrupted=approved.map((row:any)=>row.id==="comps.peer.1"?
   {...row,status:"edited",final_value:55}:row);
  const rejection=await post("/api/valuation/calculate",{analysis,method:"comps",assumptions:corrupted});
  expect(rejection.status).toBe(422);
  expect(rejection.data.error).toBe("comps_peer_multiple_component_mismatch");
 });
 it("cannot treat stale or cross-currency peer snapshots as approved sources",async()=>{
  const stale=snapshots();
  stale[0].quotation_date="2025-01-01";
  const response=await post("/api/valuation/propose",{analysis,method:"comps",
   tradingSnapshots:stale,analystAttested:true});
  expect(response.status).toBe(200);
  expect(response.data.proposal.assumptions.filter((r:any)=>r.tradingSnapshot)).toHaveLength(2);
  const rows=response.data.proposal.assumptions.map((r:{proposed_value:unknown;status:string})=>({...r,status:r.proposed_value===null?"rejected":"accepted"}));
  const blocked=await post("/api/valuation/calculate",{analysis,method:"comps",assumptions:rows});
  expect(blocked.status).not.toBe(200);
 });
});
