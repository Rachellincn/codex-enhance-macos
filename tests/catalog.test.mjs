import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Catalog } from '../collector/catalog.mjs';

test('recent picker excludes internal agents before limiting, retaining unnamed user conversations', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-picker-'));
  const db = new DatabaseSync(path.join(dir, 'state_5.sqlite'));
  db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, title TEXT, rollout_path TEXT, model TEXT, reasoning_effort TEXT, source TEXT, agent_path TEXT, created_at INTEGER, updated_at INTEGER, archived INTEGER)`);
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, 100, ?, ?)');
  for (let i = 0; i < 60; i++) insert.run(`agent-${i}`, null, '', JSON.stringify({subagent:{thread_spawn:{parent_thread_id:'normal'}}}), '/root/worker', 1000 + i, 0);
  insert.run('guardian', 'Named internal agent', '', JSON.stringify({subagent:'guardian'}), null, 999, 0);
  insert.run('path-agent', null, '', 'vscode', '/root/worker', 998, 0);
  insert.run('normal', 'Normal user task', 'prompt', 'vscode', '/root', 900, 0);
  insert.run('blank', null, '', 'cli', null, 899, 0);
  insert.run('archived', 'Archived user task', '', 'vscode', '/root', 901, 1);
  db.close();
  const catalog = new Catalog(dir);
  t.after(() => { catalog.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  assert.deepEqual(catalog.recent().map(x => x.id), ['normal','blank']);
  assert.equal(catalog.recent()[1].title, '未命名任务');
  assert.equal(catalog.recent()[1].createdAtMs, 100000);
  assert.equal(catalog.isInternal('guardian'), true);
  assert.equal(catalog.isInternal('path-agent'), true);
  assert.equal(catalog.isInternal('normal'), false);
  assert.equal(catalog.isInternal('missing'), false);
});

test('returning after more than eight tasks restores only the same turn phase checkpoint',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-phases-'));
 const db=new DatabaseSync(path.join(dir,'state_5.sqlite'));
 db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,name TEXT,title TEXT,rollout_path TEXT,model TEXT,reasoning_effort TEXT,source TEXT,agent_path TEXT,created_at INTEGER,updated_at INTEGER,archived INTEGER)');
 const epoch=Date.parse('2026-09-28T00:00:00Z');
 for(let i=0;i<10;i++) {
  const file=path.join(dir,`${i}.jsonl`),id=`task-${i}`;
  fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id}})+'\n'+JSON.stringify({type:'event_msg',timestamp:new Date(epoch).toISOString(),payload:{type:'task_started',turn_id:'turn',started_at:new Date(epoch).toISOString()}})+'\n');
  db.prepare('INSERT INTO threads VALUES (?,NULL,?,?,NULL,NULL,?,?,0,0,0)').run(id,id,file,'cli','/root');
 }
 db.close();const catalog=new Catalog(dir);t.after(()=>{catalog.close();fs.rmSync(dir,{recursive:true,force:true});});
 const runtime={turns:[{id:'turn',startedAtMs:epoch,status:'inProgress',items:[]}]};
 const first=catalog.sample('task-0').state;first.runtime(runtime,epoch+1000);first.pauseTiming(true);
 for(let i=1;i<10;i++)catalog.sample(`task-${i}`).state.runtime(runtime,epoch+1000+i*1000);
 assert.equal(catalog.states.has('task-0'),false);
 const returned=catalog.sample('task-0').state;returned.runtime(runtime,epoch+40000);
 assert.equal(returned.snapshot(epoch+41000,true).activity.startedAtMs,epoch+1000);
 assert.equal(returned.snapshot(epoch+41000,true).activity.elapsedMs,40000);
});
