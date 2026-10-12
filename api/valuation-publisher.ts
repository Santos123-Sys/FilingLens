import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {Hono} from 'hono';
import mysql from 'mysql2/promise';
import {z} from 'zod';
import {verifyHandoff} from '../contracts/workspace-handoff';
import {companySchema,financialsSchema,valuationAssumptionSchema,type FilingAnalysis} from '../contracts/analysis';
import {calculateValuation} from './valuation-manager';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
export const PublishRequest=z.object({
 ticket:z.string().max(2000),method:z.enum(['dcf','comps']),confirmed:z.literal(true),
 scenario:z.literal('base'),analysis:z.object({jurisdiction:z.enum(['us','br']),
 company:companySchema.shape.company,metadata:z.object({cik:z.string().nullable().optional(),cnpj:z.string().nullable().optional()}).passthrough(),financials:financialsSchema.shape.financials}).passthrough(),
 assumptions:z.array(valuationAssumptionSchema).min(1).max(150),
}).strict();
type Version={schemaVersion:'valuation.v1';valuationVersionId:string;issuerId:string;method:'dcf'|'comps';scenario:string;currency:'USD'|'BRL';impliedValuePerShare:string;valuationAsOf:string;approvedAt:string;approvedBy:string;sourceSnapshotIds:string[];assumptionsHash:string;approvalStatus:'approved'};
export function reviewedVersion(input:z.infer<typeof PublishRequest>,secret:string,now=new Date()) {
 const ctx=verifyHandoff(input.ticket,secret,Math.floor(now.getTime()/1000));
 const [jurisdiction,registryId]=ctx.issuerId.split(':');
 const sourceRegistry=jurisdiction==='us'?input.analysis.metadata.cik:input.analysis.metadata.cnpj;
 const normalized=jurisdiction==='us'?String(sourceRegistry??'').padStart(10,'0'):String(sourceRegistry??'').replace(/\\D/g,'');
 if(input.analysis.jurisdiction!==jurisdiction || input.analysis.company.ticker?.toUpperCase()!==ctx.ticker ||
   normalized!==registryId || /^0+$/.test(normalized))
  throw Error('issuer_mismatch');
 const result=calculateValuation(input.analysis as unknown as FilingAnalysis,input.method,input.assumptions);
 const figure=result.figures.implied_per_share,currency=figure.unit.split('/')[0];
 if((currency!=='USD'&&currency!=='BRL')||figure.value===null||!Number.isFinite(figure.value)||figure.value<=0)throw Error('unpublishable_valuation');
 const assumptionsHash=digest(JSON.stringify(input.assumptions));
 const sourceHash=digest(JSON.stringify({company:input.analysis.company,financials:input.analysis.financials}));
 const version:Version={schemaVersion:'valuation.v1',valuationVersionId:'flv1_'+digest(ctx.nonce+':'+input.method),
 issuerId:ctx.issuerId,method:input.method,scenario:input.scenario,currency,impliedValuePerShare:String(figure.value),
 valuationAsOf:now.toISOString(),approvedAt:now.toISOString(),approvedBy:ctx.reviewerUserId,
 sourceSnapshotIds:['reviewed-analysis:'+sourceHash],assumptionsHash,approvalStatus:'approved'};
 return {ctx,version,audit:{company:input.analysis.company,financials:input.analysis.financials,assumptions:input.assumptions,result},requestHash:digest(JSON.stringify({sourceHash,assumptionsHash,method:input.method}))};
}
async function database(){
 return mysql.createConnection(process.env.DATABASE_URL!);
}
/** Notify GPI only after the reviewed valuation is durably committed.
 * The HMAC binds the exact event bytes; private filings and audit inputs stay on FilingLens.
 * Failed delivery is explicitly reported and may be recovered via the signed return handoff.
 */
export async function notifyApprovedValuation(ticket:string,valuationVersionId:string,
 fetcher:typeof fetch=fetch):Promise<'synchronized'|'pending_retry'> {
 const secret=process.env.INTEGRATION_SIGNING_SECRET??'';
 if(secret.length<32)return 'pending_retry';
 let base:URL;
 try{
  base=new URL(process.env.GPI_API_URL??'');
  if(base.protocol!=='https:'||base.pathname!=='/'||base.username||base.password||base.search||base.hash)throw Error();
 }catch{return 'pending_retry';}
 const body=JSON.stringify({schemaVersion:'filinglens-valuation-approved.v1',ticket,
  valuationVersionId,issuedAt:new Date().toISOString()});
 const mac=createHmac('sha256',secret).update('filinglens.valuation.approved.v1\n').update(body).digest('hex');
 const url=new URL('/api/integration/v1/valuation-events',base);
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetcher(url,{method:'POST',redirect:'error',cache:'no-store',
    headers:{'content-type':'application/json','x-filinglens-signature':'sha256='+mac},
    body,signal:AbortSignal.timeout(6000)});
   await response.body?.cancel();
   if(response.ok)return 'synchronized';
   if(response.status<500&&response.status!==429)return 'pending_retry';
  }catch{/* Service may be redeploying; report pending rather than pretending delivery. */}
 }
 return 'pending_retry';
}

