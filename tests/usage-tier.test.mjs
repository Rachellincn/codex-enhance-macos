import test from'node:test';import assert from'node:assert/strict';
import{UsageLedger}from'../collector/usage-ledger.mjs';import{priceUsage}from'../collector/pricing.mjs';
const at=Date.parse('2026-10-03T00:00:00Z');
function setup(){let n=0;const p=new UsageLedger('salt');const send=(type,payload)=>p.accept({type,timestamp:new Date(at+n++).toISOString(),payload});send('session_meta',{id:'thread',model_provider:'openai'});return {p,send};}
const usage={input_tokens:100000,cached_input_tokens:80000,output_tokens:1000};
const record=(send,id,turn,extra={})=>send('token_usage_record',{thread_id:'thread',turn_id:turn,response_id:id,usage,...extra});
test('old Fast settings never survive omitted settings snapshots and new turns',()=>{
 const {send}=setup();send('event_msg',{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra',service_tier:'priority'}});
 send('event_msg',{type:'task_started',turn_id:'old'});send('turn_context',{turn_id:'old',model:'gpt-6-astra'});
 assert.equal(record(send,'old-r','old').tier,'priority');send('event_msg',{type:'task_complete',turn_id:'old'});
 send('event_msg',{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra'}});
 send('event_msg',{type:'task_started',turn_id:'new'});send('turn_context',{turn_id:'new',model:'gpt-6-astra'});
 const r=record(send,'new-r','new');assert.equal(r.tier,'');assert.equal(priceUsage(r).quotaFastPremiumUsd,0);assert.equal(priceUsage(r).fast,false);
});
test('a fresh explicit setting applies to its own turn and does not carry to another turn',()=>{
 const {send}=setup();send('event_msg',{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra',service_tier:'fast'}});
 send('event_msg',{type:'task_started',turn_id:'a'});send('turn_context',{turn_id:'a',model:'gpt-6-astra'});
 assert.equal(record(send,'a1','a').tier,'fast');assert.equal(record(send,'a2','a').tier,'fast');
 send('event_msg',{type:'task_complete',turn_id:'a'});send('event_msg',{type:'task_started',turn_id:'b'});send('turn_context',{turn_id:'b',model:'gpt-6-astra'});
 assert.equal(record(send,'b1','b').tier,'');assert.equal(record(send,'late-a','a').tier,'fast');
 assert.equal(record(send,'b2','b').tier,'');
});
test('a response tier override is not written back to subsequent requests',()=>{
 const {send}=setup();send('turn_context',{turn_id:'a',model:'gpt-6-astra',service_tier:'default'});
 assert.equal(record(send,'r1','a',{service_tier:'priority'}).tier,'priority');assert.equal(record(send,'r2','a').tier,'default');
 send('turn_context',{turn_id:'b',model:'gpt-6-astra',serviceTier:'fast'});
 assert.equal(record(send,'r3','b',{service_tier:'default'}).tier,'default');assert.equal(record(send,'r4','b').tier,'fast');
 assert.equal(record(send,'r5','b',{service_tier:null}).tier,'');
});
test('omitted/null settings clear an active tier, while explicit camelCase settings remain supported',()=>{
 const {send}=setup();send('turn_context',{turn_id:'a',model:'gpt-6-astra',service_tier:'fast'});
 send('event_msg',{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra'}});assert.equal(record(send,'r1','a').tier,'');
 send('event_msg',{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra',serviceTier:'priority'}});assert.equal(record(send,'r2','a').tier,'priority');
 send('event_msg',{type:'thread_settings_applied',thread_settings:{model:'gpt-6-astra',service_tier:null}});assert.equal(record(send,'r3','a').tier,'');
});
test('incremental checkpoints preserve scoped evidence but never revive legacy unscoped Fast',()=>{
 const {p,send}=setup();send('turn_context',{turn_id:'a',model:'gpt-6-astra',service_tier:'fast'});
 const restored=new UsageLedger('salt',JSON.parse(JSON.stringify(p.state)));
 assert.equal(restored.accept({type:'token_usage_record',timestamp:new Date(at+1000).toISOString(),payload:{thread_id:'thread',turn_id:'a',response_id:'r1',usage}}).tier,'fast');
 const legacy=new UsageLedger('salt',{...p.state,tier:'priority',tierByTurn:{},pendingTier:null});
 assert.equal(legacy.accept({type:'token_usage_record',timestamp:new Date(at+2000).toISOString(),payload:{thread_id:'thread',turn_id:'a',response_id:'r2',usage}}).tier,'');
});
