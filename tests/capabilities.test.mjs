import test from 'node:test';
import assert from 'node:assert/strict';
import { readToolDirectory, directoryView, CapabilityMonitor } from '../collector/capabilities.mjs';
const server = (tools = ['read_thread'], runtimeStatus = 'connected', catalogComplete = true) => ({ name: 'codex_app', tools, runtimeStatus, catalogComplete, toolsError: !catalogComplete, authStatus: 'unsupported' });
const result = (servers = [server()], checkedAtMs = 1000) => ({ state: 'ready', servers, checkedAtMs });

test('registration is independent from authentication support and call success', () => {
  const v = directoryView(result());
  assert.equal(v.watched.state, 'listed'); assert.equal(v.issues.length, 0); assert.equal(v.totalTools, 1);
  assert.equal(directoryView(result([server(['read_thread_terminal'])])).watched.state, 'missing');
  assert.equal(directoryView(result([])).watched.state, 'server_absent');
});
test('incomplete and disconnected directories never prove missing tools', () => {
  assert.equal(directoryView(result([server([], 'connected', false)])).watched.state, 'unverified');
  assert.equal(directoryView(result([server([], 'disconnected')])).watched.state, 'unverified');
  assert.equal(directoryView({ state: 'unavailable' }, result()).watched.state, 'unverified');
});
test('only explicit service failure becomes Critical; catalog differences stay separate', () => {
  assert.equal(directoryView(result([server([], 'failed')])).issues[0].severity, 'critical');
  const changed = directoryView(result([server([])]), result());
  assert.deepEqual(changed.changes[0].removed, ['read_thread']); assert.equal(changed.issues.length, 0);
  assert.equal(directoryView(result([server([], 'starting')]), result()).changes.length, 0);
});
test('reader only requests paginated tools/auth and returns a safe projection', async t => {
  const calls = []; const prior = globalThis.__codexEnhanceReadCache;
  t.after(() => { globalThis.__codexEnhanceReadCache = prior; });
  globalThis.__codexEnhanceReadCache = { store: { listMcpServers: async params => {
    calls.push(params);
    return params.cursor ? { data: [{ name: 'node_repl', runtimeStatus: 'connected', tools: { js: { description: 'SECRET', inputSchema: 'SECRET' } }, authStatus: 'unsupported' }], nextCursor: null }
      : { data: [{ name: 'codex_app', runtimeStatus: 'connected', tools: { read_thread: { description: 'SECRET' } }, resources: ['SECRET'], toolsError: null }], nextCursor: 'next' };
  } } };
  const r = await readToolDirectory('task');
  assert.equal(r.state, 'ready'); assert.equal(r.servers.length, 2); assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.threadId === 'task' && c.detail === 'toolsAndAuthOnly'));
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('failed pagination discards partial data rather than flagging absent services', async t => {
  const prior = globalThis.__codexEnhanceReadCache; t.after(() => { globalThis.__codexEnhanceReadCache = prior; });
  globalThis.__codexEnhanceReadCache = { store: { listMcpServers: async () => ({ data: [], nextCursor: 'loop' }) } };
  const r = await readToolDirectory('task'); assert.equal(r.state, 'unavailable'); assert.equal(directoryView(r).watched.state, 'unverified');
});

test('malformed tool entries and duplicate server pages cannot prove absence', async t => {
  const prior = globalThis.__codexEnhanceReadCache; t.after(() => { globalThis.__codexEnhanceReadCache = prior; });
  for (const tools of [[null], [{ unexpected: 'read_thread' }], { read_thread: null }, { '': {} }]) {
    globalThis.__codexEnhanceReadCache = { store: { listMcpServers: async () => ({ data: [{name:'codex_app', runtimeStatus:'connected', tools}], nextCursor:null }) } };
    const view = directoryView(await readToolDirectory('task'));
    assert.equal(view.watched.state, 'unverified'); assert.equal(view.issues.length, 0);
  }
  globalThis.__codexEnhanceReadCache = { store: { listMcpServers: async () => ({data:[{name:'codex_app', tools:{}},{name:'codex_app', tools:{read_thread:{}}}], nextCursor:null}) } };
  assert.equal((await readToolDirectory('task')).state, 'unavailable');
});

