import {ANALYSIS_PATHS,HANDOFF_HEADER} from '../../contracts/analysis-access';
export function analysisAccessMessage(code:string,lang:'en'|'pt'='en'):string|null{
  if(code==='gpi_authorization_required')return lang==='pt'?'A sessão expirou ou não tem permissão. Abra uma nova transferência no GPI. Sua análise foi preservada.':'The session expired or lacks permission. Open a fresh handoff in GPI. Your analysis is preserved.';
  if(code==='gpi_authorization_unavailable')return lang==='pt'?'O GPI está indisponível. Tente novamente após a recuperação. Sua análise foi preservada.':'GPI is unavailable. Retry after recovery. Your analysis is preserved.';
  return null;
}
/** Never attach the delegation to external URLs, query strings or an unrelated endpoint. */
export function analysisFetch(path:string,init:RequestInit={}):Promise<Response>{
  const headers=new Headers(init.headers);
  headers.delete(HANDOFF_HEADER);
  if((ANALYSIS_PATHS as readonly string[]).includes(path)){
    try{const ticket=sessionStorage.getItem('gpi-workspace-handoff');if(ticket)headers.set(HANDOFF_HEADER,ticket);}catch{/* Server still denies missing authority. */}
  }
  return fetch(path,{...init,headers});
}
