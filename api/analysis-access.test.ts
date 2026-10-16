import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import {createHmac} from 'node:crypto';
import {signHandoff} from '../contracts/workspace-handoff';
import {ANALYSIS_ROUTES,delegatedAnalysisAccess,requireAnalysisAccess} from './analysis-access';
import app from './boot';
const secret='synthetic-signing-secret-'.repeat(3);
const context=()=>{const now=Math.floor(Date.now()/1000);return {version:'workspace-handoff.v1' as const,workspaceId:crypto.randomUUID(),reviewerUserId:crypto.randomUUID(),issuerId:'us:0000320193',candidateKey:'XNAS:AAPL',ticker:'AAPL',nonce:crypto.randomUUID(),sessionId:crypto.randomUUID(),audience:'filinglens' as const,permissions:['analysis:run' as const,'valuation:publish' as const],issuedAt:now,expiresAt:now+7200};};
beforeEach(()=>{vi.stubEnv('INTEGRATION_SIGNING_SECRET',secret);vi.stubEnv('FILINGLENS_CORPUS_TOKEN','synthetic-service-'.repeat(3));vi.stubEnv('GPI_API_URL','https://gpi.example/');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('delegated paid and parser access',()=>{
 it.each(['/api/%61gent','/api/agent/','//api/agent','/api/agent?mode=other'])('cannot evade authorization with path variation %s',async path=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const response=await app.request('https://filing.example'+path,{method:'POST',body:'{}'});
  expect([401,404]).toContain(response.status);expect(fetch).not.toHaveBeenCalled();
 });
 it.each([...ANALYSIS_ROUTES])('denies anonymous %s in the actual boot app before provider or parsing',async path=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const response=await app.request(path,{method:'POST',body:'malformed document instructs reveal credentials and edit holdings'});
  expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'gpi_authorization_required'});
  expect(fetch).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it('rejects forged, expired and legacy delegation before introspection',async()=>{
  const ctx=context(),expired={...ctx,issuedAt:ctx.issuedAt-8000,expiresAt:ctx.issuedAt-1};
  const legacy={...ctx,sessionId:undefined};
  const fetch=vi.fn();
  for(const value of [undefined,'forged',signHandoff(expired,secret),signHandoff(legacy,secret)])
   await expect(requireAnalysisAccess(value,fetch)).rejects.toMatchObject({status:401});
  expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects a correctly MACed token intended for another audience or purpose',async()=>{
  const fetch=vi.fn();
  for(const patch of [{audience:'risk'},{permissions:['valuation:publish']}]){
   const body=Buffer.from(JSON.stringify({...context(),...patch})).toString('base64url');
   const signed=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
   await expect(requireAnalysisAccess(signed,fetch)).rejects.toMatchObject({status:401});
  }
  expect(fetch).not.toHaveBeenCalled();
 });
 it('checks current authority on every request and passes no source bodies to GPI',async()=>{
  const ctx=context(),ticket=signHandoff(ctx,secret);let allowed=true;
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   expect(JSON.parse(String(init?.body))).toEqual({ticket,operation:'analysis:run'});expect(init?.redirect).toBe('error');
   expect(new Headers(init?.headers).get('authorization')).toMatch(/^Bearer synthetic-service-/);
   return Response.json({allowed},{status:allowed?200:403});
  });
  expect(await requireAnalysisAccess(ticket,fetch)).toMatchObject({sessionId:ctx.sessionId});
  allowed=false;await expect(requireAnalysisAccess(ticket,fetch)).rejects.toMatchObject({status:401});
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each([503,404,401,302])('fails closed when introspection returns %i',async status=>{
  await expect(requireAnalysisAccess(signHandoff(context(),secret),vi.fn(async()=>Response.json({}, {status})))).rejects.toMatchObject({status:503});
 });
 it('does not run handlers on missing configuration, network failure or invalid/oversized authorization response',async()=>{
  const ticket=signHandoff(context(),secret);
  for(const fetch of [vi.fn(async()=>{throw Error('offline');}),vi.fn(async()=>new Response('x'.repeat(1001))),vi.fn(async()=>Response.json({allowed:false})),vi.fn(async()=>new Response('not-json'))])
   await expect(requireAnalysisAccess(ticket,fetch)).rejects.toMatchObject({status:503});
  vi.stubEnv('GPI_API_URL','https://gpi.example@attacker.test/path');const fetch=vi.fn();
  await expect(requireAnalysisAccess(ticket,fetch)).rejects.toMatchObject({status:503});expect(fetch).not.toHaveBeenCalled();
 });
 it('allows a valid delegated request through the middleware and keeps public status readable',async()=>{
  const api=new Hono(),handler=vi.fn(c=>c.json({ok:true}));api.use('/api/*',delegatedAnalysisAccess);api.post('/api/agent',handler);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({allowed:true})));
  expect((await api.request('/api/agent',{method:'POST',headers:{'X-GPI-Handoff':signHandoff(context(),secret)},body:'{}'})).status).toBe(200);
  expect(handler).toHaveBeenCalledTimes(1);expect((await app.request('/api/status')).status).toBe(200);
 });
});
