import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadState } from '../collector/state.mjs';
import { turnProblemNotice, firstOutputView } from '../collector/performance.mjs';
const epoch = Date.parse('2026-09-26T10:00:00Z');
test('active first output waits live, then uses client observation without rewriting logged TTFT', () => {
  const s = new ThreadState('task');
  s.runtime({turns:[{id:'live',status:'inProgress',startedAtMs:epoch,hasReply:false,items:[]}]}, epoch+1000);
  assert.deepEqual(s.snapshot(epoch+2000,true).firstOutput,{state:'waiting',ms:2000});
  s.runtime({turns:[{id:'live',status:'inProgress',startedAtMs:epoch,hasReply:true,firstReplyStartedAtMs:epoch+2300,items:[]}]}, epoch+3000);
  const live=s.snapshot(epoch+4000,true); assert.deepEqual(live.firstOutput,{state:'observed',ms:2300}); assert.equal(live.ttftMs,null);
  s.record({timestamp:new Date(epoch+8000).toISOString(),type:'event_msg',payload:{type:'task_complete',turn_id:'live',time_to_first_token_ms:1200,duration_ms:8000}});
  assert.deepEqual(s.snapshot(epoch+9000,true).firstOutput,{state:'logged',ms:1200});
});
test('late attachment, model activity and disconnection never invent a first-token duration', () => {
  const base={phase:'working',startedAtMs:epoch,outputObserved:true};
  assert.equal(firstOutputView({...base,hasReply:true},epoch+50000,true).state,'output_seen');
  assert.equal(firstOutputView({...base,hasModelActivity:true},epoch+50000,true).state,'activity_seen');
  assert.equal(firstOutputView(base,epoch+50000,false).state,'unknown');
  assert.equal(firstOutputView({...base,phase:'waiting'},epoch+50000,true).state,'waiting_input');
  assert.equal(firstOutputView({...base,phase:'compacting'},epoch+50000,true).state,'compacting');
});
test('explicit quota and network signals are distinguished from ordinary slowness', () => {
  assert.match(turnProblemNotice({ codex_error_info: 'usage_limit_exceeded' }), /限流/);
  assert.match(turnProblemNotice('stream disconnected, retrying'), /网络等待/);
  assert.equal(turnProblemNotice('a complicated task is still running'), null);
});
test('silence is an observable hint, not a Critical; active tools and approval waits are distinguished', () => {
  const s = new ThreadState('task'); s.model = 'm'; s.effort = 'high'; s.turn('t', epoch);
  s.runtime({ turns: [{ id: 't', startedAtMs: epoch, status: 'inProgress', progressSignature: 'same', items: [] }] }, epoch + 1000);
  s.runtime({ turns: [{ id: 't', startedAtMs: epoch, status: 'inProgress', progressSignature: 'same', items: [] }] }, epoch + 40000);
  let v = s.snapshot(epoch + 40000, true); assert.equal(v.performance.stage, '等待模型响应'); assert.equal(v.tools.levelCounts.critical, 0);
  s.runtime({ turns: [{ id: 't', startedAtMs: epoch, status: 'inProgress', progressSignature: 'tool', items: [{ id: 'cmd', type: 'commandExecution', status: 'inProgress' }] }] }, epoch + 41000);
  assert.equal(s.snapshot(epoch + 50000, true).performance.stage, '工具执行中');
  s.runtime({ threadStatus: { activeFlags: ['waitingOnApproval'] }, turns: [] }, epoch + 60000);
  assert.equal(s.snapshot(epoch + 60000, true).performance.stage, '等待确认');
});
test('TTFT baseline compares only prior completed turns with same model and effort', () => {
  const s = new ThreadState('task'); s.model = 'same'; s.effort = 'high';
  for (let i = 0; i < 4; i++) { const t = s.turn(String(i), epoch + i * 1000); t.completedAtMs = epoch + i * 1000 + 500; t.ttftMs = [1000,2000,3000,100][i]; if (i === 3) t.model = 'other'; }
  const current = s.turn('current', epoch + 10000); current.ttftMs = 15000;
  const p = s.snapshot(epoch + 15000, true).performance; assert.equal(p.baselineSamples, 3); assert.equal(p.baselineMs, 2000); assert.equal(p.ttftRatio, 7.5); assert.ok(p.hints.some(h => h.includes('变慢线索')));
});
test('main-panel TTFT fallback is explicitly the latest completed sample, never elapsed time', () => {
  const s = new ThreadState('task'); const old = s.turn('old', epoch); old.ttftMs = 1234; old.completedAtMs = epoch + 2000;
  s.turn('live', epoch + 3000);
  const snap = s.snapshot(epoch + 10000, true); assert.equal(snap.ttftMs, null); assert.equal(snap.performance.recentTtftMs, 1234); assert.equal(snap.performance.recentTtftTurnId, 'old');
});

