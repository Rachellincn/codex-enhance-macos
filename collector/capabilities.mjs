// Runs in the existing renderer. Only this read-only directory method is allowed.
// No tool calls, config reloads, login, thread resume, or model requests.
export async function readToolDirectory(threadId) {
  const store = globalThis.__codexEnhanceReadCache?.store;
  if (!threadId || typeof store?.listMcpServers !== 'function') return { state: 'unavailable', reason: 'reader_unavailable' };
  const servers = [], cursors = new Set(), serverNames = new Set(); let cursor = null;
  const deadline = Date.now() + 5000;
  try {
    for (let page = 0; page < 10; page++) {
      if (Date.now() >= deadline) return { state: 'unavailable', reason: 'timeout' };
      const result = await store.listMcpServers({ threadId, cursor, limit: 100, detail: 'toolsAndAuthOnly' }, { priority: 'background', timeoutMs: 2000 });
      if (!Array.isArray(result?.data)) return { state: 'unavailable', reason: 'unsupported_shape' };
      for (const entry of result.data) {
        if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 256 || serverNames.has(entry.name)) return { state: 'unavailable', reason: 'unsupported_shape' };
        serverNames.add(entry.name);
        const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
        const validObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
        const entries = Array.isArray(entry.tools) ? entry.tools.map(t => [t?.name, t]) : validObject(entry.tools) ? Object.entries(entry.tools) : null;
        const validTools = entries !== null && entries.every(([name, tool]) => validName(name) && validObject(tool));
        const names = validTools ? entries.map(([name]) => name) : [];
        servers.push({ name: entry.name, runtimeStatus: typeof entry.runtimeStatus === 'string' ? entry.runtimeStatus : 'unknown',
          toolsError: entry.toolsError != null, catalogComplete: validTools && entry.toolsError == null,
          tools: [...new Set(names)].sort(), authStatus: typeof entry.authStatus === 'string' ? entry.authStatus : 'unknown' });
      }
      if (result.nextCursor == null) return { state: 'ready', servers, checkedAtMs: Date.now() };
      if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor)) return { state: 'unavailable', reason: 'incomplete_pages' };
      cursor = result.nextCursor; cursors.add(cursor);
    }
    return { state: 'unavailable', reason: 'incomplete_pages' };
  } catch { return { state: 'unavailable', reason: 'directory_unavailable' }; }
}

export function directoryView(result, previous = null) {
  if (result?.state !== 'ready') return { state: 'unavailable', reason: result?.reason ?? 'directory_unavailable', servers: [], issues: [], watched: { state: 'unverified' } };
  if (!Number.isFinite(result.checkedAtMs) || !Array.isArray(result.servers) || result.servers.some(s => !s || !Array.isArray(s.tools)))
    return { state: 'unavailable', reason: 'unsupported_shape', servers: [], issues: [], watched: { state: 'unverified' } };
  const servers = result.servers.map(s => ({ ...s, toolCount: s.tools.length }));
  const owner = servers.find(s => s.name === 'codex_app');
  const watched = { server: 'codex_app', name: 'read_thread', state: !owner ? 'server_absent' : owner.runtimeStatus !== 'connected' || !owner.catalogComplete ? 'unverified' : owner.tools.includes('read_thread') ? 'listed' : 'missing' };
  const changes = [];
  // Compare only complete connected inventories from this same thread and renderer.
  for (const old of previous?.servers ?? []) {
    const current = servers.find(s => s.name === old.name);
    if (!current) { changes.push({ server: old.name, kind: 'server_absent', removed: [] }); continue; }
    if (old.runtimeStatus !== 'connected' || current.runtimeStatus !== 'connected' || !old.catalogComplete || !current.catalogComplete) continue;
    const removed = old.tools.filter(name => !current.tools.includes(name));
    if (removed.length) changes.push({ server: old.name, kind: 'tools_removed', removed });
  }
  const issues = servers.filter(s => s.runtimeStatus === 'failed').map(s => ({ id: `capability:${s.name}:failed`, label: '工具服务', name: s.name, severity: 'critical', status: 'failed', reason: '服务状态失败', detail: '当前任务的服务目录明确返回 failed；具体原因请在 Codex 插件设置中核对。' }));
  return { state: 'ready', checkedAtMs: result.checkedAtMs, servers, watched, changes, issues,
    totalTools: servers.reduce((n, s) => n + s.toolCount, 0), connectedServers: servers.filter(s => s.runtimeStatus === 'connected').length };
}

