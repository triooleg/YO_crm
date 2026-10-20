import test from 'node:test';import assert from 'node:assert/strict';import {loadTargetModule} from './overview-target-loader.mjs';
const {AiControlService}=loadTargetModule('intelligence/ai-control.service.ts');
test('AI statistics distinguish missing measurement samples from real zero and historical queue arrivals',async()=>{
 const db={aiRuntimeSetting:{findMany:async()=>[]},aiJob:{count:async({where})=>where.status?0:5,findMany:async()=>[]},aiRun:{count:async()=>0,aggregate:async()=>({_avg:{latencyMs:null},_sum:{inputTokens:null,outputTokens:null,estimatedCostMinor:null},_count:{latencyMs:0,inputTokens:0,outputTokens:0,estimatedCostMinor:0}}),findFirst:async()=>null}};
 const report=await new AiControlService(db).status();assert.equal(report.outbox.queued,0);assert.equal(report.statistics24h.messagesQueued,5);
 assert.deepEqual(report.statistics24h.sampleCounts,{latency:0,inputTokens:0,outputTokens:0,estimatedCost:0});
});
