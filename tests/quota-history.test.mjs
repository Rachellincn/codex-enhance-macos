import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuotaHistory } from '../collector/quota-history.mjs';
import { equivalentWindow } from '../collector/quota.mjs';
const epoch=Date.parse('2026-09-20T06:18:38Z'),week=7*86400000,account='a'.repeat(64),other='b'.repeat(64);
function setup(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-week-history-'));
 t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('codex-week-history-'))throw Error('unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
 return {root,history:new QuotaHistory(root)};
}
function sample(start=epoch,cutoff=start+week-60000,key=account) {
 return {state:'ready',accountKey:key,plan:'pro',checkedAtMs:cutoff,windows:[{minutes:10080,startMs:start,resetsAtMs:start+week,usedPercent:50}]};
}
const aggregate=(extra={})=>({complete:true,windows:[{minutes:10080,requests:10,tokens:100000,usd:240,quotaBaseUsd:100,astraPremiumUsd:40,quotaFastPremiumUsd:50,astraFastPremiumUsd:20,parseErrors:0,scanErrors:0,unpricedRequests:0,fastRequests:3,...extra}]});
test('weekly records keep the real reset period and pair historical cost with its observed percentage',t=>{
 const {root,history}=setup(t);const first=sample();history.record(first,aggregate());
 history.record(sample(epoch+week,epoch+week+1000),aggregate({quotaBaseUsd:1}));
 const restored=new QuotaHistory(root);const view=restored.view(account,equivalentWindow,{},epoch+week+1000);
 assert.equal(view.entries.length,2);const closed=view.entries[1];assert.equal(closed.closed,true);assert.equal(closed.startMs,epoch);assert.equal(closed.resetsAtMs,epoch+week);
 assert.equal(closed.usedPercent,50);assert.equal(closed.estimatedTotalUsd,300);assert.equal(closed.checkedAtMs,first.checkedAtMs);assert.equal(closed.observationGapMs,60000);
 assert.equal(view.entries[0].closed,false);
});
test('historical switches reproject saved components without rewriting observations or API values',t=>{
 const {root,history}=setup(t);history.record(sample(),aggregate());const before=fs.readFileSync(path.join(root,'quota-history.json'),'utf8');
 const combos=[[false,false,200],[true,false,280],[false,true,300],[true,true,420]];
 for(const [astra,fast,total] of combos){const row=history.view(account,equivalentWindow,{includeAstraLongContext:astra,normalizeFast:fast},epoch+week+1).entries[0];assert.equal(row.estimatedTotalUsd,total);assert.equal(row.usd,240);}
 assert.equal(fs.readFileSync(path.join(root,'quota-history.json'),'utf8'),before);
});
test('account switching, repeated samples and late worker replies never mix weekly records',t=>{
 const {history}=setup(t);history.record(sample(),aggregate());history.record(sample(),aggregate());history.record(sample(epoch,epoch+week-90000),aggregate({quotaBaseUsd:999}));
 history.record(sample(epoch,epoch+week-30000,other),aggregate({quotaBaseUsd:888}));
 assert.equal(history.view(account,equivalentWindow,{},epoch).entries.length,1);
 assert.equal(history.view(account,equivalentWindow,{},epoch).entries[0].quotaBaseUsd,100);
 assert.equal(history.view(other,equivalentWindow,{},epoch).entries[0].quotaBaseUsd,888);
 assert.equal(history.view(null,equivalentWindow,{},epoch).entries.length,0);
});
test('partial indexing and scan errors cannot replace a valid pair; same-window rebounds stay flagged',t=>{
 const {history}=setup(t);const q=sample();history.record(q,{...aggregate(),complete:false});assert.equal(history.entries.length,0);
 history.record(q,aggregate());q.checkedAtMs+=1000;history.record(q,aggregate({scanErrors:1,quotaBaseUsd:2}));assert.equal(history.entries[0].sample.usage.quotaBaseUsd,100);
 q.windows[0].resetDetected=true;q.windows[0].usedPercent=20;history.record(q,aggregate());
 q.checkedAtMs+=1000;q.windows[0].resetDetected=false;history.record(q,aggregate());
 const row=history.view(account,equivalentWindow,{},epoch+week).entries[0];assert.equal(row.estimatedTotalUsd,null);assert.ok(row.estimateReasons.includes('quota_rebounded'));
});
test('history whitelists stored data, bounds retention and preserves an unreadable original',t=>{
 const {root,history}=setup(t);
 for(let n=0;n<29;n++)history.record(sample(epoch+n*week),aggregate({title:'PRIVATE',prompt:'PRIVATE',accountId:'PRIVATE',models:[{model:'gpt-6-astra',requests:3,usd:12,content:'PRIVATE'}]}));
 const text=fs.readFileSync(path.join(root,'quota-history.json'),'utf8');assert.ok(!text.includes('PRIVATE'));assert.equal(history.entries.length,26);
 fs.writeFileSync(path.join(root,'quota-history.json'),'{BROKEN ORIGINAL');const bad=new QuotaHistory(root);bad.record(sample(),aggregate());
 assert.equal(bad.error,'read_failed');assert.equal(fs.readFileSync(path.join(root,'quota-history.json'),'utf8'),'{BROKEN ORIGINAL');
 const invalid=JSON.stringify({schema:1,entries:[{accountKey:account,startMs:epoch,resetsAtMs:epoch+week,firstObservedAtMs:epoch}]});
 fs.writeFileSync(path.join(root,'quota-history.json'),invalid);const missingSample=new QuotaHistory(root);
 assert.equal(missingSample.view(account,equivalentWindow,{},epoch).state,'unavailable');
 missingSample.record(sample(),aggregate());assert.equal(fs.readFileSync(path.join(root,'quota-history.json'),'utf8'),invalid);
});
test('an early reset archives the replaced window without treating it as a second active week',t=>{
 const {history}=setup(t);history.record(sample(epoch,epoch+100000),aggregate());
 history.record(sample(epoch+200000,epoch+300000),aggregate({quotaBaseUsd:1}));
 const rows=history.view(account,equivalentWindow,{},epoch+400000).entries;
 assert.equal(rows[0].closed,false);assert.equal(rows[1].closed,true);assert.equal(rows[1].adjusted,true);
 assert.equal(rows[1].observationGapMs,200000);assert.equal(rows[1].usedPercent,50);
});

