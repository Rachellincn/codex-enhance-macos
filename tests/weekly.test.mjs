import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { normalizeQuota, equivalentWindow } from '../collector/quota.mjs';
import { priceUsage, quotaAmount, quotaOptions } from '../collector/pricing.mjs';
import { UsageLedger, keyed } from '../collector/usage-ledger.mjs';

test('quota follows account plan and actual windows, and never emits an account id', () => {
  const now=Date.now(), reset=Math.floor(now/1000)+86400;
  const raw={authType:'chatgpt',plan:'pro',accountId:'PRIVATE',checkedAtMs:now,windows:[{minutes:300,usedPercent:10,resetsAt:Math.floor(now/1000)+3600},{minutes:10080,usedPercent:6,resetsAt:reset}]};
  const pro=normalizeQuota(raw,'salt',now); assert.deepEqual(pro.windows.map(w=>w.label),['7d']); assert.equal(pro.windows[0].remainingPercent,94); assert.ok(!JSON.stringify(pro).includes('PRIVATE'));
  assert.deepEqual(normalizeQuota({...raw,plan:'plus'},'salt',now).windows.map(w=>w.label),['5h','7d']);
  assert.equal(normalizeQuota({...raw,authType:'apiKey'},'salt',now).state,'unavailable');
  assert.equal(normalizeQuota({...raw,windows:[{minutes:10080,usedPercent:5,resetsAt:1}]},'salt',now).windows.length,0);
});
test('pricing separates cached reads, cache writes, output and long-context/fast rates', () => {
  const r={model:'gpt-6-astra',tier:'default',input:100000,cached:80000,writes:0,output:1000};
  assert.equal(priceUsage(r).usd,.33);
  assert.equal(priceUsage({...r,tier:'fast'}).usd,.66);
  assert.equal(priceUsage({...r,input:300000,cached:280000}).usd,1.035);
  assert.equal(priceUsage({...r,input:10000,cached:5000,writes:2000,output:0}).usd,.06);
  assert.equal(priceUsage({...r,model:'unknown'}),null); assert.equal(priceUsage({...r,cached:100001}),null);
});
test('total equivalent is withheld for partial, reset or poorly sampled observations', () => {
  const w={usedPercent:50,minutes:10080,accountIdentified:true};const u={usd:133,unpricedRequests:0,parseErrors:0};
  assert.equal(equivalentWindow(w,u,true).estimatedTotalUsd,266); assert.equal(equivalentWindow(w,u,true).estimatedRemainingUsd,133);
  for(const view of [equivalentWindow(w,u,false),equivalentWindow({...w,usedPercent:1},u,true),equivalentWindow({...w,resetDetected:true},u,true),equivalentWindow(w,{...u,unpricedRequests:1},true),equivalentWindow({...w,accountIdentified:false},u,true)]) assert.equal(view.estimatedTotalUsd,null);
});
test('Fast is normalized with the subscription factor, not the API price multiplier', () => {
  const fast=priceUsage({model:'gpt-6-astra',tier:'fast',input:100000,cached:80000,writes:0,output:1000});
  assert.ok(Math.abs(fast.usd-.66)<1e-10); assert.ok(Math.abs(fast.ordinaryQuotaUsd-.825)<1e-10);
  const view=equivalentWindow({usedPercent:50,accountIdentified:true},{usd:fast.usd,ordinaryQuotaUsd:fast.ordinaryQuotaUsd,unpricedRequests:0,parseErrors:0},true);
  assert.ok(Math.abs(view.estimatedTotalUsd-1.65)<1e-10); assert.ok(Math.abs(view.estimatedRemainingUsd-.825)<1e-10);
});
test('child inherited usage and third-party providers do not enter the official ledger', () => {
  const at=Date.now(), parser=new UsageLedger('s');
  parser.accept({type:'session_meta',timestamp:new Date(at).toISOString(),payload:{id:'child',model_provider:'openai',parent_thread_id:'parent',subagent_history_start_ordinal:10,base_instructions:'PRIVATE'}});
  const usage={input_tokens:100,cached_input_tokens:20,output_tokens:10};
  assert.equal(parser.accept({type:'token_usage_record',ordinal:9,timestamp:new Date(at+1).toISOString(),payload:{thread_id:'child',response_id:'inherited',usage}}),null);
  assert.equal(parser.accept({type:'token_usage_record',ordinal:12,timestamp:new Date(at+1).toISOString(),payload:{thread_id:'parent',usage}}),null);
  assert.ok(!JSON.stringify(parser.state).includes('PRIVATE'));
  assert.ok(parser.accept({type:'token_usage_record',ordinal:13,timestamp:new Date(at+2).toISOString(),payload:{thread_id:'child',response_id:'own',usage}}));
});
test('Astra and Fast switches compose independently without changing API pricing', () => {
  const r={model:'gpt-6-astra',tier:'fast',input:300000,cached:280000,writes:0,output:1000};
  const p=priceUsage(r), w={usedPercent:10,accountIdentified:true};
  assert.deepEqual(quotaOptions(),{includeAstraLongContext:false,normalizeFast:true});
  // Base = .2 + .28 + .05 = .53; long adds .48 + .025 = .505.
  for (const [astra,fast,expected] of [[false,false,.53],[true,false,1.035],[false,true,1.325],[true,true,2.5875]]) {
    const v=equivalentWindow(w,p,true,{includeAstraLongContext:astra,normalizeFast:fast});
    assert.ok(Math.abs(v.ordinaryQuotaUsd-expected)<1e-9);
    assert.ok(Math.abs(v.estimatedTotalUsd-expected*10)<1e-9);
    assert.ok(Math.abs(v.usd-2.07)<1e-9);
  }
  const unknown=priceUsage({...r,tier:''});
  const v=equivalentWindow(w,unknown,true);
  assert.ok(Math.abs(v.unknownSpeedTotalUsd-13.25)<1e-9);
  assert.equal(equivalentWindow(w,unknown,true,{normalizeFast:false}).unknownSpeedTotalUsd,null);
  assert.equal(quotaAmount(priceUsage({...r,model:'gpt-6-sol'}),{includeAstraLongContext:true}).ordinaryQuotaUsd,quotaAmount(priceUsage({...r,model:'gpt-6-sol'}),{includeAstraLongContext:false}).ordinaryQuotaUsd);
});
test('Codex quota includes cache writes as ordinary input without the API write surcharge', () => {
  const p=priceUsage({model:'gpt-6-astra',tier:'standard',input:10000,cached:5000,writes:2000,output:0});
  assert.ok(Math.abs(p.quotaBaseUsd-.055)<1e-9);
  assert.ok(Math.abs(p.usd-.06)<1e-9);
});
test('persistent worker deduplicates mirror orders and copies, adds new tails, and keeps source logs read-only', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-weekly-')); const home=path.join(root,'home'), stateDir=path.join(root,'cache');
  fs.mkdirSync(path.join(home,'sessions'),{recursive:true});fs.mkdirSync(path.join(home,'archived_sessions'),{recursive:true});fs.mkdirSync(stateDir);
  const oldCache=new DatabaseSync(path.join(stateDir,'weekly-usage.sqlite'));
  oldCache.exec("CREATE TABLE records(key TEXT PRIMARY KEY); INSERT INTO records VALUES('bad-old-index'); CREATE TABLE files(key TEXT PRIMARY KEY);");oldCache.close();
  const at=Date.now()-10000, stamp=n=>new Date(at+n).toISOString(), usage=n=>({input_tokens:1000*n,cached_input_tokens:800*n,cache_write_input_tokens:0,output_tokens:10*n});
  const rows=[{type:'session_meta',timestamp:stamp(0),payload:{id:'task',model_provider:'openai',creator_account_id:'acct'}},{type:'turn_context',timestamp:stamp(1),payload:{turn_id:'turn',model:'gpt-6-astra',service_tier:'default'}}];
  const record=(id,time,total)=>({type:'token_usage_record',timestamp:stamp(time),payload:{thread_id:'task',turn_id:'turn',response_id:id,usage:usage(1),thread_token_usage:usage(total)}});
  const counter=(time,total)=>({type:'event_msg',timestamp:stamp(time),payload:{type:'token_count',info:{last_token_usage:usage(1),total_token_usage:usage(total)}}});
  // Actual failure: request ledger and UI counter have different cumulative totals.
  rows.push(record('r1',100,1),counter(101,20),counter(200,30),record('r2',201,2));
  const file=path.join(home,'sessions','fixture.jsonl');const text=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';fs.writeFileSync(file,text);fs.writeFileSync(path.join(home,'archived_sessions','copy.jsonl'),text);
  const worker=new Worker(new URL('../collector/weekly-worker.mjs',import.meta.url),{workerData:{home,stateDir,salt:'salt'},execArgv:['--no-warnings']});
  t.after(async()=>{await worker.terminate();const base=path.resolve(os.tmpdir())+path.sep;if(!path.resolve(root).startsWith(base)||!path.basename(root).startsWith('codex-weekly-'))throw Error('unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
  async function query(id,startMs=at-1000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),10000);const receive=m=>{if(m.queryId!==id||(!m.complete&&!m.error))return;clearTimeout(timer);worker.off('message',receive);m.error?reject(Error('worker failed')):resolve(m);};worker.on('message',receive);worker.postMessage({type:'query',queryId:id,quota:{accountKey:keyed('salt','acct'),checkedAtMs:at+11000,windows:[{minutes:10080,startMs}]}});});}
  const first=await query(1);assert.equal(first.windows[0].requests,2);assert.ok(Math.abs(first.windows[0].usd-.0066)<1e-9);assert.equal(fs.readFileSync(file,'utf8'),text);
  assert.equal((await query(2)).windows[0].requests,2);
  fs.appendFileSync(file,JSON.stringify(record('r3',300,3))+'\n');assert.equal((await query(3)).windows[0].requests,3);
  // A distinct legacy-only turn must remain available, even with identical usage.
  const legacy=[{type:'turn_context',timestamp:stamp(400),payload:{turn_id:'legacy-turn',model:'gpt-6-astra'}},counter(401,50),counter(402,51)];
  fs.appendFileSync(file,legacy.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const mixed=await query(4);assert.equal(mixed.windows[0].requests,5);assert.equal(mixed.windows[0].ledgerRequests,3);assert.equal(mixed.windows[0].legacyRequests,2);
  // Old and future bad rows, plus untimed failures, must not become this week's errors.
  fs.appendFileSync(file,'{"timestamp":"'+stamp(-100000)+'","type":"token_usage_record",BROKEN}\n'+
    '{"timestamp":"'+stamp(999999)+'","type":"token_usage_record",BROKEN}\n'+
    '{"type":"token_usage_record",BROKEN}\n');
  const scoped=await query(5);assert.equal(scoped.windows[0].parseErrors,0);assert.equal(scoped.windows[0].unscopedParseErrors,1);
  assert.equal((await query(6,at-200000)).windows[0].parseErrors,1);
  fs.appendFileSync(file,'{"timestamp":"'+stamp(500)+'","type":"token_usage_record",BROKEN}\n');
  assert.equal((await query(7)).windows[0].parseErrors,1);
  const foreign=[{type:'session_meta',timestamp:stamp(0),payload:{id:'foreign',model_provider:'openai',creator_account_id:'other'}},
    {type:'turn_context',timestamp:stamp(1),payload:{turn_id:'foreign-turn',model:'gpt-6-astra'}},
    {type:'token_usage_record',timestamp:stamp(200),payload:{thread_id:'foreign',response_id:'foreign-response',usage:usage(10)}}];
  fs.writeFileSync(path.join(home,'sessions','foreign.jsonl'),foreign.map(r=>JSON.stringify(r)).join('\n')+'\n{"timestamp":"'+stamp(500)+'","type":"token_usage_record",BROKEN}\n');
  const filtered=await query(8); assert.equal(filtered.windows[0].requests,5);assert.equal(filtered.windows[0].parseErrors,1);assert.equal(filtered.windows[0].excludedAccountRequests,1);
  assert.equal(filtered.windows[0].unattributedRequests,0);
  const unknown=[{type:'session_meta',timestamp:stamp(-600000),payload:{id:'unattributed',model_provider:'openai'}},
    {type:'turn_context',timestamp:stamp(-599999),payload:{turn_id:'old',model:'gpt-6-astra',service_tier:null}},
    {type:'token_usage_record',timestamp:stamp(-500000),payload:{thread_id:'unattributed',response_id:'old-missing-fields',usage:usage(100)}},
    {type:'token_usage_record',timestamp:stamp(700),payload:{thread_id:'unattributed',response_id:'current-missing-fields',usage:usage(1)}}];
  fs.writeFileSync(path.join(home,'sessions','unknown.jsonl'),unknown.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const current=await query(9);assert.equal(current.windows[0].unattributedRequests,1);assert.equal(current.windows[0].assumedTierRequests,1);assert.equal(current.windows[0].requests,6);
  const after=await query(10,at+800);assert.equal(after.windows[0].requests,0);assert.equal(after.windows[0].unattributedRequests,0);assert.equal(after.windows[0].assumedTierRequests,0);assert.equal(after.windows[0].parseErrors,0);
});
