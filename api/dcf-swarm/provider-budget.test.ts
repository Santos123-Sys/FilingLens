import {it,expect,vi,afterEach} from 'vitest';
import {buildPublicFinanceSnapshot} from '../../contracts/public-finance';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
it('the real SDK serializes the baseline output budget into the provider HTTP request',async()=>{
 vi.stubEnv('OPENAI_API_KEY','synthetic-test-key');vi.resetModules();
 const requests:Record<string,unknown>[]=[];
 const opinion={role:'growth_analyst',assumptions:[{key:'revenue_growth_path',value:5,unit:'percent',basis:'analyst_estimate',rationale:'Explicit hypothesis requiring operating evidence and human review.',citations:[]}],challenges:[],gaps:[]};
 const opinions=[opinion,...['margin_analyst','discount_rate_analyst','terminal_value_analyst'].map(role=>({role,assumptions:[],challenges:[],gaps:[]}))];
 vi.stubGlobal('fetch',async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  expect(String(input)).toBe('https://api.openai.com/v1/responses');requests.push(JSON.parse(init?.body as string));
  return Response.json({id:'resp_synthetic',object:'response',created_at:1,status:'completed',model:'gpt-6-sol',output:[{id:'msg_synthetic',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({opinions}),annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
 });
 const {runDebate}=await import('./orchestrator');
 const snapshot=buildPublicFinanceSnapshot({issuer:{jurisdiction:'us',registryId:'0000320193'},provider:'sec_edgar',archivedOn:'2026-10-20',facts:[{metric:'revenue',value:'100',unit:'USD',currency:'USD',fiscalYear:2025,periodEnd:'2025-12-31',periodLabel:'FY2025',status:'single_source',sources:[{url:'https://www.sec.gov/Archives/example',provider:'sec_edgar',form:'10-K',retrievedAt:'2026-10-20'}]}]});
 const result=await runDebate('us:0000320193',snapshot,{question:'Which assumptions are defensible from the annual evidence?',startYear:2021,endYear:2025,language:'en'},crypto.randomUUID(),{enabled:true,mode:'single'});
 expect(result.status).toBe('needs_human_review');expect(requests).toHaveLength(1);expect(requests[0].max_output_tokens).toBe(14400);
});
