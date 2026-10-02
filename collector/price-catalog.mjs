import fs from 'node:fs';

const number=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const source=value=>{
 try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['developers.openai.com','platform.openai.com','learn.chatgpt.com'].includes(u.hostname);}
 catch{return false;}
};
export function validatePricing(value) {
 if(!record(value)||value.schema!==1||!Number.isSafeInteger(value.revision)||value.revision<1||
    typeof value.verifiedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt)||!Number.isFinite(Date.parse(value.verifiedAt))||new Date(value.verifiedAt).toISOString().slice(0,10)!==value.verifiedAt||
    !Array.isArray(value.sources)||!value.sources.length||value.sources.length>20||!value.sources.every(s=>typeof s==='string'&&s.length<300&&source(s))||!record(value.models))return null;
 const entries=Object.entries(value.models);if(!entries.length||entries.length>128)return null;
 const models=Object.create(null);
 for(const [id,rule]of entries) {
  if(!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)||['constructor','prototype','__proto__'].includes(id)||!record(rule))return null;
  const r=rule.rates,l=rule.longContext;
  if(!Array.isArray(r)||r.length!==4||!r.every((n,i)=>i===2&&n===null||number(n,0,100000))||r[1]>r[0]||
     !Array.isArray(l)||l.length!==3||!number(l[0],1,100000000)||!number(l[1],1,100)||!number(l[2],1,100)||
     !(rule.apiFastMultiplier===null||number(rule.apiFastMultiplier,1,100))||
     !(rule.includedFastMultiplier===null||number(rule.includedFastMultiplier,1,100))||typeof rule.optionalLongContext!=='boolean')return null;
  models[id]={rates:[...r],longContext:[...l],apiFastMultiplier:rule.apiFastMultiplier,includedFastMultiplier:rule.includedFastMultiplier,optionalLongContext:rule.optionalLongContext};
 }
 return {schema:1,revision:value.revision,verifiedAt:value.verifiedAt,sources:[...value.sources],models};
}
export const BUNDLED_PRICING=validatePricing(JSON.parse(fs.readFileSync(new URL('./prices.json',import.meta.url),'utf8')));
if(!BUNDLED_PRICING)throw Error('Invalid bundled price catalog');
