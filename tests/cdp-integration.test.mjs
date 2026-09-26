import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopLink } from '../collector/cdp.mjs';
import { ThreadState } from '../collector/state.mjs';

test('CDP discovery, focus selection, live tools and completion work through a real protocol endpoint', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-cdp-'));
  const child = fork(new URL('./cdp-fixture.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const link = new DesktopLink(directory, { fallbackPorts: [], includeAppPort: false });
  t.after(async () => { link.close(); if (child.connected) { child.send({ type: 'stop' }); await once(child, 'exit'); } fs.rmSync(directory, { recursive: true }); });
  const [{ port, id }] = await once(child, 'message');
  fs.writeFileSync(path.join(directory, 'connection.json'), '\ufeff' + JSON.stringify({ port }));
  const first = await link.poll(null);
  assert.equal(link.connected, true); assert.equal(first.threadId, id); assert.equal(first.documentFocused, true);
  assert.equal(first.runtime.turns[0].items.length, 2);
  const state = new ThreadState(id); state.runtime(first.runtime); assert.equal(state.snapshot(Date.now(), true).tools.running, 2);
  child.send({ type: 'complete' }); await once(child, 'message');
  const second = await link.poll(null); state.runtime(second.runtime);
  assert.equal(state.snapshot(Date.now(), true).tools.running, 1); assert.equal(state.snapshot(Date.now(), true).tools.completed, 1);
});
