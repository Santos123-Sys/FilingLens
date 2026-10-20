import {it,expect,vi,afterEach} from 'vitest';
import {eligibleModes,runLiveEvaluation} from './live-evaluation';
const mocks=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),load:vi.fn()}));
vi.mock('mysql2/promise',()=>({default:{createConnection:async()=>({query:mocks.query,end:mocks.end})}}));
vi.mock('../public-finance-api',()=>({loadPublicFinanceSnapshot:mocks.load}));
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.clearAllMocks();});
it('blocks partial, duplicated, failed, empty, unknown-usage and injection-following benchmark runs',()=>{
 const trials=['SEC_AAPL','CVM_PETR4','sparse_SEC','adversarial_CVM'].flatMap(c=>[0,1,2].map(trial=>({case:c,trial,mode:'five' as const,status:'needs_human_review',calls:6,elapsedMs:100,keys:5,challenges:3,injection:false,inputTokens:100,outputTokens:100,usageKnown:true})));
 expect(eligibleModes(trials)).toEqual(['five']);expect(eligibleModes(trials.slice(1))).toEqual([]);
 expect(eligibleModes(trials.map((t,i)=>i===0?trials[1]:t))).toEqual([]);
 for(const patch of [{status:'failed_closed'},{injection:true},{keys:0},{usageKnown:false}])expect(eligibleModes(trials.map((t,i)=>i===0?{...t,...patch}:t))).toEqual([]);
});
it('a losing atomic receipt never reaches source acquisition or paid calls',async()=>{
 vi.stubEnv('DCF_BENCHMARK_RUN_ID','d307995c-98b9-4764-a458-d5ea03a2ba52');vi.stubEnv('DATABASE_URL','synthetic');
 mocks.query.mockImplementation(async(sql:string)=>sql.startsWith('SELECT')?[[]]:sql.startsWith('INSERT IGNORE')?[{affectedRows:0}]:[{}]);
 await runLiveEvaluation();expect(mocks.load).not.toHaveBeenCalled();expect(mocks.end).toHaveBeenCalled();
 expect(mocks.query.mock.calls.some(c=>String(c[0]).includes('GET_LOCK'))).toBe(false);
});
it('database failure reports the phase and code without SQL contents or credentials',async()=>{
 vi.stubEnv('DCF_BENCHMARK_RUN_ID','d307995c-98b9-4764-a458-d5ea03a2ba52');vi.stubEnv('DATABASE_URL','synthetic');
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 mocks.query.mockRejectedValue(Object.assign(new Error('secret SQL and credential'),{code:'ER_TABLEACCESS_DENIED_ERROR'}));
 await runLiveEvaluation();const logged=JSON.parse(warning.mock.calls[0][0]);expect(logged.phase).toBe('create_store');expect(logged.code).toBe('ER_TABLEACCESS_DENIED_ERROR');expect(JSON.stringify(logged)).not.toContain('secret');expect(mocks.load).not.toHaveBeenCalled();
});
