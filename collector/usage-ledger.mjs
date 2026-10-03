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
const hasTier=p=>Object.hasOwn(p,'service_tier')||Object.hasOwn(p,'serviceTier');
const tierValue=p=>{
  const value=p.service_tier??p.serviceTier;
  return typeof value==='string'&&/^[a-z][a-z_]{0,30}$/i.test(value)?value.toLowerCase():null;
};
export class UsageLedger {
  constructor(salt, state = {}) {
    this.salt = salt; this.state = { line: 0, model: null, tierByTurn: {}, pendingTier: null, activeTurnKey: null, ...state };
    delete this.state.tier; // Old unscoped checkpoints cannot establish a current tier.
  }
  beginTurn(id) {
    const s=this.state,key=keyed(this.salt,id);
    if(s.activeTurnKey!==key) {
      if(!Object.hasOwn(s.tierByTurn,key)||s.pendingTier!==null)s.tierByTurn[key]=s.pendingTier;
      s.pendingTier=null;s.activeTurnKey=key;
      while(Object.keys(s.tierByTurn).length>8)delete s.tierByTurn[Object.keys(s.tierByTurn)[0]];
    }
    s.turnKey=key;
  }
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
    if(p.turn_id&&(row.type==='turn_context'||p.type==='task_started'))this.beginTurn(p.turn_id);
    if (row.type === 'turn_context') {
      s.model = p.model ?? s.model;
      if(hasTier(p)&&s.activeTurnKey)s.tierByTurn[s.activeTurnKey]=tierValue(p);
    }
    if (p.type === 'thread_settings_applied') {
      s.model = p.thread_settings?.model ?? s.model;
      // This is a settings snapshot. An omitted/null tier clears the earlier
      // value; otherwise a weeks-old Fast selection leaks into later turns.
      const tier=tierValue(p.thread_settings??{});
      if(s.activeTurnKey){s.tierByTurn[s.activeTurnKey]=tier;s.pendingTier=null;}
      else s.pendingTier=tier;
    }
    if(['task_complete','turn_aborted'].includes(p.type)&&(!p.turn_id||keyed(this.salt,p.turn_id)===s.activeTurnKey))s.activeTurnKey=null;
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
    const turnKey=p.turn_id?keyed(this.salt,p.turn_id):s.turnKey;
    if(p.turn_id&&!s.activeTurnKey)s.turnKey=turnKey;
    // A response-specific override applies only to that record, not the next
    // request or the next turn. Missing evidence is priced as an unknown tier.
    const tier=hasTier(p)?tierValue(p):s.tierByTurn[turnKey]??null;
    const signature = keyed(this.salt, JSON.stringify([s.meta.key, turnKey, tuple(cumulative), tuple(usage)]));
    const canonical = ledger && typeof p.response_id === 'string' && p.response_id.length > 0;
    return { key: canonical ? keyed(this.salt, `response:${p.response_id}`) : signature, signature,
      scopeKey: keyed(this.salt, `${s.meta.key}:${turnKey ?? 'unscoped'}`),
      kind: canonical ? 'ledger' : 'counter', at, model: s.model ?? 'unknown', tier: tier ?? '', accountKey: s.meta.accountKey, ...usage };
  }
}
