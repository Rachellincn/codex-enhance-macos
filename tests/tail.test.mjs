import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonlTail } from '../collector/tail.mjs';
import {ThreadState} from '../collector/state.mjs';
test('tail waits for a complete UTF-8 JSON line and only reads new bytes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-tail-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'a.jsonl'), data = Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', message: '中文测试' } }) + '\n');
  const cut = data.indexOf(Buffer.from('中文')) + 1; fs.writeFileSync(file, data.subarray(0, cut)); const records = []; const tail = new JsonlTail(file, r => records.push(r));
  tail.read(); assert.equal(records.length, 0); fs.appendFileSync(file, data.subarray(cut)); tail.read(); assert.equal(records[0].payload.message, '中文测试'); assert.equal(tail.read().bytes, 0); assert.equal(records.length, 1);
});
test('truncated file is re-read while malformed complete lines do not stop later events', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-tail-')); t.after(() => fs.rmSync(dir, { recursive: true })); const file = path.join(dir, 'a.jsonl');
  fs.writeFileSync(file, '{"type":"event_msg","payload":{"value":"long initial line"}}\n'); const records = []; const tail = new JsonlTail(file, r => records.push(r)); tail.read();
  fs.writeFileSync(file, '{"type":"event_msg"}\n'); assert.equal(tail.read().reset, true); assert.equal(records.length, 2);
  fs.appendFileSync(file, '{"type":"event_msg",broken}\n{"type":"event_msg"}\n'); tail.read(); assert.equal(tail.malformed, 1); assert.equal(records.length, 3);
});

test('file tail delivers sleep call and result lifecycle to the phase reducer',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-sleep-tail-'));t.after(()=>fs.rmSync(dir,{recursive:true}));
 const file=path.join(dir,'sleep.jsonl'),state=new ThreadState('thread');
 const rows=[{type:'event_msg',timestamp:1000,payload:{type:'task_started',turn_id:'turn'}},
 {type:'response_item',timestamp:1001,payload:{type:'function_call',name:'clock.sleep',call_id:'sleep-a'}},
 {type:'response_item',timestamp:1003,payload:{type:'function_call_output',call_id:'sleep-a',output:'done'}}];
 fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');new JsonlTail(file,r=>state.record(r)).read();
 const tool=state.tools.get('sleep-a');assert.equal(tool.status,'completed');assert.equal(tool.timingEndAtMs-tool.timingStartAtMs,2000);
});
