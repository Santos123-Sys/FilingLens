import {describe,it,expect,vi,beforeEach} from 'vitest';
import {Hono} from 'hono';
import {signHandoff} from '../contracts/workspace-handoff';
import {PublishRequest,reviewedVersion,registerValuationPublisher,notifyApprovedValuation} from './valuation-publisher';
import {prepareValuation} from './valuation-manager';
import type {FilingAnalysis} from '../contracts/analysis';
const secret='s'.repeat(40),now=new Date('2026-10-11T17:00:00Z'),stamp=Math.floor(now.getTime()/1000);
const ctx={version:'workspace-handoff.v1' as const,workspaceId:'550e8400-e29b-41d4-a716-446655440000',reviewerUserId:'550e8400-e29b-41d4-a716-446655440001',issuerId:'us:0000320193',candidateKey:'XNAS:AAPL',ticker:'AAPL',nonce:'550e8400-e29b-41d4-a716-446655440002',issuedAt:stamp,expiresAt:stamp+7200};
const analysis={jurisdiction:'us',company:{name:'Synthetic Apple fixture',ticker:'AAPL',exchange:'NASDAQ',filingType:'10-K',periodEnd:'2025-09-27',filedAt:null,description:'Fixture only'},metadata:{cik:'0000320193',cnpj:null},financials:{unit:'USD millions',years:['2025'],revenue:[100],netIncome:[10],eps:null,grossMargin:null,operatingMargin:null,operatingCashFlow:null,capex:null,freeCashFlow:null,dividends:null,buybacks:null,totalAssets:null,totalDebt:null,cash:null}};
async function input(){
 const proposal=await prepareValuation(analysis as unknown as FilingAnalysis,'dcf');
 const values:Record<string,number|string>={'dcf.currency':'USD','dcf.base_period':'FY2025','dcf.base_revenue':100,'dcf.equity_adjustment':0,'dcf.net_debt':0,'dcf.shares_outstanding':10,'dcf.terminal_method':'perpetuity_growth','dcf.sbc_treatment':'expense_as_reported','dcf.tax_rate':20,'dcf.da_pct_revenue':3,'dcf.capex_pct_revenue':4,'dcf.nwc_pct_revenue':10,'dcf.risk_free_rate':4,'dcf.beta':1,'dcf.equity_risk_premium':5,'dcf.pre_tax_cost_debt':5,'dcf.debt_weight':20,'dcf.terminal_growth':2,'dcf.scenario_growth_spread':1,'dcf.scenario_margin_spread':1,'dcf.scenario_wacc_spread':.5,'dcf.scenario_terminal_spread':.5};
 const assumptions=proposal.assumptions.map(a=>({...a,status:'accepted' as const,final_value:values[a.id]??(a.id.includes('revenue_growth')?5:a.id.includes('ebit_margin')?20:a.proposed_value)}));
 return PublishRequest.parse({ticket:signHandoff(ctx,secret),method:'dcf',confirmed:true,scenario:'base',analysis,assumptions});
}
beforeEach(()=>{vi.stubEnv('INTEGRATION_SIGNING_SECRET',secret);});
describe('human reviewed, workspace scoped valuation publisher',()=>{
 it('recomputes the accepted ledger on the server and binds the audit to the signed reviewer',async()=>{
  const request=await input(),v=reviewedVersion(request,secret,now);
  expect(v.version.impliedValuePerShare).not.toBe('0');expect(v.version.approvedBy).toBe(ctx.reviewerUserId);
  expect(v.ctx.workspaceId).toBe(ctx.workspaceId);expect(v.version.sourceSnapshotIds[0]).toMatch(/^reviewed-analysis:[a-f0-9]{64}$/);
  expect(reviewedVersion(request,secret,now).version.valuationVersionId).toBe(v.version.valuationVersionId);
  request.assumptions[0].status='proposed';expect(()=>reviewedVersion(request,secret,now)).toThrow();
 });
 it('rejects missing confirmation, wrong company, modified claims and expired capability',async()=>{
  const request=await input();expect(()=>PublishRequest.parse({...request,confirmed:false})).toThrow();
  expect(()=>reviewedVersion({...request,analysis:{...request.analysis,company:{...request.analysis.company,ticker:'MSFT'}}},secret,now)).toThrow('issuer_mismatch');
  expect(()=>reviewedVersion({...request,analysis:{...request.analysis,metadata:{...request.analysis.metadata,cik:'0000789019'}}},secret,now)).toThrow('issuer_mismatch');
  expect(()=>reviewedVersion({...request,ticket:request.ticket+'a'},secret,now)).toThrow();
  expect(()=>reviewedVersion(request,secret,new Date(now.getTime()+7200000))).toThrow('expired_handoff');
 });
 it('protects private valuation reads and rejects cross-origin approvals before database access',async()=>{
  const app=new Hono();registerValuationPublisher(app);vi.stubEnv('DATABASE_URL','mysql://fixture');vi.stubEnv('FILINGLENS_VALUATION_READ_API_TOKEN','t'.repeat(40));
  expect((await app.request('/api/integration/v1/valuations/flv1_'+'a'.repeat(64))).status).toBe(401);
  expect((await app.request('/api/integration/v1/valuations/flv1_'+'a'.repeat(64),{headers:{authorization:'Bearer '+'t'.repeat(40)}})).status).toBe(400);
  expect((await app.request('/api/integration/v1/valuations',{method:'POST',headers:{origin:'https://attacker.test','content-type':'application/json'},body:'{}'})).status).toBe(403);
 });
});



describe('automatic reviewed valuation notification',()=>{
 it('sends only the scoped reference, protected by a signed body; no financial audit payload',async()=>{
  vi.stubEnv('GPI_API_URL','https://gpi.example.test/');
  const seen:Array<{url:string,body:string,signature:string}>=[];
  const fake=(async(url:URL|string,init?:RequestInit)=>{
   const body=String(init?.body??''),headers=init?.headers as Record<string,string>;
   seen.push({url:String(url),body,signature:headers['x-filinglens-signature']});
   return new Response(JSON.stringify({status:'synchronized'}),{status:200});
  }) as typeof fetch;
  const result=await notifyApprovedValuation('signed.handoff','flv1_'+'a'.repeat(64),fake);
  expect(result).toBe('synchronized');expect(seen).toHaveLength(1);
  const event=JSON.parse(seen[0].body);
  expect(event).toMatchObject({schemaVersion:'filinglens-valuation-approved.v1',ticket:'signed.handoff'});
  expect(seen[0].url).toBe('https://gpi.example.test/api/integration/v1/valuation-events');
  expect(seen[0].signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  expect(seen[0].body).not.toContain('assumptions');
  expect(seen[0].body).not.toContain('impliedValuePerShare');
 });
 it('never claims synchronization when the receiver is down',async()=>{
  vi.stubEnv('GPI_API_URL','https://gpi.example.test/');
  let attempts=0;
  const fake=(async()=>{attempts++;return new Response('{}',{status:503});}) as typeof fetch;
  await expect(notifyApprovedValuation('signed.handoff','flv1_'+'b'.repeat(64),fake)).resolves.toBe('pending_retry');
  expect(attempts).toBe(2);
 });
});
