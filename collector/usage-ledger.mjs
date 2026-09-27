import { createHash } from 'node:crypto';
export const keyed = (salt, value) => createHash('sha256').update(salt + '\0' + String(value)).digest('hex');
const num = value => Number.isFinite(value) && value >= 0 ? value : null;
export function tokenVector(u) {
  if (!u) return null;
  const input = num(u.input_tokens), output = num(u.output_tokens);
  if (input == null || output == null || input + output <= 0) return null;
  return { input, output, cached: num(u.cached_input_tokens), writes: num(u.cache_write_input_tokens) ?? 0 };
}
const tuple = u => u ? [u.input, u.cached, u.output] : null;
export class UsageLedger {
  constructor(salt, state = {}) { this.salt = salt; this.state = { line: 0, model: null, tier: null, ...state }; }
  accept(row) {
    this.issue = null;
    const s = this.state, p = row.payload ?? {}, at = Date.parse(row.timestamp);
    s.line++;
    if (row.type === 'session_meta') {
      if (!s.meta) s.meta = { key: keyed(this.salt, p.id ?? p.thread_id ?? p.session_id), created: Date.parse(p.timestamp ?? row.timestamp),
        boundary: Number(p.subagent_history_start_ordinal) || 0, forked: !!(p.forked_from_id || p.parent_thread_id || p.source?.subagent), provider: p.model_provider,
        accountKey: p.creator_account_id ? keyed(this.salt, p.creator_account_id) : null };
      return null;
    }
    if (!s.meta || !Number.isFinite(at)) return null;
    const ordinal = Number.isFinite(row.ordinal) ? row.ordinal : null;
    if ((s.meta.boundary && ordinal != null && ordinal <= s.meta.boundary) || (s.meta.forked && at < s.meta.created) || (p.thread_id && keyed(this.salt, p.thread_id) !== s.meta.key)) return null;
    if (row.type === 'turn_context') {
      s.model = p.model ?? s.model;
      if (Object.hasOwn(p,'service_tier') || Object.hasOwn(p,'serviceTier')) s.tier = p.service_tier ?? p.serviceTier ?? null;
    }
    if (p.type === 'thread_settings_applied') {
      s.model = p.thread_settings?.model ?? s.model;
      if (p.thread_settings && Object.hasOwn(p.thread_settings,'service_tier')) s.tier = p.thread_settings.service_tier;
    }
    if (p.turn_id) s.turnKey = keyed(this.salt, p.turn_id);
    if (p.type === 'task_started') s.tier = s.tier ?? null;
    if (s.meta.provider !== 'openai') return null;
    const ledger = row.type === 'token_usage_record', counter = row.type === 'event_msg' && p.type === 'token_count';
    if (!ledger && !counter) return null;
    const usage = tokenVector(ledger ? p.usage : p.info?.last_token_usage);
    const cumulative = tokenVector(ledger ? p.thread_token_usage ?? p.total_token_usage : p.info?.total_token_usage);
    // Do not turn cumulative context/usage into one fictitious request.
    if (!usage) return null;
    if (!ledger && !cumulative) {
      this.issue = { at, accountKey: s.meta.accountKey, scopeKey: keyed(this.salt, `${s.meta.key}:${s.turnKey ?? 'unscoped'}`) };
      return null;
    }
    if (p.service_tier) s.tier = p.service_tier;
    const signature = keyed(this.salt, JSON.stringify([s.meta.key, s.turnKey, tuple(cumulative), tuple(usage)]));
    const canonical = ledger && typeof p.response_id === 'string' && p.response_id.length > 0;
    return { key: canonical ? keyed(this.salt, `response:${p.response_id}`) : signature, signature,
      scopeKey: keyed(this.salt, `${s.meta.key}:${s.turnKey ?? 'unscoped'}`),
      kind: canonical ? 'ledger' : 'counter', at, model: s.model ?? 'unknown', tier: s.tier ?? '', accountKey: s.meta.accountKey, ...usage };
  }
}
