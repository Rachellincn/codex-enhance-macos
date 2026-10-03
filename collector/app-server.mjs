// macOS quota transport. Only initialization and read-only account requests;
// no login, credential extraction, turn creation or conversation mutation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';

export function findCodexBinary(env = process.env, home = os.homedir()) {
  const apps = [env.CODEX_APP, '/Applications/Codex.app', path.join(home, 'Applications/Codex.app'), '/Applications/ChatGPT.app'].filter(Boolean);
  const paths = [env.CODEX_BINARY, ...apps.flatMap(app => [
    path.join(app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
    path.join(app, 'Contents/Resources/codex'),
  ])].filter(Boolean);
  return paths.find(file => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } });
}
export function quotaProjection(limits, auth, now = Date.now()) {
  const bucket = limits.rateLimitsByLimitId?.codex ?? (limits.rateLimits?.limitId == null || limits.rateLimits?.limitId === 'codex' ? limits.rateLimits : null);
  return {accountId: typeof limits.accountId === 'string' ? limits.accountId : null,
    authType: auth.account?.type ?? null, plan: bucket?.planType ?? auth.account?.planType ?? null,
    windows: [bucket?.primary, bucket?.secondary].filter(Boolean).map(w => ({usedPercent:w.usedPercent, minutes:w.windowDurationMins, resetsAt:w.resetsAt})), checkedAtMs:now};
}
export class AppServerQuota {
  constructor({binary = findCodexBinary(), spawnFn = spawn, timeoutMs = 15000} = {}) {
    this.binary=binary; this.spawnFn=spawnFn; this.timeoutMs=timeoutMs; this.pending=new Map(); this.seq=0; this.child=null; this.ready=null; this.closed=false;
  }
  request(method, params) {
    if (!['initialize','account/read','account/rateLimits/read'].includes(method)) return Promise.reject(Error('Read-only account method required'));
    if (!this.child || this.closed) return Promise.reject(Error('Account connection unavailable'));
    return new Promise((resolve,reject) => {
      const id=++this.seq;
      const timer=setTimeout(()=>{this.pending.delete(id); reject(Error('Account request timed out')); this.disconnect();},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,method,params})+'\n', error=>{if(error)this.disconnect();});
    });
  }
  connect() {
    if (this.ready) return this.ready;
    if (this.closed || !this.binary) return Promise.reject(Error('Codex CLI unavailable'));
    const child=this.spawnFn(this.binary,['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.child=child;
    // Do not expose backend logs which can contain user identifiers.
    child.stderr.on('data',()=>{});
    child.stdin.on('error',()=>{if(this.child===child)this.disconnect();});
    child.on('error',()=>{if(this.child===child)this.disconnect();});
    child.on('exit',()=>{if(this.child===child)this.disconnect();});
    readline.createInterface({input:child.stdout}).on('line',line=>{
      let message; try {message=JSON.parse(line);} catch{return;}
      const request=this.pending.get(message.id); if(!request)return;
      clearTimeout(request.timer);this.pending.delete(message.id);
      message.error ? request.reject(Error('Account request unavailable')) : request.resolve(message.result);
    });
    this.ready=this.request('initialize',{clientInfo:{name:'codex_enhance',version:'0.4.0'},capabilities:{experimentalApi:true}})
      .then(()=>{child.stdin.write(JSON.stringify({method:'initialized'})+'\n');})
      .catch(error=>{this.disconnect();throw error;});
    return this.ready;
  }
  async readQuota() {
    await this.connect();
    const limits=await this.request('account/rateLimits/read',{});
    const auth=await this.request('account/read',{refreshToken:false});
    return quotaProjection(limits,auth);
  }
  disconnect() {
    const child=this.child;this.child=null;this.ready=null;
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(Error('Account connection closed'));}
    this.pending.clear();
    if(child){child.stdin.end();child.kill();}
  }
  close() {this.closed=true;this.disconnect();}
}
