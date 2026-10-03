import test from 'node:test';
import assert from 'node:assert/strict';
import { stateDirectory, devtoolsFile } from '../collector/platform.mjs';
test('macOS uses Application Support independently of Windows environment', () => {
  const env = {LOCALAPPDATA:'/wrong/local', APPDATA:'/wrong/roaming'};
  assert.equal(stateDirectory('darwin', env, '/Users/test'), '/Users/test/Library/Application Support/CodexEnhance');
  assert.equal(devtoolsFile('darwin', env, '/Users/test'), '/Users/test/Library/Application Support/Codex/DevToolsActivePort');
});
test('Windows directory policy is preserved', () => {
  assert.equal(stateDirectory('win32', {LOCALAPPDATA:'/local'}, '/home'), '/local/CodexEnhance');
  assert.equal(devtoolsFile('win32', {APPDATA:'/roaming'}, '/home'), '/roaming/Codex/DevToolsActivePort');
});