function bearer(header:string|undefined):boolean {
 const secret=process.env.FILINGLENS_VALUATION_READ_API_TOKEN??'';
 const a=Buffer.from('Bearer '+secret),b=Buffer.from(header??'');
 return secret.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
}
// The connection factory is injectable for cross-application verification; production uses MySQL.
export function registerValuationPublisher(app:Hono,connect:typeof database=database) {
 app.post('/api/integration/v1/handoff/context',async c=>{
  try{const body=z.object({ticket:z.string().max(2000)}).strict().parse(await c.req.json());
   return c.json({context:verifyHandoff(body.ticket,process.env.INTEGRATION_SIGNING_SECRET??'')},{headers:{'Cache-Control':'no-store'}});
  }catch{return c.json({error:'invalid_or_expired_handoff'},401);}
 });
 app.post('/api/integration/v1/valuations',async c=>{
  if(!process.env.DATABASE_URL||!process.env.INTEGRATION_SIGNING_SECRET)return c.json({error:'publisher_disabled'},503);
  const publicOrigin=process.env.FILINGLENS_PUBLIC_URL??
   (process.env.RAILWAY_PUBLIC_DOMAIN?'https://'+process.env.RAILWAY_PUBLIC_DOMAIN:new URL(c.req.url).origin);
  if(c.req.header('Origin')!==new URL(publicOrigin).origin)return c.json({error:'same_origin_required'},403);
  try{
   const raw=await c.req.text();if(Buffer.byteLength(raw)>750_000)return c.json({error:'payload_too_large'},413);
   const input=PublishRequest.parse(JSON.parse(raw));
   const {ctx,version,audit,requestHash}=reviewedVersion(input,process.env.INTEGRATION_SIGNING_SECRET);
   const db=await connect();
   try{
    await db.beginTransaction();
    const [existing]=await db.query('SELECT payload_json,request_hash,workspace_id FROM shared_valuation_versions WHERE id=? FOR UPDATE',[version.valuationVersionId]);
    const row=(existing as Array<{payload_json:string;request_hash:string;workspace_id:string}>)[0];
    if(row&&(row.request_hash!==requestHash||row.workspace_id!==ctx.workspaceId)){await db.rollback();return c.json({error:'approval_conflict_start_new_handoff'},409);}
    const [count]=await db.query('SELECT COUNT(*) AS n FROM shared_valuation_versions WHERE workspace_id=?',[ctx.workspaceId]);
    if(!row&&Number((count as Array<{n:number}>)[0].n)>=100){await db.rollback();return c.json({error:'valuation_quota_reached'},429);}
    if(!row)await db.query('INSERT INTO shared_valuation_versions(id,workspace_id,request_hash,payload_json,audit_json) VALUES(?,?,?,?,?)',[version.valuationVersionId,ctx.workspaceId,requestHash,JSON.stringify(version),JSON.stringify(audit)]);
    await db.commit();
    const synchronization=await notifyApprovedValuation(input.ticket,version.valuationVersionId);
    const base=new URL(process.env.GPI_API_URL!);if(base.protocol!=='https:'||base.username||base.password)throw Error();
    base.hash=new URLSearchParams({valuation:version.valuationVersionId,candidate:ctx.candidateKey}).toString();
    return c.json({valuation:row?JSON.parse(row.payload_json):version,returnUrl:base.href,
      reused:Boolean(row),synchronization},{headers:{'Cache-Control':'no-store'}});
   }catch(e){await db.rollback();throw e;}finally{await db.end();}
  }catch(e){return c.json({error:e instanceof Error&&['issuer_mismatch','expired_handoff','invalid_handoff','unpublishable_valuation'].includes(e.message)?e.message:'valuation_publication_failed'},422);}
 });
 app.get('/api/integration/v1/valuations/:id',async c=>{
  c.header('Cache-Control','no-store');c.header('Vary','Authorization');
  if(!bearer(c.req.header('Authorization')))return c.json({error:'unauthorized'},401);
  const workspace=c.req.header('X-Workspace-Id'),id=c.req.param('id');
  if(!z.string().uuid().safeParse(workspace).success||!/^flv1_[a-f0-9]{64}$/.test(id))return c.json({error:'invalid_scope'},400);
  if(!process.env.DATABASE_URL)return c.json({error:'publisher_disabled'},503);
  try{const db=await connect();try{const [rows]=await db.query('SELECT payload_json FROM shared_valuation_versions WHERE id=? AND workspace_id=? LIMIT 1',[id,workspace]);
   const row=(rows as Array<{payload_json:string}>)[0];return row?c.json(JSON.parse(row.payload_json)):c.json({error:'valuation_not_found'},404);
  }finally{await db.end();}}catch{return c.json({error:'valuation_store_unavailable'},503);}
 });
}

