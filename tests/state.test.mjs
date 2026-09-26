import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadState, normalizeTool, readThreadQuality, toolLabel } from '../collector/state.mjs';

const epoch = Date.parse('2026-09-26T08:00:00Z');
const row = (s, type, payload) => ({ timestamp: new Date(epoch + s * 1000).toISOString(), type, payload });
const event = (s, type, rest = {}) => row(s, 'event_msg', { type, ...rest });
const start = (s = 0, id = 't1') => event(s, 'task_started', { turn_id: id, started_at: (epoch + s * 1000) / 1000, model_context_window: 10000 });
const result = items => ({ isError: false, content: [{ type: 'text', text: JSON.stringify({ turns: items.map((v, i) => ({ id: String(i), items: v })) }) }] });
const call = (id, r, turnId = 't1', at = 2) => event(at, 'item_completed', { turn_id: turnId, started_at_ms: epoch + (at - 1) * 1000, completed_at_ms: epoch + at * 1000,
  item: { id, type: 'McpToolCall', server: 'codex_app', tool: 'read_thread', status: 'completed', arguments: { threadId: 'target' }, result: r } });

test('context is last sample, cache denominator is input, cumulative is separate', () => {
  const state = new ThreadState('task'); state.record(start());
  state.record(event(3, 'token_count', { info: { last_token_usage: { input_tokens: 900, cached_input_tokens: 450, output_tokens: 100, total_tokens: 1000 }, total_token_usage: { total_tokens: 900000 }, model_context_window: 10000 } }));
  const snap = state.snapshot(epoch + 4000); assert.equal(snap.context.percent, 10); assert.equal(snap.cacheHit, 50); assert.equal(snap.totalTokens, 900000);
});
test('explicit TTFT and duration survive completion and no idle time is added', () => {
  const state = new ThreadState('task'); state.record(start()); state.record(event(10, 'task_complete', { turn_id: 't1', duration_ms: 9860, time_to_first_token_ms: 1200 }));
  const snap = state.snapshot(epoch + 200000); assert.equal(snap.elapsedMs, 9860); assert.equal(snap.ttftMs, 1200); assert.equal(snap.phase, 'idle');
});
test('missing TTFT remains unknown instead of guessed first-visible latency', () => {
  const state = new ThreadState('task'); state.record(start()); state.record(event(10, 'task_complete', { turn_id: 't1', duration_ms: 10000 })); assert.equal(state.snapshot().ttftMs, null);
});
test('partial read_thread is attention, not an execution failure', () => {
  const tool = normalizeTool(call('x', result([[], [{ type: 'contextCompaction' }]])).payload.item, { completed: true });
  assert.equal(tool.status, 'completed'); assert.equal(tool.severity, 'warning'); assert.equal(tool.quality, 'partial'); assert.match(tool.detail, /1 轮/);
});
test('successful no-output tools are not treated as empty read failures', () => {
  for (const name of ['write_file', 'search_query', 'apply_patch']) assert.equal(normalizeTool({ type: 'McpToolCall', tool: name, status: 'completed', result: { content: [], isError: false } }).severity, null);
  assert.equal(normalizeTool({ type: 'CommandExecution', status: 'completed', exit_code: 0 }).severity, null);
});
test('MCP errors, nonzero command exits, and interruptions stay distinct', () => {
  assert.equal(normalizeTool({ type: 'McpToolCall', status: 'completed', result: { isError: true } }).status, 'failed');
  const unknownExit = normalizeTool({ type: 'CommandExecution', exit_code: 2, status: 'completed' });
  assert.equal(unknownExit.exitCode, 2); assert.equal(unknownExit.severity, 'info');
  const cancelled = normalizeTool({ type: 'CommandExecution', status: 'interrupted' }); assert.equal(cancelled.status, 'interrupted'); assert.equal(cancelled.severity, null);
});
test('tool deduplication, current-turn scope and exact-target recovery', () => {
  const state = new ThreadState('task'); state.record(start()); const failure = call('a', result([[]])); state.record(failure); state.record(failure);
  assert.equal(state.snapshot().tools.attention, 1); assert.equal(state.snapshot().tools.items.length, 1);
  const different = call('b', result([[{ type: 'agentMessage' }]]), 't1', 3); different.payload.item.arguments.threadId = 'other'; state.record(different);
  assert.equal(state.snapshot().tools.attention, 1);
  state.record(call('c', result([[{ type: 'agentMessage' }]]), 't1', 4)); assert.equal(state.snapshot().tools.attention, 0);
  state.record(start(8, 't2')); assert.equal(state.snapshot().tools.completed, 0);
});
test('durable quality checks are not erased by a sparse runtime snapshot', () => {
  const state = new ThreadState('task'); state.record(start()); state.record(call('a', result([[]])));
  state.runtime({ turns: [{ id: 't1', startedAtMs: epoch, status: 'inProgress', items: [{ id: 'a', type: 'mcpToolCall', tool: 'read_thread', status: 'completed' }] }] }, epoch + 5000);
  assert.equal(state.snapshot(epoch + 6000, true).tools.attention, 1);
});
test('parallel runtime calls retained, disconnection marks them unknown', () => {
  const state = new ThreadState('task'); state.record(start());
  state.runtime({ turns: [{ id: 't1', startedAtMs: epoch, status: 'inProgress', items: ['a','b'].map(id => ({ id, type: 'mcpToolCall', tool: 'browser', status: 'inProgress' })) }] }, epoch + 1000);
  assert.equal(state.snapshot(epoch + 2000, true).tools.running, 2);
  const snap = state.snapshot(epoch + 3000, false); assert.equal(snap.tools.running, 0); assert.ok(snap.tools.items.every(t => t.status === 'unknown'));
});
test('old runtime start cannot revert a completed durable call', () => {
  const state = new ThreadState('task'); state.record(start()); state.record(call('a', result([[{}]])));
  state.runtime({ turns: [{ id: 't1', startedAtMs: epoch, items: [{ id: 'a', type: 'mcpToolCall', tool: 'read_thread', status: 'inProgress' }] }] });
  assert.equal(state.snapshot().tools.items[0].status, 'completed');
});
test('compaction records deduplicate, zero-input cache is not displayed as zero-percent', () => {
  const state = new ThreadState('task'); state.record(start()); const compact = row(10, 'compacted', { window_number: 3 }); state.record(compact); state.record(compact);
  state.record(event(11, 'token_count', { info: { last_token_usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 350 }, model_context_window: 10000 } }));
  assert.equal(state.snapshot().compactions, 3); assert.equal(state.snapshot().cacheHit, null); assert.equal(state.snapshot().context.used, 350);
});
test('replayed older file cannot overwrite newer model or context', () => {
  const state = new ThreadState('task'); state.record(row(5, 'turn_context', { model: 'new', effort: 'high' })); state.record(row(1, 'turn_context', { model: 'old' })); assert.equal(state.model, 'new');
});
test('generic labels cover search, commands, browser, files and generation', () => {
  assert.equal(toolLabel('web.search'), '网页检索'); assert.equal(toolLabel('exec_command'), '终端执行'); assert.equal(toolLabel('cua.js'), '浏览器操作'); assert.equal(toolLabel('apply_patch'), '文件操作'); assert.equal(toolLabel('image_gen.imagegen'), '图像生成');
});
test('native media generation is monitored and explicit waiting flags take priority', () => {
  const state = new ThreadState('task'); state.record(start());
  state.runtime({ threadStatus: { type: 'active', activeFlags: ['waitingOnApproval'] }, turns: [{ id: 't1', startedAtMs: epoch, status: 'inProgress', items: [{ id: 'image', type: 'imageGeneration', status: 'inProgress' }] }] }, epoch + 1000);
  const snap = state.snapshot(epoch + 1500, true); assert.equal(snap.phase, 'waiting'); assert.equal(snap.tools.running, 1); assert.equal(snap.tools.items[0].label, '图像生成');
});
