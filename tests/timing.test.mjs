import test from 'node:test';
import assert from 'node:assert/strict';
import { timingBreakdown, observeTiming, addTimingRange } from '../collector/timing.mjs';
import { ThreadState, normalizeTool } from '../collector/state.mjs';
const epoch=Date.parse('2026-09-27T00:00:00Z');
const ms=view=>Object.fromEntries(view.segments.map(s=>[s.key,s.ms]));
const turn=()=>({id:'t',startedAtMs:epoch,completedAtMs:epoch+10000,durationMs:10000,phase:'idle'});
const tool=(a,b)=>({startedAtMs:epoch+a,timingEndAtMs:epoch+b,status:'completed'});
test('breakdown merges parallel tools, clips boundaries and partitions every millisecond once',()=>{
  const t=turn();addTimingRange(t,'waiting',epoch+3000,epoch+5000);addTimingRange(t,'compacting',epoch+4500,epoch+7000);
  const v=timingBreakdown(t,[tool(-1000,6000),tool(2000,8000),tool(9500,15000)],epoch+30000,true);
  assert.deepEqual(ms(v),{model:0,tools:4500,waiting:2000,compacting:2000,unknown:1500});
  assert.equal(v.parallelOverlapMs,4000);assert.equal(v.segments.reduce((sum,s)=>sum+s.ms,0),10000);
});
test('waiting observations do not bridge polling gaps or grow while disconnected',()=>{
  const t={id:'t',startedAtMs:epoch,phase:'waiting'};
  observeTiming(t,epoch+1000);observeTiming(t,epoch+2000);observeTiming(t,epoch+40000);observeTiming(t,epoch+41000);
  assert.equal(ms(timingBreakdown(t,[],epoch+42000,true)).waiting,3000);
  assert.equal(ms(timingBreakdown(t,[],epoch+120000,false)).waiting,2000);
  const v=timingBreakdown(t,[],epoch+120000,true);assert.equal(ms(v).waiting,2000);assert.equal(ms(v).unknown,118000);
});
test('historical runtime duration without time anchors never becomes a fabricated interval',()=>{
  const t=turn();
  const unanchored=normalizeTool({id:'old',type:'commandExecution',status:'completed',durationMs:9000},{source:'runtime',timestamp:epoch+100000,turnId:'t'});
  const v=timingBreakdown(t,[unanchored],epoch+100000,true);
  assert.equal(ms(v).tools,0);assert.equal(v.missingToolTimings,1);
  const anchored=normalizeTool({id:'old',type:'commandExecution',status:'completed',durationMs:2000},{source:'log',timestamp:epoch+4000,turnId:'t'});
  assert.equal(ms(timingBreakdown(t,[anchored],epoch+100000,true)).tools,2000);
});
test('completed turns freeze elapsed time and durable tool timestamps supersede observations',()=>{
  const s=new ThreadState('thread');s.turn('t',epoch);
  s.runtime({turns:[{id:'t',startedAtMs:epoch,status:'inProgress',items:[{id:'cmd',type:'commandExecution',status:'inProgress'}]}]},epoch+2000);
  s.runtime({turns:[{id:'t',startedAtMs:epoch,status:'inProgress',items:[{id:'cmd',type:'commandExecution',status:'inProgress'}]}]},epoch+3000);
  const interim=s.snapshot(epoch+4000,true).performance.breakdown;assert.equal(ms(interim).tools,2000);
  s.record({type:'event_msg',timestamp:new Date(epoch+5000).toISOString(),payload:{type:'item_completed',turn_id:'t',started_at_ms:epoch+1000,completed_at_ms:epoch+5000,item:{id:'cmd',type:'commandExecution',status:'completed'}}});
  s.record({type:'event_msg',timestamp:new Date(epoch+10000).toISOString(),payload:{type:'task_complete',turn_id:'t',duration_ms:10000}});
  const finished=s.snapshot(epoch+100000,true);assert.equal(finished.elapsedMs,10000);assert.equal(ms(finished.performance.breakdown).tools,4000);
  assert.equal(ms(s.snapshot(epoch+200000,false).performance.breakdown).tools,4000);
});
test('waiting wins over a running tool envelope and repeated snapshots do not accumulate time',()=>{
  const s=new ThreadState('thread');s.turn('t',epoch);
  const data={threadStatus:{activeFlags:['waitingOnApproval']},turns:[{id:'t',startedAtMs:epoch,status:'inProgress',items:[{id:'cmd',type:'commandExecution',status:'inProgress',startedAtMs:epoch}]}]};
  s.runtime(data,epoch+1000);s.runtime(data,epoch+2000);
  const one=s.snapshot(epoch+3000,true).performance.breakdown;
  assert.deepEqual(ms(one),{model:0,tools:1000,waiting:2000,compacting:0,unknown:0});
  assert.deepEqual(s.snapshot(epoch+3000,true).performance.breakdown,one);
  const lost=s.snapshot(epoch+40000,false).performance.breakdown;assert.equal(ms(lost).waiting,1000);assert.equal(ms(lost).tools,1000);assert.equal(ms(lost).unknown,38000);
});
test('unknown turn starts remain unavailable and completed timing cannot leak to the next turn',()=>{
  assert.equal(timingBreakdown({startedAtMs:null},[],epoch,true).state,'unavailable');
  const s=new ThreadState('thread');const old=s.turn('old',epoch);addTimingRange(old,'waiting',epoch,epoch+3000);old.completedAtMs=epoch+4000;
  s.turn('new',epoch+5000);assert.equal(ms(s.snapshot(epoch+6000,true).performance.breakdown).waiting,0);
});
test('a missing current-turn runtime snapshot breaks waiting observation continuity',()=>{
 const s=new ThreadState('thread');s.turn('t',epoch);
 s.runtime({threadStatus:{activeFlags:['waitingOnApproval']},turns:[]},epoch+1000);
 s.runtime({threadStatus:{activeFlags:['waitingOnApproval']},turns:[]},epoch+2000);
 s.runtime({turns:[]},epoch+3000);
 assert.equal(ms(s.snapshot(epoch+4000,true).performance.breakdown).waiting,1000);
});

