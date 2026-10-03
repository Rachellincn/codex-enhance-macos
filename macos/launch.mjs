import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { stateDirectory } from '../collector/platform.mjs';

const root = path.resolve(import.meta.dirname, '..');
const companion = path.basename(root) === 'Resources' ? path.resolve(root, '../..') : path.join(root, 'dist', 'Codex Enhance.app');
const candidates = [process.env.CODEX_APP, '/Applications/Codex.app', path.join(os.homedir(), 'Applications/Codex.app'), '/Applications/ChatGPT.app'].filter(Boolean);
const client = candidates.find(app => fs.existsSync(path.join(app, 'Contents/Info.plist')) && (path.basename(app) !== 'ChatGPT.app' || fs.existsSync(path.join(app, 'Contents/Frameworks/Codex Framework.framework'))));
if (!fs.existsSync(companion)) throw Error('请先运行 scripts/build-macos.sh 构建 macOS App。');
if (!client) {
  console.log('未找到 Codex 客户端，将打开本地记录浮窗。可用 CODEX_APP 指定客户端 .app 路径。');
} else {
  const executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(client, 'Contents/Info.plist')], {encoding:'utf8'}).trim();
  const binary = path.join(client, 'Contents/MacOS', executable);
  const isRunning = () => {
  const processes = execFileSync('/bin/ps', ['-axo', 'command='], {encoding:'utf8'}).split('\n');
  return processes.some(line => line === binary || line.startsWith(binary + ' '));
  };
  if (process.argv.includes('--wait-for-exit')) {
    const deadline = Date.now() + 120000;
    while (isRunning() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
    if (isRunning()) throw Error('客户端仍在运行，取消重启；没有强制关闭进程。');
  }
  const running = isRunning();
  if (running) console.log('客户端已运行，保持现有会话。若浮窗显示本地记录模式，请正常退出客户端后再次运行此入口。');
  else {
    const port = await freePort();
    const state = stateDirectory();
    fs.mkdirSync(state, {recursive:true});
    fs.writeFileSync(path.join(state, 'connection.json'), JSON.stringify({port}));
    execFileSync('/usr/bin/open', ['-a', client, '--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]);
    console.log(`已启动 ${path.basename(client)}，请求本机调试端口 ${port}。是否支持实时连接以浮窗状态为准。`);
  }
}
execFileSync('/usr/bin/open', [companion]);

async function freePort() {
  for (let port = 9336; port <= 9350; port++) {
    const available = await new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw Error('本机端口 9336–9350 均不可用。');
}