test('trend contains the last eight completed same-model samples in chronological order', () => {
  const s = new ThreadState('task'); s.model = 'm'; s.effort = 'high';
  for (let i = 0; i < 12; i++) { const t = s.turn(String(i), epoch + i * 10000); t.ttftMs = i * 100; t.completedAtMs = epoch + i * 10000 + 1000; }
  s.turn('different', epoch + 120000).model = 'other'; s.turns.get('different').ttftMs = 99999; s.turns.get('different').completedAtMs = epoch + 121000;
  s.model = 'm'; const live = s.turn('live', epoch + 130000); live.ttftMs = 88888;
  const trend = s.snapshot(epoch + 140000, true).performance.recentTimings;
  assert.equal(trend.length, 8); assert.deepEqual(trend.map(t => t.ttftMs), [400,500,600,700,800,900,1000,1100]);
  assert.ok(trend.every(t => t.completedAtMs && !['live','different'].includes(t.turnId)));
});
test('empty completed record is distinguished from deliberate compaction and interruption', () => {
  const s = new ThreadState('task'); const t = s.turn('t', epoch); t.phase = 'idle'; t.hasUserInput = true;
  assert.ok(s.snapshot(epoch + 1000, true).performance.hints.some(h => h.includes('没有可见回复')));
  t.wasCompaction = true; assert.equal(s.snapshot(epoch + 1000, true).performance.hints.length, 0);
  t.wasCompaction = false; t.phase = 'interrupted'; assert.equal(s.snapshot(epoch + 1000, true).performance.hints.length, 0);
});
test('lost runtime observation does not become a bogus UI freeze diagnosis', () => {
  const s = new ThreadState('task'); s.turn('t', epoch); s.lastActivityAt = epoch;
  const p = s.snapshot(epoch + 200000, false).performance; assert.equal(p.stage, '状态待确认'); assert.equal(p.progressGapMs, null);
});
test('observed compaction heartbeat is not overwritten by generic active-turn status', () => {
  const s = new ThreadState('task'); const t = s.turn('t', epoch); t.phase = 'compacting'; t.compactionHeartbeatAtMs = epoch + 30000; t.compactionStartedAtMs = epoch;
  s.runtime({ turns: [{ id: 't', startedAtMs: epoch, status: 'inProgress', items: [] }] }, epoch + 35000);
  assert.equal(s.snapshot(epoch + 35000, true).performance.stage, '正在压缩');
  s.record({ timestamp: new Date(epoch + 40000).toISOString(), type: 'event_msg', payload: { type: 'item_completed', turn_id: 't', item: { type: 'ContextCompaction' }, started_at_ms: epoch, completed_at_ms: epoch + 40000 } });
  s.runtime({ turns: [{ id: 't', startedAtMs: epoch, status: 'inProgress', items: [] }] }, epoch + 41000);
  assert.equal(s.snapshot(epoch + 41000, true).performance.stage, '正在处理');
});