test('model time requires continuous active observations and never fills historical or polling gaps',()=>{
 const t={id:'t',startedAtMs:epoch,phase:'working'};
 observeTiming(t,epoch+1000);observeTiming(t,epoch+2000);
 assert.equal(ms(timingBreakdown(t,[],epoch+3000,true)).model,0);
 observeTiming(t,epoch+3000,{modelActive:true});observeTiming(t,epoch+4000,{modelActive:true});
 assert.deepEqual(ms(timingBreakdown(t,[],epoch+5000,true)),{model:2000,tools:0,waiting:0,compacting:0,unknown:3000});
 observeTiming(t,epoch+20000,{modelActive:true});
 assert.equal(ms(timingBreakdown(t,[],epoch+21000,true)).model,2000);
 assert.equal(ms(timingBreakdown(t,[],epoch+21000,true)).unknown,19000);
});

test('model estimates yield to parallel tool envelopes, waiting and compaction without double counting',()=>{
 const t=turn();addTimingRange(t,'model',epoch,epoch+10000);
 addTimingRange(t,'waiting',epoch+3000,epoch+5000);addTimingRange(t,'compacting',epoch+4500,epoch+7000);
 const v=timingBreakdown(t,[tool(-1000,6000),tool(2000,8000),tool(9500,15000)],epoch+30000,true);
 assert.deepEqual(ms(v),{model:1500,tools:4500,waiting:2000,compacting:2000,unknown:0});
 assert.equal(v.segments.reduce((sum,p)=>sum+p.ms,0),v.totalMs);
});

test('runtime transitions split model and tool time and completion freezes both',()=>{
 const s=new ThreadState('thread');
 const snapshot=(items=[])=>({turns:[{id:'t',startedAtMs:epoch,status:'inProgress',items}]});
 s.runtime(snapshot(),epoch+1000);s.runtime(snapshot(),epoch+2000);
 const call={id:'cmd',type:'commandExecution',status:'inProgress',startedAtMs:epoch+2000};
 s.runtime(snapshot([call]),epoch+3000);s.runtime(snapshot([call]),epoch+4000);
 const complete={...call,status:'completed',completedAtMs:epoch+6000,durationMs:4000};
 s.runtime(snapshot([complete]),epoch+6000);s.runtime(snapshot([complete]),epoch+7000);
 s.record({timestamp:new Date(epoch+8000).toISOString(),type:'event_msg',payload:{type:'task_complete',turn_id:'t',duration_ms:8000}});
 const done=s.snapshot(epoch+9000,true).performance.breakdown;
 assert.deepEqual(ms(done),{model:2000,tools:4000,waiting:0,compacting:0,unknown:2000});
 assert.deepEqual(s.snapshot(epoch+100000,true).performance.breakdown,done);
});

test('even a short disconnect breaks model observation continuity',()=>{
 const s=new ThreadState('thread');const data={turns:[{id:'t',startedAtMs:epoch,status:'inProgress',items:[]}]};
 s.runtime(data,epoch+1000);s.runtime(data,epoch+2000);
 assert.equal(ms(s.snapshot(epoch+2500,false).performance.breakdown).model,1000);
 s.runtime(data,epoch+3000);s.runtime(data,epoch+4000);
 const v=s.snapshot(epoch+4000,true).performance.breakdown;
 assert.equal(ms(v).model,2000);assert.equal(ms(v).unknown,2000);
});

test('model observations cannot leak into a new turn or an unknown client state',()=>{
 const s=new ThreadState('thread');const data={turns:[{id:'old',startedAtMs:epoch,status:'inProgress',items:[]}]};
 s.runtime(data,epoch+1000);s.runtime(data,epoch+2000);
 s.runtime({turns:[{id:'new',startedAtMs:epoch+3000,status:'unknown',items:[]}]},epoch+4000);
 const v=s.snapshot(epoch+5000,true).performance.breakdown;
 assert.equal(ms(v).model,0);assert.equal(ms(v).unknown,2000);assert.equal(v.modelObserved,false);
});

test('switching away from a task breaks model timing even when returning within five seconds',()=>{
 const s=new ThreadState('thread');const data={turns:[{id:'t',startedAtMs:epoch,status:'inProgress',items:[]}]};
 s.runtime(data,epoch+1000);s.runtime(data,epoch+2000);s.pauseTiming();
 s.runtime(data,epoch+4000);s.runtime(data,epoch+5000);
 assert.equal(ms(s.snapshot(epoch+5000,true).performance.breakdown).model,2000);
 assert.equal(ms(s.snapshot(epoch+5000,true).performance.breakdown).unknown,3000);
});
