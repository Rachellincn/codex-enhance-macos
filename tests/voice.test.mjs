import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VoiceUsage} from '../collector/voice.mjs';
import {QuotaHistory} from '../collector/quota-history.mjs';
const epoch=Date.parse('2026-09-27T00:00:00Z');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-voice-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const tick=()=>new Promise(r=>setImmediate(r));
test('retained active connection never becomes actual speech duration or cost',async t=>{
 const v=new VoiceUsage(fixture(t));const session={evaluate:async()=>({phase:'active',activity:'listening',connectedAtMs:epoch,checkedAtMs:epoch+3600000,sessionId:'private-id',threadId:'private-thread',hostId:'local'})};
 v.inspect();v.sample(session,'private-thread',epoch+3600000);await tick();const out=v.sample(session,'private-thread',epoch+3601000);
 assert.equal(out.state,'observed');assert.equal(out.currentMs,null);assert.equal(out.currentUsd,null);assert.equal(out.week,null);assert.equal(out.billingVerified,false);
 assert.ok(!JSON.stringify(out).includes('private-'));
});
test('infrequent voice diagnostics make no background requests',async t=>{
 const v=new VoiceUsage(fixture(t));let calls=0;const s={evaluate:async()=>{calls++;return{phase:'inactive',checkedAtMs:epoch};}};
 for(let i=0;i<50;i++)v.sample(s,'t',epoch+i*2000);assert.equal(calls,0);
 v.inspect();v.sample(s,'t',epoch+100000);await tick();assert.equal(calls,1);
 for(let i=0;i<50;i++)v.sample(s,'t',epoch+101000+i*2000);assert.equal(calls,1);
 v.inspect();v.sample(s,'t',epoch+300000);await tick();assert.equal(calls,2);
});
test('old inferred voice cache is quarantined and never loaded as usage',t=>{
 const dir=fixture(t);const content=JSON.stringify({schema:1,records:[{estimatedUsd:20}]});fs.writeFileSync(path.join(dir,'voice-usage.json'),content);
 const v=new VoiceUsage(dir);v.close();assert.equal(fs.existsSync(path.join(dir,'voice-usage.json')),false);
 const moved=fs.readdirSync(dir).filter(n=>n.startsWith('voice-usage.invalid-'));assert.equal(moved.length,1);assert.equal(fs.readFileSync(path.join(dir,moved[0]),'utf8'),content);
});
test('weekly history removes only unverified voice estimates, preserving model costs and percentage',t=>{
 const dir=fixture(t);const entry={accountKey:'a'.repeat(64),startMs:epoch,resetsAtMs:epoch+604800000,firstObservedAtMs:epoch+1000,plan:'pro',sample:{checkedAtMs:epoch+60000,usedPercent:12,usage:{quotaBaseUsd:13,taskQuotaBaseUsd:10,voiceUsd:3,voiceMs:3600000,usd:20,quotaFastPremiumUsd:15,requests:6,tokens:900,models:[]}}};
 fs.writeFileSync(path.join(dir,'quota-history.json'),JSON.stringify({schema:1,entries:[entry]}));const history=new QuotaHistory(dir);
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'quota-history.json'),'utf8'));const use=saved.entries[0].sample.usage;
 assert.equal(history.entries.length,1);assert.equal(use.quotaBaseUsd,10);assert.equal(use.usd,20);assert.equal(use.quotaFastPremiumUsd,15);assert.equal(use.requests,6);assert.equal(saved.entries[0].sample.usedPercent,12);
 assert.ok(!Object.hasOwn(use,'voiceUsd')&&!Object.hasOwn(use,'voiceMs')&&!Object.hasOwn(use,'taskQuotaBaseUsd'));
});
test('late diagnostics cannot overwrite a disconnected state',async t=>{
 const v=new VoiceUsage(fixture(t));let finish;const session={evaluate:()=>new Promise(r=>{finish=r;})};v.inspect();v.sample(session,'t',epoch);v.sample(null,'t',epoch+1000);finish({phase:'active',checkedAtMs:epoch});await tick();assert.equal(v.sample(null,'t',epoch+2000).state,'unchecked');
});