import os from 'node:os';
import path from 'node:path';

export function stateDirectory(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'CodexEnhance');
  return path.join(env.LOCALAPPDATA ?? home, 'CodexEnhance');
}
export function devtoolsFile(platform = process.platform, env = process.env, home = os.homedir()) {
  const root = platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.APPDATA ?? '';
  return path.join(root, 'Codex', 'DevToolsActivePort');
}
