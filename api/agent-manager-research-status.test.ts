import {describe,it,expect} from "vitest";
import type {MarketResult} from "../contracts/analysis";
import {mergeMarketResearchPeers} from "./agent-manager";
const source={section:"Competitors",kind:"citation" as const,url:"https://example.com/peer"};
const base=()=>({market:{industry:"Technology",competitors:[],segments:[],geographies:[],marketShares:[]}}) as unknown as MarketResult;
describe("Phase 2 market-research completion gate",()=>{
 it("does not mark a market deep dive completed when no external peer or finding exists",()=>{
  const data=mergeMarketResearchPeers(base(),[],{
   status:"complete",methodology:"market-research-brief",peerProfiles:[],findings:[]
  });
  expect(data.market.externalResearchStatus).toBe("no_citable_results");
 });
 it("marks supported peer research complete without treating a filing-only competitor list as a deep dive",()=>{
  const data=mergeMarketResearchPeers(base(),[{name:"Peer",sourceType:"external",source}],{
   status:"partial",methodology:"market-research-brief",peerProfiles:[],findings:[]
  });
  expect(data.market.externalResearchStatus).toBe("complete");
 });
});
