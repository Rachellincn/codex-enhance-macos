import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {BUNDLED_PRICING,validatePricing} from '../collector/price-catalog.mjs';
import {PricingUpdates,PRICING_URL,PRICING_INTERVAL_MS} from '../collector/pricing-updates.mjs';
import {priceUsage,subscriptionSpeedFactor} from '../collector/pricing.mjs';
import {WeeklyQuota,equivalentWindow} from '../collector/quota.mjs';
import {QuotaHistory} from '../collector/quota-history.mjs';
import {keyed} from '../collector/usage-ledger.mjs';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const newer=()=>({...structuredClone(BUNDLED_PRICING),revision:BUNDLED_PRICING.revision+1});
function setup(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-price-update-'));
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 return dir;
}
test('6.1 Sol uses its own cached-input price, API Fast multiplier and subscription factor',()=>{
 const r={model:'gpt-6.1-sol',tier:'standard',input:100000,cached:80000,writes:0,output:1000};
 near(priceUsage(r).usd,.058);near(priceUsage({...r,model:'gpt-6-sol'}).usd,.066);
 const fast=priceUsage({...r,tier:'fast'});near(fast.usd,.116);near(fast.ordinaryQuotaUsd,.145);
 near(priceUsage({...r,tier:'fast',input:300000,cached:280000}).usd,.302);
 near(priceUsage({...r,tier:'fast',input:300000,cached:280000}).ordinaryQuotaUsd,.3775);
 assert.equal(subscriptionSpeedFactor(r.model,'fast'),2.5);
 assert.equal(priceUsage({...r,model:'gpt-6.2-sol'}),null);
});
test('catalog validation rejects malformed rules and keeps only rate metadata',()=>{
 const good=newer();good.PRIVATE='secret';good.models['gpt-6.1-sol'].PRIVATE='secret';
 assert.ok(!JSON.stringify(validatePricing(good)).includes('PRIVATE'));
 for(const invalid of [
  {...good,schema:99},{...good,sources:['https://example.com/pricing']},{...good,revision:'next'},
  {...good,models:{'__proto__':{rates:[1,2,3,4]}}},
  {...good,models:{...good.models,'gpt-6.1-sol':{...good.models['gpt-6.1-sol'],rates:[2,-1,2.5,10]}}},
  {...good,models:{...good.models,'gpt-6.1-sol':{...good.models['gpt-6.1-sol'],includedFastMultiplier:'2.5'}}}
 ])assert.equal(validatePricing(invalid),null);
});
test('updates are bounded public GETs, automatic checks are throttled, and validated data survives offline restart',async t=>{
 const dir=setup(t);let now=100000,calls=[];const data=newer();
 const p=new PricingUpdates(dir,{now:()=>now,fetchFn:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(data));}});t.after(()=>p.close());
 for(let i=0;i<20;i++)p.sample();await p.pending;
 assert.equal(calls.length,1);assert.equal(calls[0].url,PRICING_URL);assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.body,undefined);
 assert.deepEqual(calls[0].options.headers,{Accept:'application/json'});
 assert.equal(p.catalog.revision,data.revision);assert.equal(p.sample().source,'remote');
 now+=PRICING_INTERVAL_MS-1;p.sample();assert.equal(calls.length,1);now++;p.sample();await p.pending;assert.equal(calls.length,2);
 p.refresh();p.sample();await p.pending;assert.equal(calls.length,3);
 const cached=fs.readFileSync(path.join(dir,'pricing-cache.json'),'utf8');
 const offline=new PricingUpdates(dir,{fetchFn:async()=>{throw Error('offline');}});t.after(()=>offline.close());offline.sample();await offline.pending;
 assert.equal(offline.catalog.revision,data.revision);assert.equal(offline.sample().error,'update_unavailable');assert.equal(fs.readFileSync(offline.file,'utf8'),cached);
});
test('older, incomplete or oversized downloads cannot replace a working cache',async t=>{
 const dir=setup(t),saved=newer();fs.writeFileSync(path.join(dir,'pricing-cache.json'),JSON.stringify(saved));
 for(const invalid of [{...saved,revision:saved.revision-1},{...saved,revision:saved.revision+1,models:{'gpt-6.1-sol':saved.models['gpt-6.1-sol']}},'x'.repeat(65537)]) {
  const p=new PricingUpdates(dir,{fetchFn:async()=>new Response(typeof invalid==='string'?invalid:JSON.stringify(invalid))});p.sample();await p.pending;p.close();
  assert.equal(p.catalog.revision,saved.revision);assert.equal(JSON.parse(fs.readFileSync(p.file,'utf8')).revision,saved.revision);
 }
});
test('missing-model checks do not loop on every poll and close rejects late replies',async t=>{
 const dir=setup(t);let now=100000,calls=0,resolve;
 const p=new PricingUpdates(dir,{now:()=>now,fetchFn:async()=>{calls++;return new Response(JSON.stringify(BUNDLED_PRICING));}});
 p.sample();await p.pending;
 for(let i=0;i<100;i++){p.observeMissing([{model:'new-model',unpriced:3}]);p.sample();}
 assert.equal(calls,1);now+=60000;p.sample();await p.pending;assert.equal(calls,2);
 for(let i=0;i<100;i++){p.observeMissing([{model:'new-model',unpriced:3}]);p.sample();}assert.equal(calls,2);p.close();
 const closed=new PricingUpdates(dir,{fetchFn:()=>new Promise(r=>resolve=r)});closed.sample();const pending=closed.pending;closed.close();resolve(new Response(JSON.stringify(newer())));await pending;
 assert.equal(closed.catalog.revision,BUNDLED_PRICING.revision);
});
test('a live price change invalidates the old aggregate and resubmits the same quota cutoff',async t=>{
 const dir=setup(t),pricing={catalog:structuredClone(BUNDLED_PRICING),sample:()=>({}),refresh(){this.refreshed=true;},close(){}};
 const q=new WeeklyQuota(dir,dir,{pricingUpdates:pricing});let sent;
 q.ensureWorker=()=>{q.worker??={postMessage:message=>sent=message,terminate:async()=>{}};};
 q.session={};q.nextAt=Infinity;
 q.rawQuota=q.view={state:'ready',accountKey:'a'.repeat(64),checkedAtMs:Date.now(),windows:[{minutes:10080,resetsAtMs:Date.now()+86400000,usedPercent:44}]};
 q.aggregate={complete:true,windows:[]};pricing.catalog.revision++;
 const view=q.sample(q.session);assert.equal(view.indexing,true);assert.equal(sent.quota.checkedAtMs,q.rawQuota.checkedAtMs);assert.equal(sent.pricing.revision,pricing.catalog.revision);
 q.refresh();assert.equal(pricing.refreshed,true);await q.close();
});
test('worker reprices previously unpriced requests from the existing ledger and history records its catalog date',async t=>{
 const root=setup(t),home=path.join(root,'home'),stateDir=path.join(root,'state');fs.mkdirSync(path.join(home,'sessions'),{recursive:true});fs.mkdirSync(stateDir);
 const at=Date.now()-10000,stamp=n=>new Date(at+n).toISOString();
 const rows=[{type:'session_meta',timestamp:stamp(0),payload:{id:'task',model_provider:'openai',creator_account_id:'account'}},
  {type:'turn_context',timestamp:stamp(1),payload:{turn_id:'turn',model:'future-model',service_tier:'fast'}},
  {type:'token_usage_record',timestamp:stamp(2),payload:{thread_id:'task',turn_id:'turn',response_id:'request',usage:{input_tokens:100000,cached_input_tokens:80000,cache_write_input_tokens:0,output_tokens:1000}}}];
 const file=path.join(home,'sessions','fixture.jsonl');const original=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';fs.writeFileSync(file,original);
 const worker=new Worker(new URL('../collector/weekly-worker.mjs',import.meta.url),{workerData:{home,stateDir,salt:'salt'},execArgv:['--no-warnings']});
 const quota={state:'ready',accountKey:keyed('salt','account'),checkedAtMs:at+1000,windows:[{minutes:10080,startMs:at-1000,resetsAtMs:at+86400000,usedPercent:50,accountIdentified:true}]};
 const query=(id,pricing)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),10000);const receive=m=>{if(m.queryId!==id||!m.complete&&!m.error)return;worker.off('message',receive);clearTimeout(timer);m.error?reject(Error('worker failed')):resolve(m);};worker.on('message',receive);worker.postMessage({type:'query',queryId:id,quota,pricing});});
 try {
  const before=await query(1,BUNDLED_PRICING);assert.equal(before.windows[0].unpricedRequests,1);
  const next=newer();next.verifiedAt='2026-10-03';next.models['future-model']=next.models['gpt-6.1-sol'];
  const after=await query(2,next);assert.equal(after.windows[0].requests,1);assert.equal(after.windows[0].unpricedRequests,0);near(after.windows[0].ordinaryQuotaUsd,.145);
  assert.equal(equivalentWindow(quota.windows[0],after.windows[0],true).estimateReasons.length,0);
  const cache=new DatabaseSync(path.join(stateDir,'weekly-usage.sqlite'),{readOnly:true});assert.equal(cache.prepare('SELECT count(*) AS n FROM records').get().n,1);cache.close();
  const h=new QuotaHistory(stateDir);h.record(quota,after);assert.equal(h.entries[0].priceDate,next.verifiedAt);
  assert.equal(fs.readFileSync(file,'utf8'),original);
 }finally{await worker.terminate();}
});
