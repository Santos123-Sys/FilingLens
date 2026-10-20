import {it,expect} from 'vitest';
import {reviewAvailability,type EvaluationSummary} from './live-evaluation';
import {DCF_SWARM_PROMPT_VERSION} from './prompts';
const pins={model:'test-model',synthesizerModel:'test-model',reasoningEffort:'low' as const,synthesizerReasoningEffort:'low' as const};
const id='d307995c-98b9-4764-a458-d5ea03a2ba52';
const summary:EvaluationSummary={evaluationId:id,status:'completed',promptVersion:DCF_SWARM_PROMPT_VERSION,model:pins,eligibleModes:['four'],limitations:[],trials:(['single','four','five'] as const).flatMap(mode=>['SEC_AAPL','CVM_PETR4','sparse_SEC','adversarial_CVM'].flatMap(c=>[0,1,2].map(trial=>({case:c,trial,mode,status:'needs_human_review',calls:mode==='single'?1:mode==='four'?5:6,elapsedMs:100,keys:mode==='five'&&c==='sparse_SEC'&&trial===2?1:4,challenges:2,injection:false,inputTokens:100,outputTokens:100,usageKnown:true}))))};
const env={DCF_SWARM_ENABLED:'true',DCF_SWARM_MODE:'four',DCF_BENCHMARK_RUN_ID:id,OPENAI_API_KEY:'synthetic'};
it('requires the completed matching receipt, current prompt/model and a qualified mode',()=>{
 expect(reviewAvailability(summary,env,pins).enabled).toBe(true);
 for(const changed of [null,{...summary,status:'running'},{...summary,promptVersion:'stale'},{...summary,evaluationId:'different'},{...summary,model:{...pins,model:'other'}},{...summary,trials:summary.trials.slice(1)}])expect(reviewAvailability(changed,env,pins).enabled).toBe(false);
 expect(reviewAvailability(summary,{...env,DCF_SWARM_MODE:'five'},pins).enabled).toBe(false);
 expect(reviewAvailability(summary,{...env,DCF_SWARM_MODE:'invalid'},pins).enabled).toBe(false);
 expect(reviewAvailability(summary,{...env,DCF_SWARM_ENABLED:'false'},pins).enabled).toBe(false);
 expect(reviewAvailability(summary,{...env,OPENAI_API_KEY:''},pins).enabled).toBe(false);
});