test('independent quota refresh works without CDP and saved history remains available offline',async t=>{
 const {WeeklyQuota}=await import('../collector/quota.mjs');
 const {root}=setup(t),now=Date.now();
 const pricing={catalog:{revision:1,verifiedAt:'2026-10-03'},sample:()=>({}),refresh:()=>{},close:()=>{}};
 const weekly=new WeeklyQuota(root,root,{pricingUpdates:pricing});t.after(()=>weekly.close());
 weekly.queryUsage=()=>{};
 let reads=0;
 const source={readQuota:async()=>{reads++;return {authType:'chatgpt',plan:'team',accountId:'private',checkedAtMs:now,windows:[{minutes:10080,usedPercent:40,resetsAt:Math.floor(now/1000)+3600}]};}};
 weekly.sample(source);await weekly.pending;
 const ready=weekly.sample(source);assert.equal(ready.state,'ready');assert.equal(ready.windows[0].remainingPercent,60);assert.equal(reads,1);
 weekly.history.record(weekly.rawQuota,aggregate());
 weekly.refresh();weekly.sample(source);await weekly.pending;assert.equal(reads,2);
 const offline=weekly.sample(null);assert.equal(offline.state,'unavailable');assert.equal(offline.historyCached,true);assert.equal(offline.history.entries.length,1);assert.equal(offline.windows.length,0);
});
