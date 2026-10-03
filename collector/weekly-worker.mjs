import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JsonlTail } from './tail.mjs';
import { UsageLedger, keyed } from './usage-ledger.mjs';
import { priceUsage } from './pricing.mjs';
import {BUNDLED_PRICING,validatePricing} from './price-catalog.mjs';

const { home, stateDir, salt } = workerData;
const db = new DatabaseSync(path.join(stateDir, 'weekly-usage.sqlite'));
// Rebuild tier assignments from original records after removing unscoped Fast
// inheritance. This drops only the disposable companion index, never source logs.
// Response-ID ledger remains authoritative over UI counters in the same turn.
if (db.prepare('PRAGMA user_version').get().user_version !== 4) {
  db.exec('BEGIN; DROP TABLE IF EXISTS records; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS issues; PRAGMA user_version=4; COMMIT;');
}
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
 CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, identity TEXT, offset INTEGER, state TEXT, errors INTEGER);
 CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, signature TEXT, kind TEXT, at REAL, model TEXT, tier TEXT, account_key TEXT, input REAL, cached REAL, writes REAL, output REAL, scope_key TEXT);
 CREATE INDEX IF NOT EXISTS records_time ON records(at); CREATE INDEX IF NOT EXISTS records_signature ON records(signature);
 CREATE INDEX IF NOT EXISTS records_scope ON records(scope_key,kind);`);
db.exec('CREATE TABLE IF NOT EXISTS issues (key TEXT PRIMARY KEY, at REAL, account_key TEXT, scope_key TEXT); CREATE INDEX IF NOT EXISTS issues_time ON issues(at);');
const issueWrite = db.prepare('INSERT OR REPLACE INTO issues VALUES (?,?,?,?)');
const findKey = db.prepare('SELECT kind FROM records WHERE key=?');
const findSignature = db.prepare('SELECT key,kind FROM records WHERE signature=?');
const insert = db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
const remove = db.prepare('DELETE FROM records WHERE key=?');
const canonicalTurn = db.prepare("SELECT 1 FROM records WHERE scope_key=? AND kind='ledger' LIMIT 1");
const removeCounters = db.prepare("DELETE FROM records WHERE scope_key=? AND kind='counter'");
const fileRead = db.prepare('SELECT * FROM files WHERE key=?');
const fileWrite = db.prepare('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?)');
function put(record) {
  if (!record) return;
  // UI counters and request-ledger cumulative totals can disagree after resume
  // or compaction. Never charge both representations within a canonical turn.
  if (record.kind === 'counter' && canonicalTurn.get(record.scopeKey)) return;
  if (record.kind === 'ledger') removeCounters.run(record.scopeKey);
  const duplicate = findKey.get(record.key);
  if (duplicate) { if (duplicate.kind === 'counter' && record.kind === 'ledger') remove.run(record.key); else return; }
  const old = findSignature.get(record.signature);
  if (record.kind === 'counter' && old) return;
  if (record.kind === 'ledger' && old?.kind === 'counter') remove.run(old.key);
  insert.run(record.key, record.signature, record.kind, record.at, record.model, record.tier, record.accountKey, record.input, record.cached, record.writes, record.output, record.scopeKey);
}
let wanted = null, running = false;
const yieldTick = () => new Promise(resolve => setImmediate(resolve));
function discover(start) {
  const files = new Map();
  for (const folder of ['sessions', 'archived_sessions']) {
    const root = path.join(home, folder);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(entry.parentPath, entry.name);
      try { const stat = fs.statSync(file); if (stat.mtimeMs >= start - 86400000) files.set(file.toLowerCase(), { file, stat }); } catch {}
    }
  }
  return [...files.values()].sort((a,b) => a.file.localeCompare(b.file));
}
function totals(window, quota, scanErrors, pricing) {
  const accountFilter = 'AND (? IS NULL OR account_key IS NULL OR account_key=?)';
  const validIssue = "AND (scope_key IS NULL OR NOT EXISTS (SELECT 1 FROM records WHERE records.scope_key=issues.scope_key AND kind='ledger'))";
  const parseErrors = db.prepare(`SELECT count(*) AS n FROM issues WHERE at>=? AND at<=? ${accountFilter} ${validIssue}`).get(window.startMs, quota.checkedAtMs, quota.accountKey, quota.accountKey).n;
  const unscopedParseErrors = db.prepare(`SELECT count(*) AS n FROM issues WHERE at IS NULL ${accountFilter} ${validIssue}`).get(quota.accountKey, quota.accountKey).n;
  const out = { minutes: window.minutes, requests: 0, tokens: 0, input: 0, cached: 0, output: 0, usd: 0, unpricedRequests: 0, unpricedTokens: 0,
    unattributedRequests: 0, assumedTierRequests: 0, excludedAccountRequests: 0, parseErrors, unscopedParseErrors, scanErrors, models: [],
    standardUsd: 0, longContextPremiumUsd: 0, fastPremiumUsd: 0, ledgerRequests: 0, legacyRequests: 0,
    standardModeUsd: 0, ordinaryQuotaUsd: 0, speedNormalizationUsd: 0, unnormalizedRequests: 0, fastRequests: 0,
    quotaBaseUsd: 0, astraPremiumUsd: 0, quotaFastPremiumUsd: 0, astraFastPremiumUsd: 0, unknownSpeedPremiumUsd: 0, astraUnknownSpeedPremiumUsd: 0 };
  const models = new Map();
  for (const r of db.prepare('SELECT * FROM records WHERE at>=? AND at<=?').iterate(window.startMs, quota.checkedAtMs)) {
    if (quota.accountKey && r.account_key && quota.accountKey !== r.account_key) { out.excludedAccountRequests++; continue; }
    out.requests++; out.input += r.input; out.output += r.output; out.cached += r.cached ?? 0; out.tokens += r.input + r.output;
    if (r.kind === 'ledger') out.ledgerRequests++; else out.legacyRequests++;
    if (!r.account_key || !quota.accountKey) out.unattributedRequests++;
    const price = priceUsage(r,pricing); const model = models.get(r.model) ?? { model: r.model, requests: 0, usd: 0, unpriced: 0 };
    model.requests++;
    if (!price) { out.unpricedRequests++; out.unpricedTokens += r.input + r.output; model.unpriced++; }
    else {
      out.usd += price.usd; model.usd += price.usd; out.standardUsd += price.standardUsd; out.longContextPremiumUsd += price.longContextPremiumUsd; out.fastPremiumUsd += price.fastPremiumUsd;
      out.standardModeUsd += price.standardModeUsd;
      for (const key of ['quotaBaseUsd', 'astraPremiumUsd', 'quotaFastPremiumUsd', 'astraFastPremiumUsd', 'unknownSpeedPremiumUsd', 'astraUnknownSpeedPremiumUsd']) out[key] += price[key] ?? 0;
      if (price.ordinaryQuotaUsd == null) out.unnormalizedRequests++;
      else { out.ordinaryQuotaUsd += price.ordinaryQuotaUsd; out.speedNormalizationUsd += price.speedNormalizationUsd; }
      if (price.fast) out.fastRequests++; if (price.assumedTier) out.assumedTierRequests++;
    }
    models.set(r.model, model);
  }
  out.pricingCoverage = out.tokens ? (out.tokens - out.unpricedTokens) / out.tokens : null;
  out.models = [...models.values()].sort((a,b) => b.usd-a.usd);
  return out;
}
async function processQuery(query) {
  const pricing=query.pricing?validatePricing(query.pricing):BUNDLED_PRICING;
  if(!pricing)throw Error('Invalid price catalog');
  const start = Math.min(...query.quota.windows.map(w => w.startMs));
  const files = discover(start);
  // A rewritten/truncated source invalidates checkpoints. Rebuild only our cache.
  const rewritten = files.some(({file,stat}) => { const old = fileRead.get(keyed(salt,file.toLowerCase())); return old && (stat.size < old.offset || old.identity !== `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`); });
  if (rewritten) db.exec('DELETE FROM records; DELETE FROM files; DELETE FROM issues;');
  let done = 0, lastPublish = 0, errors = 0;
  for (const {file,stat} of files) {
    const key = keyed(salt, file.toLowerCase()), cached = fileRead.get(key);
    let state = {}; try { state = JSON.parse(cached?.state ?? '{}'); } catch {}
    const parser = new UsageLedger(salt, state);
    const issue = (at, accountKey, scopeKey = null) => {
      parser.state.issueOrdinal = (parser.state.issueOrdinal ?? 0) + 1;
      issueWrite.run(keyed(salt, `${key}:${parser.state.issueOrdinal}`), Number.isFinite(at) ? at : null, accountKey ?? null, scopeKey);
    };
    const tail = new JsonlTail(file, row => {
      put(parser.accept(row));
      if (parser.issue) issue(parser.issue.at, parser.issue.accountKey, parser.issue.scopeKey);
    }, prefix => {
      if (parser.state.meta?.provider && parser.state.meta.provider !== 'openai') return;
      issue(Date.parse(/"timestamp"\s*:\s*"([^"]+)"/.exec(prefix)?.[1]), parser.state.meta?.accountKey);
    });
    tail.offset = cached?.offset ?? 0; tail.identity = cached?.identity ?? null;
    let caughtUp = false;
    while (!caughtUp) {
      db.exec('BEGIN');
      try {
        const result = tail.read(4 * 1024 * 1024); caughtUp = result.caughtUp;
        fileWrite.run(key, tail.identity ?? `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, tail.offset-tail.pending.length, JSON.stringify(parser.state), (cached?.errors ?? 0) + tail.malformed);
        db.exec('COMMIT');
      } catch { db.exec('ROLLBACK'); errors++; break; }
      if (Date.now() - lastPublish > 400) {
        lastPublish = Date.now(); parentPort.postMessage({ queryId: query.queryId, accountKey: query.quota.accountKey, complete: false, progress: files.length ? done/files.length : 0 });
      }
      await yieldTick();
    }
    done++;
  }
  db.prepare('DELETE FROM records WHERE at<?').run(Math.min(Date.now()-21*86400000, start-86400000));
  db.prepare('DELETE FROM issues WHERE at<?').run(Math.min(Date.now()-21*86400000, start-86400000));
  return { queryId: query.queryId, accountKey: query.quota.accountKey, complete: true, progress: 1, files: files.length,
    pricingDate:pricing.verifiedAt,pricingRevision:pricing.revision,
    windows: query.quota.windows.map(w => totals(w, query.quota, errors,pricing)) };
}
async function pump() {
  if (running) return; running = true;
  try { while (wanted) { const query = wanted; wanted = null; try { parentPort.postMessage(await processQuery(query)); } catch { parentPort.postMessage({ queryId: query.queryId, accountKey: query.quota.accountKey, error: true }); } } }
  finally { running = false; }
}
parentPort.on('message', message => { if (message.type === 'query') { wanted = message; void pump(); } });
