/** Use only the server-returned GPI URL. Never broadcast valuation data or tickets. */
export function publicationNotice(returnUrl:string,valuationVersionId:string){
 try{
  const url=new URL(returnUrl),hash=new URLSearchParams(url.hash.slice(1)),candidateKey=hash.get('candidate');
  if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||
    !candidateKey||!/^[A-Z0-9.:-]{1,60}$/.test(candidateKey)||!/^flv1_[a-f0-9]{64}$/.test(valuationVersionId)||hash.get('valuation')!==valuationVersionId)return null;
  return {origin:url.origin,event:{type:'filinglens.valuation.published.v1' as const,candidateKey,valuationVersionId}};
 }catch{return null;}
}
