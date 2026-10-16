import type { MiddlewareHandler } from 'hono';
import { verifyHandoff } from '../contracts/workspace-handoff';
import { MODEL_PATHS,ANALYSIS_PATHS,HANDOFF_HEADER } from '../contracts/analysis-access';

export const MODEL_ROUTES=new Set<string>(MODEL_PATHS);
export const ANALYSIS_ROUTES=new Set<string>(ANALYSIS_PATHS);
export class AnalysisAccessError extends Error {
  constructor(public readonly status:401|503){super(status===401?'gpi_authorization_required':'gpi_authorization_unavailable');}
}
export function gpiLaunchUrl():string|null{
  try{const base=new URL(process.env.GPI_API_URL??'');
    if(base.protocol!=='https:'||base.pathname!=='/'||base.username||base.password||base.search||base.hash)return null;
    return base.href;
  }catch{return null;}
}
/** Reuse the existing signed issuer handoff, then recheck current authority without a positive cache. */
export async function requireAnalysisAccess(ticket:string|undefined,fetcher:typeof fetch=fetch,operation:'analysis:run'|'valuation:publish'='analysis:run'){
  let ctx;
  try{ctx=verifyHandoff(ticket??'',process.env.INTEGRATION_SIGNING_SECRET??'');
    if(!ctx.sessionId||ctx.audience!=='filinglens'||!ctx.permissions?.includes(operation))throw Error();
  }catch{throw new AnalysisAccessError(401);}
  const base=gpiLaunchUrl(),serviceToken=process.env.FILINGLENS_CORPUS_TOKEN??'';
  if(!base||serviceToken.length<32)throw new AnalysisAccessError(503);
  try{
    const response=await fetcher(new URL('/api/integration/v1/analysis-access',base),{
      method:'POST',redirect:'error',cache:'no-store',headers:{'content-type':'application/json',authorization:'Bearer '+serviceToken},
      body:JSON.stringify({ticket,operation}),signal:AbortSignal.timeout(6000)});
    if(!response.ok){await response.body?.cancel();throw new AnalysisAccessError(response.status===403?401:503);}
    const reader=response.body?.getReader();if(!reader)throw new AnalysisAccessError(503);
    const chunks:Uint8Array[]=[];let bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;
      bytes+=part.value.byteLength;if(bytes>1000)throw new AnalysisAccessError(503);chunks.push(part.value);}}
    finally{await reader.cancel();reader.releaseLock();}
    if(JSON.parse(Buffer.concat(chunks).toString('utf8')).allowed!==true)throw new AnalysisAccessError(503);
    return ctx;
  }catch(error){if(error instanceof AnalysisAccessError)throw error;throw new AnalysisAccessError(503);}
}
export const delegatedAnalysisAccess:MiddlewareHandler=async(c,next)=>{
  if(!ANALYSIS_ROUTES.has(c.req.path))return next();
  c.header('Cache-Control','no-store');c.header('Vary','X-GPI-Handoff');
  try{await requireAnalysisAccess(c.req.header(HANDOFF_HEADER));}
  catch(error){const failure=error instanceof AnalysisAccessError?error:new AnalysisAccessError(503);
    return c.json({error:failure.message},failure.status);}
  return next();
};
