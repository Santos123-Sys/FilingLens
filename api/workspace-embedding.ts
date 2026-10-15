import type {MiddlewareHandler} from 'hono';
export function framePolicy(gpiUrl:string|undefined){
 try{const u=new URL(gpiUrl??'');if(u.protocol!=='https:'||u.pathname!=='/'||u.username||u.password||u.search||u.hash)throw Error();
  return `frame-ancestors 'self' ${u.origin}`;
 }catch{return "frame-ancestors 'none'";}
}
/** Restrict the existing SPA to its own origin and its configured workspace host. */
export const workspaceEmbedding:MiddlewareHandler=async(c,next)=>{
 await next();c.header('Content-Security-Policy',framePolicy(process.env.GPI_API_URL));
 c.header('Referrer-Policy','no-referrer');c.header('X-Content-Type-Options','nosniff');
};
