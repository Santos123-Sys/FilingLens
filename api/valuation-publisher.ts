import {createHash,timingSafeEqual} from 'node:crypto';
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
 company:companySchema.shape.company,financials:financialsSchema.shape.financials}).passthrough(),
 assumptions:z.array(valuationAssumptionSchema).min(1).max(150),
}).strict();
type Version={schemaVersion:'valuation.v1';valuationVersionId:string;issuerId:string;method:'dcf'|'comps';scenario:string;currency:'USD'|'BRL';impliedValuePerShare:string;valuationAsOf:string;approvedAt:string;approvedBy:string;sourceSnapshotIds:string[];assumptionsHash:string;approvalStatus:'approved'};
export function reviewedVersion(input:z.infer<typeof PublishRequest>,secret:string,now=new Date()) {
 const ctx=verifyHandoff(input.ticket,secret,Math.floor(now.getTime()/1000));
 if(input.analysis.jurisdiction!==ctx.issuerId.split(':')[0] || input.analysis.company.ticker?.toUpperCase()!==ctx.ticker)
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
let schema:Promise<void>|undefined;
async function database(){
 const db=await mysql.createConnection(process.env.DATABASE_URL!);
 try{await (schema??=db.query(`CREATE TABLE IF NOT EXISTS shared_valuation_versions (
 id VARCHAR(120) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL,
 payload_json MEDIUMTEXT NOT NULL, audit_json MEDIUMTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX valuation_workspace(workspace_id,created_at)
 )`).then(()=>undefined).catch(e=>{schema=undefined;throw e;}));return db;}catch(e){await db.end();throw e;}
}
function bearer(header:string|undefined):boolean {
 const secret=process.env.FILINGLENS_VALUATION_READ_API_TOKEN??'';
 const a=Buffer.from('Bearer '+secret),b=Buffer.from(header??'');
 return secret.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
}
export function registerValuationPublisher(app:Hono) {
 app.post('/api/integration/v1/handoff/context',async c=>{
  try{const body=z.object({ticket:z.string().max(2000)}).strict().parse(await c.req.json());
   return c.json({context:verifyHandoff(body.ticket,process.env.INTEGRATION_SIGNING_SECRET??'')},{headers:{'Cache-Control':'no-store'}});
  }catch{return c.json({error:'invalid_or_expired_handoff'},401);}
 });
 app.post('/api/integration/v1/valuations',async c=>{
  if(!process.env.DATABASE_URL||!process.env.INTEGRATION_SIGNING_SECRET)return c.json({error:'publisher_disabled'},503);
  if(c.req.header('Origin')!==new URL(c.req.url).origin)return c.json({error:'same_origin_required'},403);
  try{
   const raw=await c.req.text();if(Buffer.byteLength(raw)>750_000)return c.json({error:'payload_too_large'},413);
   const input=PublishRequest.parse(JSON.parse(raw));
   const {ctx,version,audit,requestHash}=reviewedVersion(input,process.env.INTEGRATION_SIGNING_SECRET);
   const db=await database();
   try{
    await db.beginTransaction();
    const [existing]=await db.query('SELECT payload_json,request_hash,workspace_id FROM shared_valuation_versions WHERE id=? FOR UPDATE',[version.valuationVersionId]);
    const row=(existing as Array<{payload_json:string;request_hash:string;workspace_id:string}>)[0];
    if(row&&(row.request_hash!==requestHash||row.workspace_id!==ctx.workspaceId)){await db.rollback();return c.json({error:'approval_conflict_start_new_handoff'},409);}
    const [count]=await db.query('SELECT COUNT(*) AS n FROM shared_valuation_versions WHERE workspace_id=?',[ctx.workspaceId]);
    if(!row&&Number((count as Array<{n:number}>)[0].n)>=100){await db.rollback();return c.json({error:'valuation_quota_reached'},429);}
    if(!row)await db.query('INSERT INTO shared_valuation_versions(id,workspace_id,request_hash,payload_json,audit_json) VALUES(?,?,?,?,?)',[version.valuationVersionId,ctx.workspaceId,requestHash,JSON.stringify(version),JSON.stringify(audit)]);
    await db.commit();
    const base=new URL(process.env.GPI_API_URL!);if(base.protocol!=='https:'||base.username||base.password)throw Error();
    base.hash=new URLSearchParams({valuation:version.valuationVersionId,candidate:ctx.candidateKey}).toString();
    return c.json({valuation:row?JSON.parse(row.payload_json):version,returnUrl:base.href,reused:Boolean(row)},{headers:{'Cache-Control':'no-store'}});
   }catch(e){await db.rollback();throw e;}finally{await db.end();}
  }catch(e){return c.json({error:e instanceof Error&&['issuer_mismatch','expired_handoff','invalid_handoff','unpublishable_valuation'].includes(e.message)?e.message:'valuation_publication_failed'},422);}
 });
 app.get('/api/integration/v1/valuations/:id',async c=>{
  c.header('Cache-Control','no-store');c.header('Vary','Authorization');
  if(!bearer(c.req.header('Authorization')))return c.json({error:'unauthorized'},401);
  const workspace=c.req.header('X-Workspace-Id'),id=c.req.param('id');
  if(!z.string().uuid().safeParse(workspace).success||!/^flv1_[a-f0-9]{64}$/.test(id))return c.json({error:'invalid_scope'},400);
  if(!process.env.DATABASE_URL)return c.json({error:'publisher_disabled'},503);
  try{const db=await database();try{const [rows]=await db.query('SELECT payload_json FROM shared_valuation_versions WHERE id=? AND workspace_id=? LIMIT 1',[id,workspace]);
   const row=(rows as Array<{payload_json:string}>)[0];return row?c.json(JSON.parse(row.payload_json)):c.json({error:'valuation_not_found'},404);
  }finally{await db.end();}}catch{return c.json({error:'valuation_store_unavailable'},503);}
 });
}

