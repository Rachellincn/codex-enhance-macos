// Isolated CDP protocol fixture. It never attaches to the user's Codex process.
import inspector from 'node:inspector';
import http from 'node:http';
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const active = {};
const element = { getAttribute: () => id, closest: () => null, contains: e => e === active,
  getBoundingClientRect: () => ({ width: 350, height: 1 }), parentElement: { contains: e => e === active, getBoundingClientRect: () => ({ width: 350, height: 90 }) } };
globalThis.document = { activeElement: active, body: {}, querySelectorAll: selector => selector.includes('role=') ? [] : [element], hasFocus: () => true };
globalThis.location = { href: `app://-/index.html#/thread/${id}` };
const turn = { turnId: 'cdp-turn', status: 'inProgress', turnStartedAtMs: Date.now(), items: [{ id: 'live-a', type: 'mcpToolCall', tool: 'web.search', status: 'inProgress' }, { id: 'live-b', type: 'commandExecution', status: 'inProgress' }] };
const store = { conversations: new Map([[id, { title: '协议验证任务', latestModel: 'gpt-6-astra', turns: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: { 'tail:live': turn } } } }]]), updateConversationState() {} };
globalThis.__codexRoot = { _internalRoot: { current: { memoizedState: { memoizedState: store, next: null } } } };
inspector.open(0, '127.0.0.1');
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ id: 'isolated-fixture', type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: inspector.url() }])); });
server.listen(0, '127.0.0.1', () => process.send?.({ port: server.address().port, id }));
process.on('message', message => {
  if (message.type === 'complete') { turn.items[0].status = 'completed'; process.send?.({ type: 'completed' }); }
  if (message.type === 'stop') { server.close(); inspector.close(); process.exit(0); }
});