export class CapabilityMonitor {
  constructor({ intervalMs = 30000, now = Date.now } = {}) {
    this.intervalMs = intervalMs; this.now = now; this.entries = new Map(); this.pending = new Map();
    this.sessionIds = new WeakMap(); this.nextSessionId = 0; this.activeKey = null;
  }
  refresh(threadId = null) {
    for (const [key, entry] of this.entries) if (threadId ? entry.threadId === threadId : key === this.activeKey) entry.refreshRequested = true;
  }
  unavailable(reason, threadId, entry = null) {
    return { state: 'unavailable', reason, threadId, lastCheckedAtMs: entry?.lastCheckedAtMs ?? null,
      observations: entry?.observations ?? [], servers: [], issues: [], watched: { state: 'unverified' } };
  }
  sample(session, threadId, loaded) {
    if (!session || !threadId || !loaded) {
      const old = this.entries.get(this.activeKey);
      for (const entry of !session ? this.entries.values() : old ? [old] : [])
        if (!entry.invalidated) { entry.invalidated = true; entry.revision++; }
      this.activeKey = null;
      return this.unavailable(!session ? 'client_disconnected' : 'thread_not_loaded', threadId, old?.threadId === threadId ? old : null);
    }
    if (!this.sessionIds.has(session)) this.sessionIds.set(session, ++this.nextSessionId);
    const key = `${this.sessionIds.get(session)}:${threadId}`;
    this.activeKey = key;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { threadId, attemptedAt: null, lastCheckedAtMs: null, view: { state: 'checking', servers: [], issues: [], watched: { state: 'unverified' } },
        previous: null, failures: new Map(), observations: [], lastWatchState: null, runtimeStates: new Map(), revision: 0, invalidated: false, refreshRequested: false };
      this.entries.set(key, entry);
    }
    const due = entry.attemptedAt === null || entry.invalidated || this.now() - entry.attemptedAt >= (entry.refreshRequested ? 2500 : this.intervalMs);
    if (!this.pending.has(key) && due) {
      const revision = entry.revision;
      entry.refreshRequested = false; entry.attemptedAt = this.now();
      const request = session.evaluate(`(${readToolDirectory.toString()})(${JSON.stringify(threadId)})`, 7500)
        .then(result => {
          // A request sent before disconnect must not turn the recovered UI green.
          if (revision !== entry.revision) return;
          entry.invalidated = false;
          const view = directoryView(result, entry.previous);
          if (view.state === 'ready') {
            const addObservation = (kind, name) => entry.observations.unshift({ kind, name, atMs: view.checkedAtMs });
            if (['missing', 'server_absent'].includes(entry.lastWatchState) && view.watched.state === 'listed') addObservation('tool_registered_again', 'read_thread');
            if (view.watched.state !== 'unverified') entry.lastWatchState = view.watched.state;
            for (const current of view.servers) {
              if (['failed', 'disconnected'].includes(entry.runtimeStates.get(current.name)) && current.runtimeStatus === 'connected') addObservation('service_connected_again', current.name);
              if (['connected', 'failed', 'disconnected'].includes(current.runtimeStatus)) entry.runtimeStates.set(current.name, current.runtimeStatus);
              if (current.runtimeStatus === 'connected') entry.failures.delete(current.name);
            }
            entry.observations = entry.observations.slice(0, 6);
            for (const issue of view.issues) {
              if (!entry.failures.has(issue.name)) entry.failures.set(issue.name, `${issue.id}:${view.checkedAtMs}`);
              issue.id = entry.failures.get(issue.name);
            }
            const known = new Map((entry.previous?.servers ?? []).map(s => [s.name, s]));
            for (const server of view.servers) if (server.runtimeStatus === 'connected' && server.catalogComplete)
              known.set(server.name, { ...server, tools: [...new Set([...(known.get(server.name)?.tools ?? []), ...server.tools])] });
            entry.previous = { servers: [...known.values()] };
            entry.lastCheckedAtMs = view.checkedAtMs;
          }
          entry.view = view;
        }).catch(() => {
          if (revision !== entry.revision) return;
          entry.invalidated = false;
          entry.view = directoryView({ state: 'unavailable', reason: 'client_disconnected' });
        }).finally(() => this.pending.delete(key));
      this.pending.set(key, request);
    }
    if (this.entries.size > 12) for (const old of this.entries.keys()) if (old !== key && !this.pending.has(old)) { this.entries.delete(old); break; }
    if (entry.invalidated) return { ...this.unavailable('rechecking', threadId, entry), checking: true };
    const stale = entry.view.state === 'ready' && this.now() - entry.view.checkedAtMs > 90000;
    if (stale) return { ...this.unavailable('stale', threadId, entry), checking: this.pending.has(key) };
    return { ...entry.view, threadId, lastCheckedAtMs: entry.lastCheckedAtMs, observations: entry.observations, checking: this.pending.has(key) };
  }
}
