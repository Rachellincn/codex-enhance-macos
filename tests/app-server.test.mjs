import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {AppServerQuota,quotaProjection} from '../collector/app-server.mjs';
test('quota projection chooses Codex bucket and drops identity details and secrets',()=>{
 const p=quotaProjection({accountId:'account',rateLimitsByLimitId:{codex:{planType:'team',primary:{usedPercent:43,windowDurationMins:10080,resetsAt:2000}},other:{primary:{usedPercent:99}}}},{account:{type:'chatgpt',email:'private',token:'secret'}},123);
 assert.deepEqual(p,{accountId:'account',authType:'chatgpt',plan:'team',windows:[{usedPercent:43,minutes:10080,resetsAt:2000}],checkedAtMs:123});
});
function fixture() {
 const calls=[];const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
 child.stdin=new Writable({write(data,encoding,done){const m=JSON.parse(data);calls.push(m);if(m.id)setImmediate(()=>child.stdout.write(JSON.stringify({id:m.id,result:m.method==='account/read'?{account:{type:'chatgpt'}}:m.method==='account/rateLimits/read'?{accountId:'a',rateLimits:{primary:{usedPercent:20,windowDurationMins:300,resetsAt:2000}}}:{}})+'\n'));done();}});
 child.kill=()=>{child.stdout.end();child.stderr.end();child.emit('exit');};return {child,calls};
}
test('quota adapter initializes once, uses read-only requests, and reconnects after exit',async()=>{
 const f=fixture();const a=new AppServerQuota({binary:'/fake',spawnFn:()=>f.child});
 await a.readQuota();await a.readQuota();
 assert.equal(f.calls.filter(m=>m.method==='initialize').length,1);
 assert.ok(f.calls.filter(m=>m.method==='account/read').every(m=>m.params.refreshToken===false));
 await assert.rejects(a.request('turn/start',{}),/Read-only/);
 a.close();assert.equal(a.child,null);assert.equal(a.pending.size,0);
});
test('stalled initialization times out and clears the child',async()=>{
 const f=fixture();f.child.stdin=new Writable({write(d,e,done){done();}});
 const a=new AppServerQuota({binary:'/fake',spawnFn:()=>f.child,timeoutMs:20});
 await assert.rejects(a.readQuota(),/timed out/);assert.equal(a.child,null);a.close();
});
