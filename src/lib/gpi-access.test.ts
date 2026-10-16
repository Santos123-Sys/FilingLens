import {afterEach,it,expect,vi} from 'vitest';
import {analysisFetch} from './gpi-access';
afterEach(()=>vi.unstubAllGlobals());
it('sends the delegated credential only to exact protected local paths',async()=>{
 vi.stubGlobal('sessionStorage',{getItem:()=> 'synthetic-delegation'});const fetch=vi.fn(async(path:string,init:RequestInit)=>{expect(path).toBeTypeOf('string');expect(init).toBeTypeOf('object');return new Response('{}');});vi.stubGlobal('fetch',fetch);
 for(const path of ['/api/agent','/api/extract','/api/valuation/propose']){
  await analysisFetch(path,{headers:{'content-type':'application/json','X-FilingLens-Run-Id':'test-run'}});
  const headers=new Headers(fetch.mock.calls.at(-1)![1].headers);expect(headers.get('X-GPI-Handoff')).toBe('synthetic-delegation');expect(headers.get('X-FilingLens-Run-Id')).toBe('test-run');
 }
 for(const path of ['https://attacker.test/api/agent','//attacker.test/api/agent','/api/status','/api/agent?leak=true']){
  await analysisFetch(path,{headers:{'X-GPI-Handoff':'must-not-leak'}});expect(new Headers(fetch.mock.calls.at(-1)![1].headers).has('X-GPI-Handoff')).toBe(false);
 }
});
