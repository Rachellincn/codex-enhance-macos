import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTool, ThreadState } from '../collector/state.mjs';
const command = (cmd, code = 1, output = '') => normalizeTool({ type: 'CommandExecution', status: 'failed', command: cmd, exit_code: code, aggregated_output: output }, { completed: true });
const mcp = message => normalizeTool({ type: 'McpToolCall', id: 'mcp', server: 'test-server', tool: 'read_thread', status: 'failed', error: { message } }, { completed: true });

test('documented rg no-match is Info with raw nonzero evidence preserved', () => {
  const x = command(['pwsh.exe', '-Command', 'rg absent source']);
  assert.equal(x.severity, 'info'); assert.equal(x.category, 'expected_result'); assert.equal(x.status, 'completed'); assert.equal(x.executionStatus, 'failed'); assert.equal(x.exitCode, 1);
});
test('git diff expected difference stays informational', () => { const x = command('git diff --exit-code', 1, 'diff --git a/file b/file'); assert.equal(x.reason, '检测到差异'); assert.equal(x.severity, 'info'); });
test('compound commands and stderr cannot borrow embedded rg success semantics', () => {
  assert.equal(command('rg absent .; python broken.py').category, 'unclassified_exit');
  const x = normalizeTool({ type: 'CommandExecution', status: 'failed', command: 'rg absent .', exit_code: 1, stderr: 'access denied' });
  assert.notEqual(x.category, 'expected_result');
});
test('exit code alone stays Info and never automatically enters attention', () => {
  const s = new ThreadState('id'); s.turn('t', 1); s.addTool({ ...command('some-program', 1), id: 'x', turnId: 't' });
  const snap = s.snapshot(); assert.equal(snap.tools.attention, 0); assert.equal(snap.tools.levelCounts.info, 1); assert.equal(snap.tools.highestSeverity, 'info');
});
test('permission refusal is Error even when service returns 404', () => {
  const x = command('gh api users/example/settings/billing/usage', 1, 'gh: Not Found (HTTP 404)\ngh: This API operation needs the "user" scope.');
  assert.equal(x.category, 'access'); assert.equal(x.severity, 'error');
});
test('unavailable repository lookup is an informational result', () => {
  const x = command('gh repo view owner/new-repository', 1, 'GraphQL: Could not resolve to a Repository with the name owner/new-repository.');
  assert.equal(x.category, 'query_unavailable'); assert.equal(x.severity, 'info');
});
test('traceback or compiler diagnostics prove operation Error, not Critical service failure', () => {
  assert.equal(command('python run.py', 1, 'Traceback (most recent call last):\nModuleNotFoundError: No module named example').severity, 'error');
  assert.equal(command('dotnet build', 1, 'error CS1002: ; expected').severity, 'error');
});
test('explicit invalid MCP launch directory is Critical with no invented update diagnosis', () => {
  const x = mcp('[WinError 267] 目录名称无效。'); assert.equal(x.category, 'tool_startup'); assert.equal(x.severity, 'critical'); assert.match(x.detail, /不能确定/);
});
test('closed connection is Error while explicit timeout is Warning', () => {
  assert.equal(mcp('transport closed').severity, 'error'); assert.equal(mcp('request timed out').severity, 'warning');
});
test('highest level comes first, and same service success clears a startup Critical', () => {
  const s = new ThreadState('id'); s.turn('t', 1);
  s.addTool({ ...mcp('[WinError 267] directory name is invalid'), id: 'critical', turnId: 't', completedAtMs: 5 });
  s.addTool({ ...mcp('request timed out'), id: 'warning', turnId: 't', completedAtMs: 6 });
  assert.equal(s.snapshot().tools.highestSeverity, 'critical'); assert.equal(s.snapshot().tools.issues[0].id, 'critical');
  s.addTool(normalizeTool({ type: 'McpToolCall', id: 'recovered', server: 'test-server', tool: 'list_threads', status: 'completed', result: { isError: false, content: [] } }, { completed: true, turnId: 't', completedAtMs: 8 }));
  assert.equal(s.snapshot().tools.levelCounts.critical, 0); assert.equal(s.snapshot().tools.highestSeverity, 'warning');
});
test('success of another tool does not hide an unsupported-method Error', () => {
  const s = new ThreadState('id'); s.turn('t', 1); s.addTool({ ...mcp('unknown tool'), id: 'missing', turnId: 't', completedAtMs: 5 });
  s.addTool(normalizeTool({ type: 'McpToolCall', id: 'other', server: 'test-server', tool: 'list_threads', status: 'completed' }, { completed: true, turnId: 't', completedAtMs: 8 }));
  assert.equal(s.snapshot().tools.levelCounts.error, 1);
});
