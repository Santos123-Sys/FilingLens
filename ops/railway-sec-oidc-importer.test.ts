import {createHash,createSign,generateKeyPairSync} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import worker,{SEC_IMPORT_AUDIENCE,assertAuthorizedClaims,verifyGitHubOidc,
 validateOfficialUpload,apple2025Proof} from "./railway-sec-oidc-importer";
const CIK="0000320193";
const URL="https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json";
const REPO="Santos123-Sys/FilingLens";
const now=Date.parse("2026-10-09T12:10:00.000Z");
const claim=()=>({iss:"https://token.actions.githubusercontent.com",aud:SEC_IMPORT_AUDIENCE,
 repository:REPO,repository_id:"1405671411",ref:"refs/heads/main",
 event_name:"workflow_dispatch",workflow_ref:`${REPO}/.github/workflows/sec-official-acquisition.yml@refs/heads/main`,
 iat:Math.floor(now/1000)-30,nbf:Math.floor(now/1000)-30,
 exp:Math.floor(now/1000)+300,run_id:"37910001000"});
const facts=()=>({cik:320193,entityName:"Apple Inc.",facts:{
 "us-gaap":{RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{
 accn:"0000320193-25-000079",form:"10-K",fp:"FY",fy:2025,
 start:"2024-09-29",end:"2025-09-27",val:416_161_000_000
 }]}}}}});
describe("SEC GitHub OIDC intake",()=>{
 it("requires exact repository, workflow, dispatch event and short-lived token",()=>{
  expect(()=>assertAuthorizedClaims(claim(),now)).not.toThrow();
  for(const change of [
   {repository:"attacker/FilingLens"}, {ref:"refs/heads/feature"},
   {event_name:"pull_request"},{aud:"incorrect"},{exp:Math.floor(now/1000)-2},
   {workflow_ref:"other.yml"}, {repository_id:"12"},
  ])expect(()=>assertAuthorizedClaims({...claim(),...change},now)).toThrow();
 });
 it("verifies RS256 against fixed official GitHub JWKS",async()=>{
  const pair=generateKeyPairSync("rsa",{modulusLength:2048});
  const header=Buffer.from(JSON.stringify({alg:"RS256",kid:"test-key",typ:"JWT"})).toString("base64url");
  const payload=Buffer.from(JSON.stringify(claim())).toString("base64url");
  const content=header+"."+payload;
  const sig=createSign("RSA-SHA256").update(content).sign(pair.privateKey).toString("base64url");
  const publicJwk=pair.publicKey.export({format:"jwk"});
  const response=new Response(JSON.stringify({keys:[{...publicJwk,kid:"test-key",alg:"RS256",use:"sig"}]}),{
   headers:{"Content-Type":"application/json"}});
  Object.defineProperty(response,"url",{value:"https://token.actions.githubusercontent.com/.well-known/jwks"});
  const fetcher=vi.fn(async()=>response) as unknown as typeof fetch;
  expect((await verifyGitHubOidc(content+"."+sig,fetcher,now)).runId).toBe(claim().run_id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const tampered=content+"."+sig.slice(0,-3)+"abc";
  await expect(verifyGitHubOidc(tampered,
   (async()=>{const r=new Response(JSON.stringify({keys:[{...publicJwk,kid:"test-key",alg:"RS256",use:"sig"}]}),{headers:{"Content-Type":"application/json"}});Object.defineProperty(r,"url",{value:"https://token.actions.githubusercontent.com/.well-known/jwks"});return r;}) as typeof fetch,now)).rejects.toThrow();
 });
 it("rejects unauthenticated HTTP requests even when JSON is provided",async()=>{
  const r=await worker.fetch(new Request("https://intake.example/v1/sec/import",{method:"POST",
   headers:{"Content-Type":"application/json"},body:"{}"}));
  expect(r.status).toBe(401);
 });
});