test('disconnect invalidates in-flight replies and forces recheck on recovery', async () => {
  let now = 1000; const m = new CapabilityMonitor({now:()=>now}); const replies = [];
  const session = {target:{id:'window'},evaluate:()=>new Promise(resolve=>replies.push(resolve))};
  m.sample(session,'task',true); m.sample(null,'task',false);
  replies.shift()(result()); await Promise.all(m.pending.values()); now++;
  const checking = m.sample(session,'task',true);
  assert.equal(checking.watched.state,'unverified'); assert.equal(checking.reason,'rechecking');
  replies.shift()(result([server([])],now)); await Promise.all(m.pending.values());
  assert.equal(m.sample(session,'task',true).watched.state,'missing');
});

test('manual refresh remains scoped to its task and replacement sessions start unverified', async () => {
  let now = 1000, calls = 0; const m = new CapabilityMonitor({now:()=>now});
  const session = {target:{id:'window'},evaluate:async()=>{calls++;return result([server()],now);}};
  m.sample(session,'one',true); await Promise.all(m.pending.values()); m.sample(session,'two',true); await Promise.all(m.pending.values());
  now+=3000; m.refresh('one'); m.sample(session,'two',true); assert.equal(calls,2);
  m.sample(session,'one',true); await Promise.all(m.pending.values()); assert.equal(calls,3);
  const replacement = {...session}; assert.equal(m.sample(replacement,'one',true).watched.state,'unverified'); await Promise.all(m.pending.values());
});

test('confirmed re-registration is recorded across unverified samples, without claiming execution success', async () => {
  let now=1000, next; const m=new CapabilityMonitor({now:()=>now,intervalMs:10});
  const session={target:{id:'w'},evaluate:async()=>next};
  async function check(raw){now+=100;next={...raw,checkedAtMs:now};m.sample(session,'t',true);await Promise.all(m.pending.values());return m.sample(session,'t',true);}
  await check(result([server([])])); const unknown=await check({state:'unavailable'}); assert.equal(unknown.lastCheckedAtMs,1100);
  const restored=await check(result()); assert.equal(restored.observations[0].kind,'tool_registered_again');
  assert.equal((await check(result())).observations.length,1);
});
test('monitor is asynchronous, throttles requests, keeps thread scope, and invalidates stale results', async () => {
  let now = 1000, requests = 0; const monitor = new CapabilityMonitor({ now: () => now });
  const session = { target: { id: 'window' }, evaluate: async () => { requests++; return result([server()], now); } };
  assert.equal(monitor.sample(session, 'one', true).state, 'checking'); await Promise.all(monitor.pending.values());
  assert.equal(monitor.sample(session, 'one', true).watched.state, 'listed'); assert.equal(requests, 1);
  assert.equal(monitor.sample(session, 'two', true).watched.state, 'unverified'); await Promise.all(monitor.pending.values());
  assert.equal(requests, 2);
  now = 100000; assert.equal(monitor.sample(session, 'one', true).reason, 'stale'); await Promise.all(monitor.pending.values());
  assert.equal(monitor.sample(null, 'one', true).watched.state, 'unverified');
});
test('catalog removals persist until restored and outages get stable distinct attention ids', async () => {
  let now = 1000, next = result(); const m = new CapabilityMonitor({ now: () => now, intervalMs: 10 });
  const session = { target: { id:'window' }, evaluate:async()=>next };
  async function check(servers) { now += 100; next = result(servers, now); m.sample(session,'task',true); await Promise.all(m.pending.values()); return m.sample(session,'task',true); }
  await check([server()]); assert.equal((await check([server([])])).changes.length,1); assert.equal((await check([server([])])).changes.length,1);
  assert.equal((await check([server()])).changes.length,0);
  const first = (await check([server([], 'failed')])).issues[0].id;
  assert.equal((await check([server([], 'failed')])).issues[0].id, first);
  await check([server()]); assert.notEqual((await check([server([], 'failed')])).issues[0].id, first);
});
