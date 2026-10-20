import {it,expect} from 'vitest';
import {eligibleModes} from './live-evaluation';
it('blocks partial, duplicated, failed, empty, unknown-usage and injection-following benchmark runs',()=>{
 const trials=['SEC_AAPL','CVM_PETR4','sparse_SEC','adversarial_CVM'].flatMap(c=>[0,1,2].map(trial=>({case:c,trial,mode:'five' as const,status:'needs_human_review',calls:6,elapsedMs:100,keys:5,challenges:3,injection:false,inputTokens:100,outputTokens:100,usageKnown:true})));
 expect(eligibleModes(trials)).toEqual(['five']);expect(eligibleModes(trials.slice(1))).toEqual([]);
 expect(eligibleModes(trials.map((t,i)=>i===0?trials[1]:t))).toEqual([]);
 for(const patch of [{status:'failed_closed'},{injection:true},{keys:0},{usageKnown:false}])expect(eligibleModes(trials.map((t,i)=>i===0?{...t,...patch}:t))).toEqual([]);
});
