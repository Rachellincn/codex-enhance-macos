import test from 'node:test';
import assert from 'node:assert/strict';
import {ThreadState} from '../collector/state.mjs';
const epoch=Date.parse('2026-09-27T00:00:00Z');
const data=(items=[],status='inProgress')=>({turns:[{id:'turn',startedAtMs:epoch,status,items}]});
const call=(id,start)=>({id,type:'commandExecution',status:'inProgress',startedAtMs:epoch+start});
test('current phase resets between model and tools rather than reusing cumulative totals',()=>{
 const s=new ThreadState('thread');s.runtime(data(),epoch+1000);s.runtime(data(),epoch+3000);
 assert.equal(s.snapshot(epoch+4000,true).activity.elapsedMs,3000);
 s.runtime(data([call('a',4000)]),epoch+5000);
 let a=s.snapshot(epoch+6000,true).activity;assert.equal(a.kind,'tools');assert.equal(a.elapsedMs,2000);
 s.runtime(data([{...call('a',4000),status:'completed',completedAtMs:epoch+6000}]),epoch+7000);
 a=s.snapshot(epoch+8000,true).activity;assert.equal(a.kind,'model');assert.equal(a.elapsedMs,2000);
});
test('parallel tools retain one continuous phase, a new disjoint call starts a new timer',()=>{
 const s=new ThreadState('thread');s.runtime(data([call('a',1000)]),epoch+2000);
 s.runtime(data([call('a',1000),call('b',3000)]),epoch+4000);
 assert.equal(s.snapshot(epoch+5000,true).activity.startedAtMs,epoch+1000);
 s.runtime(data([{...call('a',1000),status:'completed',completedAtMs:epoch+5000},{...call('b',3000),status:'completed',completedAtMs:epoch+5000},call('c',6000)]),epoch+7000);
 assert.equal(s.snapshot(epoch+8000,true).activity.elapsedMs,2000);
});
test('stale, disconnected and switched-away phases cannot keep a live timer',()=>{
 const s=new ThreadState('thread');s.runtime(data(),epoch+1000);
 assert.equal(s.snapshot(epoch+8000,true).activity.kind,'unknown');
 s.runtime(data(),epoch+9000);assert.equal(s.snapshot(epoch+10000,false).activity.elapsedMs,null);
 s.runtime(data(),epoch+11000);s.pauseTiming();assert.equal(s.snapshot(epoch+12000,true).activity.kind,'unknown');
});
test('approval, compaction and completion are distinct states with no completed timer',()=>{
 const s=new ThreadState('thread');s.runtime({...data(),threadStatus:{activeFlags:['waitingOnApproval']}},epoch+1000);
 assert.equal(s.snapshot(epoch+2000,true).activity.kind,'waiting');
 s.runtime(data([{id:'compact',type:'contextCompaction',completed:false,startedAtMs:epoch+3000}]),epoch+4000);
 assert.equal(s.snapshot(epoch+5000,true).activity.kind,'compacting');
 s.runtime(data([],'completed'),epoch+6000);
 const result=s.snapshot(epoch+20000,true).activity;assert.equal(result.kind,'complete');assert.equal(result.elapsedMs,null);
});

test('brief loss of a sample hides the clock without resetting the same phase on recovery',()=>{
 const s=new ThreadState('thread');s.runtime(data(),epoch+1000);s.runtime(data(),epoch+2000);
 assert.equal(s.snapshot(epoch+2500,false).activity.kind,'unknown');
 s.runtime(data(),epoch+3000);const recovered=s.snapshot(epoch+4000,true);
 assert.equal(recovered.activity.startedAtMs,epoch+1000);assert.equal(recovered.activity.elapsedMs,3000);
 // The phase clock is not a claim of continuously measured model work.
 assert.equal(recovered.performance.breakdown.segments.find(p=>p.key==='model').ms,2000);
});

test('a long gap preserves a proven unchanged phase, a genuine switch establishes a fresh phase',()=>{
 const s=new ThreadState('thread');s.runtime(data(),epoch+1000);s.snapshot(epoch+2000,false);
 s.runtime(data(),epoch+9000);assert.equal(s.snapshot(epoch+10000,true).activity.startedAtMs,epoch+1000);
 s.runtime(data([call('new',11000)]),epoch+12000);assert.equal(s.snapshot(epoch+13000,true).activity.startedAtMs,epoch+11000);
});

test('switching to another task and back retains the model clock without inventing measured work',()=>{
 const a=new ThreadState('a'),b=new ThreadState('b');a.runtime(data(),epoch+1000);a.runtime(data(),epoch+2000);
 a.pauseTiming(true);b.runtime(data(),epoch+3000);b.runtime(data(),epoch+25000);
 a.runtime({...data(),turns:[{...data().turns[0],progressSignature:'streaming-text-changed'}]},epoch+30000);
 assert.equal(a.snapshot(epoch+31000,true).activity.elapsedMs,30000);
 assert.equal(a.snapshot(epoch+31000,true).performance.breakdown.segments.find(s=>s.key==='model').ms,2000);
});
test('a tool that starts and finishes while away advances the model phase to its known end',()=>{
 const s=new ThreadState('a');s.runtime(data(),epoch+1000);s.pauseTiming(true);
 s.runtime(data([{...call('away',5000),status:'completed',completedAtMs:epoch+15000}]),epoch+25000);
 assert.equal(s.snapshot(epoch+26000,true).activity.startedAtMs,epoch+15000);
});
test('a tool without a known end while away uses observation time and a new turn never reuses a checkpoint',()=>{
 const s=new ThreadState('a');s.runtime(data(),epoch+1000);s.pauseTiming(true);
 s.runtime(data([{id:'away',type:'commandExecution',status:'completed'}]),epoch+25000);
 assert.equal(s.snapshot(epoch+26000,true).activity.startedAtMs,epoch+25000);
 const restored=new ThreadState('a',s.activityCheckpoint());
 restored.runtime({turns:[{id:'new-turn',startedAtMs:epoch+30000,status:'inProgress',items:[]}]},epoch+31000);
 assert.equal(restored.snapshot(epoch+32000,true).activity.startedAtMs,epoch+31000);
});

test('temporarily missing current-turn data preserves the same phase anchor but hides it until recovery',()=>{
 const s=new ThreadState('thread');s.runtime(data(),epoch+1000);s.runtime(data(),epoch+2000);
 s.runtime({turns:[]},epoch+2500);assert.equal(s.snapshot(epoch+2700,true).activity.kind,'unknown');
 s.runtime(data(),epoch+3000);assert.equal(s.snapshot(epoch+4000,true).activity.startedAtMs,epoch+1000);
 s.runtime(data([call('a',4000)]),epoch+5000);s.runtime({turns:[]},epoch+5500);
 const gap=s.snapshot(epoch+6000,true);assert.equal(gap.tools.running,0);assert.equal(gap.activity.kind,'unknown');
});
