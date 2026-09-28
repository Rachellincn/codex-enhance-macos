import test from 'node:test';
import assert from 'node:assert/strict';
import {ThreadState,normalizeTool} from '../collector/state.mjs';
const epoch=Date.parse('2026-09-28T00:00:00Z');
const row=(ms,type,payload)=>({timestamp:new Date(epoch+ms).toISOString(),type,payload});
const begin=()=>row(0,'event_msg',{type:'task_started',turn_id:'turn'});
const sleepStart=(id,ms)=>row(ms,'response_item',{type:'function_call',namespace:'clock',name:'sleep',call_id:id});
const sleepEnd=(id,ms,start)=>row(ms,'event_msg',{type:'item_completed',turn_id:'turn',started_at_ms:epoch+start,completed_at_ms:epoch+ms,item:{type:'Extension',kind:'clock.sleep',id,durationMs:ms-start}});
const runtime=items=>({turns:[{id:'turn',startedAtMs:epoch,status:'inProgress',items}]});

test('statusless runtime summaries and unsupported status values never imply running or completion',()=>{
 for(const item of [{id:'s',type:'sleep',durationMs:45000},{id:'u',type:'commandExecution',status:'mystery'}]) {
  const t=normalizeTool(item,{source:'runtime',timestamp:epoch+99999});
  assert.equal(t.status,'unknown');assert.equal(t.completedAtMs,null);assert.equal(t.observedStartedAtMs,null);
 }
 assert.equal(normalizeTool({type:'fileChange',completed:true}).status,'completed');
 assert.equal(normalizeTool({type:'fileChange',completed:false}).status,'running');
});

test('seventeen finished sleep extensions cannot accumulate as parallel calls',()=>{
 const s=new ThreadState('thread');s.record(begin());const history=[];
 for(let i=0;i<17;i++) {const id=`sleep-${i}`,start=1000+i*5000;s.record(sleepStart(id,start));s.record(sleepEnd(id,start+3000,start));history.push({id,type:'sleep',durationMs:3000});}
 s.runtime(runtime(history),epoch+100000);s.runtime(runtime(history),epoch+101000);
 const v=s.snapshot(epoch+102000,true);assert.equal(v.tools.running,0);assert.equal(v.tools.completed,17);assert.equal(v.activity.kind,'model');assert.equal(v.activity.items.length,0);
 s.runtime(runtime([...history,{id:'cmd',type:'commandExecution',status:'inProgress',startedAtMs:epoch+102000}]),epoch+103000);
 const active=s.snapshot(epoch+104000,true);assert.equal(active.tools.running,1);assert.equal(active.activity.elapsedMs,2000);assert.equal(active.activity.runningCount,1);
 assert.deepEqual(active.activity.items.map(i=>i.id),['cmd']);
});

test('explicit sleep invocation remains live until the real result, not a duration-based guess',()=>{
 const s=new ThreadState('thread');s.record(begin());s.record(sleepStart('s',1000));
 s.runtime(runtime([{id:'s',type:'sleep',durationMs:1000}]),epoch+10000);
 assert.equal(s.snapshot(epoch+11000,true).tools.running,1);
 s.record(row(12000,'response_item',{type:'function_call_output',call_id:'s',output:'not parsed'}));
 s.runtime(runtime([{id:'s',type:'sleep',durationMs:1000}]),epoch+13000);
 const v=s.snapshot(epoch+14000,true);assert.equal(v.tools.running,0);assert.equal(v.tools.completed,1);assert.equal(v.tools.items[0].durationMs,11000);
});

test('a runtime call that disappears becomes unknown and can be confirmed running again',()=>{
 const s=new ThreadState('thread');s.record(begin());const c={id:'cmd',type:'commandExecution',status:'inProgress',startedAtMs:epoch+1000};
 s.runtime(runtime([c]),epoch+2000);s.runtime(runtime([]),epoch+3000);
 let v=s.snapshot(epoch+3500,true);assert.equal(v.tools.running,0);assert.equal(v.tools.items[0].status,'unknown');assert.equal(v.activity.kind,'unknown');
 s.runtime(runtime([c]),epoch+4000);v=s.snapshot(epoch+4500,true);assert.equal(v.tools.running,1);
 s.runtime(runtime([{...c,status:'completed',completedAtMs:epoch+5000}]),epoch+5500);
 s.runtime(runtime([c]),epoch+6000);assert.equal(s.snapshot(epoch+6500,true).tools.running,0);
});

test('activity list truncation does not reduce the reported parallel total',()=>{
 const s=new ThreadState('thread');s.record(begin());s.runtime(runtime(Array.from({length:20},(_,i)=>({id:`c${i}`,type:'commandExecution',status:'inProgress'}))),epoch+1000);
 const v=s.snapshot(epoch+2000,true);assert.equal(v.activity.items.length,16);assert.equal(v.activity.runningCount,20);assert.equal(v.tools.running,20);
});
