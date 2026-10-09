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
  expect(()=>assertAuthorizedClaims({...claim(),event_name:"push"},now)).toThrow();
  expect(()=>assertAuthorizedClaims({...claim(),run_id:"not-a-valid-run"},now)).toThrow();
  for(const change of [
   {repository:"attacker/FilingLens"}, {ref:"refs/heads/feature"},
   {event_name:"pull_request"},{aud:"incorrect"},{exp:Math.floor(now/1000)-2},
   {workflow_ref:"other.yml"}, {repository_id:"12"},
  ])expect(()=>assertAuthorizedClaims({...claim(),...change},now)).toThrow();
  expect(()=>assertAuthorizedClaims({...claim(),event_name:"schedule",
   workflow_ref:`${REPO}/.github/workflows/sec-scheduled-acquisition.yml@refs/heads/main`},now)).not.toThrow();
  expect(()=>assertAuthorizedClaims({...claim(),event_name:"schedule"},now)).toThrow();
  expect(()=>assertAuthorizedClaims({...claim(),event_name:"pull_request",
   workflow_ref:`${REPO}/.github/workflows/sec-scheduled-acquisition.yml@refs/heads/main`},now)).toThrow();
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
 it("refuses unauthenticated SEC contact access and never echoes the configured address",async()=>{
  const before=process.env.SEC_CONTACT_EMAIL;
  process.env.SEC_CONTACT_EMAIL="operator@example.org";
  try{
   for(const authorization of [undefined,"Bearer malformed"]){
    const headers=authorization?{Authorization:authorization}:undefined;
    const response=await worker.fetch(new Request("https://intake.example/v1/sec/contact",{headers}));
    expect(response.status).toBe(401);
    const body=await response.text();
    expect(body).not.toContain("operator@example.org");
   }
  }finally{
   if(before===undefined)delete process.env.SEC_CONTACT_EMAIL;
   else process.env.SEC_CONTACT_EMAIL=before;
  }
 });
 it("rejects unauthenticated HTTP requests even when JSON is provided",async()=>{
  const r=await worker.fetch(new Request("https://intake.example/v1/sec/import",{method:"POST",
   headers:{"Content-Type":"application/json"},body:"{}"}));
  expect(r.status).toBe(401);
 });
 it("validates untouched SEC JSON, retrieval hash, issuer and accession before upload",()=>{
  const original=JSON.stringify(facts());
  const b=Buffer.from(original);
  const sha=createHash("sha256").update(b).digest("hex");
  const receipt={
   schema:"filinglens.sec_official_acquisition.v1",cik:CIK,url:URL,
   retrievedDay:"2026-10-09",retrievedAt:"2026-10-09T12:00:00.000Z",
   origin:"direct_official_sec_http",bytes:b.length,issuer:"Apple Inc.",
   sourceFileSha256:sha,normalizedPayloadSha256:sha,
  };
  const envelope={cik:CIK,officialJsonBase64:b.toString("base64"),receipt};
  const valid=validateOfficialUpload(envelope,now);
  expect(valid.payloadHash).toBe(sha);
  expect(apple2025Proof(valid.facts,CIK)).toMatchObject({
   status:"verified",filingAccession:"0000320193-25-000079",
   wrongAmountRejected:true,wrongAccessionRejected:true,wrongCikRejected:true,
  });
  expect(()=>validateOfficialUpload({...envelope,receipt:{...receipt,
   sourceFileSha256:"0".repeat(64)}},now)).toThrow(/receipt/);
  const other=facts();other.entityName="Spoof";
  expect(()=>validateOfficialUpload({...envelope,
   officialJsonBase64:Buffer.from(JSON.stringify(other)).toString("base64")},now)).toThrow(/receipt/);
 });
 it("refuses Apple annual values from wrong accession or amount",()=>{
  const modified=facts();
  modified.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD[0].val=100;
  expect(()=>apple2025Proof(modified,"0000320193")).toThrow(/numeric/);
  modified.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD[0].val=416_161_000_000;
  modified.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD[0].accn="0000320193-25-000078";
  expect(()=>apple2025Proof(modified,"0000320193")).toThrow(/numeric/);
 });
});
