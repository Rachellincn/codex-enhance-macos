import test from 'node:test';import assert from 'node:assert/strict';
import {observeResponse,observeModelLog,responseIdentity,modelIdentityView} from '../collector/models.mjs';
import {ThreadState} from '../collector/state.mjs';import {readRuntimeStore} from '../collector/cdp.mjs';
const completed=(id,model)=>({type:'response.completed',response:{id,status:'completed',model}});
test('configuration and model-authored text never become upstream identity',()=>{
 const s=new ThreadState('t');s.record({type:'event_msg',timestamp:1000,payload:{type:'task_started',turn_id:'a'}});
 s.record({type:'turn_context',timestamp:1001,payload:{turn_id:'a',model:'gpt-5.6-sol'}});
 s.record({type:'event_msg',timestamp:1002,payload:{type:'agent_message',message:'My actual model is gpt-6-sol'}});
 const m=s.snapshot(1003000,false).modelIdentity;assert.equal(m.requested,'gpt-5.6-sol');assert.equal(m.response,null);
});
test('complete matching responses expose model and differences, with header precedence',()=>{
 const t={model:'gpt-5.6-sol'};
 observeResponse(t,{type:'response.created',response:{id:'r1',headers:{'OpenAI-Model':'gpt-6-sol'},model:'gpt-5.6-sol'}},1000);
 assert.equal(modelIdentityView(t,t.model).response,null);
 observeResponse(t,completed('other','gpt-5.6-sol'),2000);
 observeResponse(t,completed('r1','gpt-5.6-sol'),3000);
 const m=modelIdentityView(t,t.model);assert.equal(m.response,'gpt-6-sol');assert.equal(m.state,'different');assert.equal(m.source,'response_header');
 observeResponse(t,completed('r1','gpt-6-sol'),4000);assert.equal(t.responseModels.length,2);
});
test('missing or incomplete latest response does not fabricate success or reuse an older model',()=>{
 const t={model:'gpt-6-sol'};observeResponse(t,{...completed('incomplete','gpt-6-sol'),response:{id:'incomplete',status:'incomplete',model:'gpt-6-sol'}},1000);
 assert.equal(modelIdentityView(t,t.model).response,null);
 observeResponse(t,completed('r1','gpt-6-sol'),2000);observeResponse(t,completed('r2',undefined),3000);
 assert.equal(modelIdentityView(t,t.model).response,null);assert.equal(modelIdentityView(t,t.model).state,'unavailable');
 assert.equal(responseIdentity({type:'response.created',response:{id:'r',model:'private\ncontent'}}),null);
});
test('SSE logs require exact source, matching turn, and completed non-warmup non-compaction response',()=>{
 const s=new ThreadState('thread'),id='11111111-1111-1111-1111-111111111111';s.turn(id,1000);
 const row={target:'codex_api::sse::responses',ts:10,feedback_log_body:`turn{turn.id=${id} model=gpt-5.6-sol}: SSE event: ${JSON.stringify(completed('r1','gpt-6-sol'))}`};
 observeModelLog(s,{...row,target:'codex_core::stream_events_utils'});assert.equal(s.snapshot().modelIdentity.response,null);
 observeModelLog(s,{...row,feedback_log_body:'warmup=true '+row.feedback_log_body});assert.equal(s.snapshot().modelIdentity.response,null);
 observeModelLog(s,{...row,feedback_log_body:'run_auto_compact '+row.feedback_log_body});assert.equal(s.snapshot().modelIdentity.response,null);
 observeModelLog(s,{...row,feedback_log_body:row.feedback_log_body.replace(id,'22222222-2222-2222-2222-222222222222')});assert.equal(s.snapshot().modelIdentity.response,null);
 observeModelLog(s,row);assert.equal(s.snapshot().modelIdentity.response,'gpt-6-sol');
 s.turn('next',20000);assert.equal(s.snapshot().modelIdentity.response,null);
});
test('runtime model rerouting is separate from response identity and ordinary picker changes',t=>{
 const prior=globalThis.__codexEnhanceReadCache;t.after(()=>globalThis.__codexEnhanceReadCache=prior);
 const conversation={latestModel:'gpt-5.6-sol',turns:[{turnId:'turn',status:'inProgress',turnStartedAtMs:1000,params:{model:'gpt-5.6-sol'},items:[
  {id:'selection',type:'modelChanged',fromModel:'gpt-5.6-sol',toModel:'gpt-6-astra'},
  {id:'routing',type:'modelRerouted',fromModel:'gpt-5.6-sol',toModel:'gpt-6-sol'}]}]};
 globalThis.__codexEnhanceReadCache={store:{conversations:new Map([['thread',conversation]])}};
 const runtime=readRuntimeStore('thread'),s=new ThreadState('thread');s.runtime(runtime,2000);s.runtime(runtime,3000);
 const m=s.snapshot(4000,true).modelIdentity;assert.equal(m.routedModel,'gpt-6-sol');assert.equal(m.response,null);assert.equal(m.routes.length,1);
 assert.equal(m.requested,'gpt-5.6-sol');assert.equal(runtime.turns[0].modelRoutes.length,1);
});
