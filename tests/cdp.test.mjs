import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCurrentThread } from '../collector/cdp.mjs';
const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222';
function doc(ids, focused) {
  const active = {};
  const nodes = ids.map(id => ({ getAttribute: () => id, closest: () => null, contains: () => false, getBoundingClientRect: () => ({ width: 350, height: 1 }), parentElement: { contains: e => e === active && id === focused, getBoundingClientRect: () => ({ width: 350, height: 80 }) } }));
  return { activeElement: active, body: {}, querySelectorAll: selector => selector.includes('role=') ? [] : nodes };
}
test('multiple visible tasks use focused composer rather than last DOM candidate', () => { assert.equal(selectCurrentThread(doc([a,b], a)).threadId, a); });
test('ambiguous visible tasks do not silently select a background task', () => { assert.deepEqual(selectCurrentThread(doc([a,b])), { threadId: null, ambiguous: true }); });
test('single task and explicitly matched route identify selection', () => { assert.equal(selectCurrentThread(doc([a])).threadId, a); assert.equal(selectCurrentThread(doc([a,b]), `app://-/thread/${b}`).threadId, b); });
test('ChatGPT conversation references are not treated as local task identifiers', () => { assert.equal(selectCurrentThread(doc([`chatgpt:${a}`])).threadId, null); });
test('native search dialog keeps the visible underlying composer even when aria-hidden', () => {
  const composer = { getAttribute: () => a, closest: selector => selector.includes('aria-hidden') ? {} : null,
    getBoundingClientRect: () => ({ width: 500, height: 32 }), contains: () => false };
  const row = { ...composer, getAttribute: () => b, closest: () => null };
  const document = { activeElement: {}, body: {}, querySelectorAll: selector => selector.includes('role=') ? [{ getBoundingClientRect: () => ({ width: 400, height: 500 }) }] : selector.includes('above-composer') ? [composer] : [row] };
  assert.equal(selectCurrentThread(document).threadId, a);
});
test('CSS-hidden composers are never revived by a dialog', () => {
  const hidden = { getAttribute: () => a, closest: () => ({}), getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const document = { body: {}, querySelectorAll: selector => selector.includes('role=') ? [{ getBoundingClientRect: () => ({ width: 400, height: 500 }) }] : [hidden] };
  assert.equal(selectCurrentThread(document).threadId, null);
});
