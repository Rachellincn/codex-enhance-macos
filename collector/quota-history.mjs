import fs from 'node:fs';
import path from 'node:path';
import { PRICE_DATE } from './pricing.mjs';

// Persist only paired percentage/cost observations. Never infer a missing final
// percentage or join a newer cost subtotal to an older percentage.
const usageFields=['requests','tokens','input','cached','output','usd','unpricedRequests','unpricedTokens',
  'unattributedRequests','assumedTierRequests','excludedAccountRequests','parseErrors','unscopedParseErrors','scanErrors',
  'standardUsd','longContextPremiumUsd','fastPremiumUsd','ledgerRequests','legacyRequests','standardModeUsd',
  'unnormalizedRequests','fastRequests','quotaBaseUsd','astraPremiumUsd','quotaFastPremiumUsd','astraFastPremiumUsd',
  'unknownSpeedPremiumUsd','astraUnknownSpeedPremiumUsd'];
const number=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function usageSnapshot(raw) {
  const result={}; for(const key of usageFields) if(number(raw?.[key])) result[key]=raw[key];
  // Undo only the unverified voice add-on. Preserve token costs and Fast/long-
  // context components from the original matching-time observation.
  if(number(raw?.taskQuotaBaseUsd))result.quotaBaseUsd=raw.taskQuotaBaseUsd;
  else if(number(raw?.voiceUsd)&&number(raw?.quotaBaseUsd))result.quotaBaseUsd=Math.max(0,raw.quotaBaseUsd-raw.voiceUsd);
  result.models=(raw?.models??[]).filter(m=>typeof m.model==='string'&&/^[a-z0-9._-]{1,80}$/i.test(m.model))
    .slice(0,32).map(m=>({model:m.model,requests:number(m.requests)?m.requests:0,usd:number(m.usd)?m.usd:0}));
  return result;
}
function safeEntry(e) {
  if (!/^[a-f0-9]{64}$/.test(e?.accountKey??'') || !number(e.startMs)||!number(e.resetsAtMs)||e.resetsAtMs<=e.startMs || !number(e.firstObservedAtMs)) return null;
  const entry={accountKey:e.accountKey,startMs:e.startMs,resetsAtMs:e.resetsAtMs,firstObservedAtMs:e.firstObservedAtMs,
    plan:typeof e.plan==='string'?e.plan.slice(0,32):'',resetDetected:e.resetDetected===true,priceDate:typeof e.priceDate==='string'?e.priceDate.slice(0,10):PRICE_DATE};
  const s=e.sample;
  if (s && number(s.checkedAtMs)&&s.checkedAtMs>=e.startMs&&s.checkedAtMs<e.resetsAtMs && number(s.usedPercent))
    entry.sample={checkedAtMs:s.checkedAtMs,usedPercent:s.usedPercent,usage:usageSnapshot(s.usage)};
  return entry.sample ? entry : null;
}
export class QuotaHistory {
  constructor(stateDir) {
    this.file=path.join(stateDir,'quota-history.json'); this.entries=[]; this.error=null;
    try {
      const value=JSON.parse(fs.readFileSync(this.file,'utf8').replace(/^\uFEFF/,''));
      if(value.schema!==1||!Array.isArray(value.entries))throw Error('unsupported history');
      this.entries=value.entries.map(safeEntry).filter(Boolean);
      if(this.entries.length!==value.entries.length)this.error='read_failed';
      else if(value.entries.some(e=>Object.hasOwn(e.sample?.usage??{},'voiceUsd')||Object.hasOwn(e.sample?.usage??{},'taskQuotaBaseUsd'))) {
        const temp=this.file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify({schema:1,entries:this.entries}));fs.renameSync(temp,this.file);
      }
    } catch(e) { if(e.code!=='ENOENT') this.error='read_failed'; }
  }
  record(quota,aggregate) {
    if(this.error==='read_failed'||quota.state!=='ready'||!aggregate?.complete||!/^[a-f0-9]{64}$/.test(quota.accountKey??''))return;
    const window=quota.windows.find(w=>w.minutes===10080),usage=aggregate.windows?.find(w=>w.minutes===10080);
    if(!window||!usage||!number(quota.checkedAtMs)||quota.checkedAtMs<window.startMs||quota.checkedAtMs>=window.resetsAtMs)return;
    const existing=this.entries.find(e=>e.accountKey===quota.accountKey&&e.startMs===window.startMs&&e.resetsAtMs===window.resetsAtMs);
    if(existing?.sample?.checkedAtMs>quota.checkedAtMs)return;
    const entry=safeEntry({accountKey:quota.accountKey,plan:quota.plan,startMs:window.startMs,resetsAtMs:window.resetsAtMs,
      firstObservedAtMs:existing?.firstObservedAtMs??quota.checkedAtMs,resetDetected:existing?.resetDetected||window.resetDetected,
      priceDate:PRICE_DATE,sample:{checkedAtMs:quota.checkedAtMs,usedPercent:window.usedPercent,usage}});
    if(!entry)return;
    // During transient indexing errors keep the last valid pair; don't replace
    // a useful historical snapshot with an incomplete scan.
    if(usage.scanErrors>0 && existing?.sample)return;
    if(existing) Object.assign(existing,entry); else this.entries.push(entry);
    this.entries.sort((a,b)=>b.resetsAtMs-a.resetsAtMs);
    const retained=new Map(); this.entries=this.entries.filter(e=>{const n=(retained.get(e.accountKey)??0)+1;retained.set(e.accountKey,n);return n<=26;}).slice(0,104);
    try {
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      const temp=this.file+'.'+process.pid+'.tmp'; fs.writeFileSync(temp,JSON.stringify({schema:1,entries:this.entries}));fs.renameSync(temp,this.file);this.error=null;
    } catch { this.error='write_failed'; }
  }
  view(accountKey,project,options,now=Date.now()) {
    if(!accountKey)return {state:'account_unknown',entries:[]};
    const own=this.entries.filter(e=>e.accountKey===accountKey).slice(0,26);
    const newest=own.reduce((latest,e)=>(e.sample?.checkedAtMs??0)>(latest?.sample?.checkedAtMs??0)?e:latest,null);
    const entries=own.map(e=>{
      const s=e.sample;
      const window={minutes:10080,startMs:e.startMs,resetsAtMs:e.resetsAtMs,usedPercent:s?.usedPercent??0,
        accountIdentified:true,resetDetected:e.resetDetected};
      const projected=s?project(window,s.usage,true,options):null;
      const adjusted=e!==newest&&e.resetsAtMs>now;
      return {...projected,startMs:e.startMs,resetsAtMs:e.resetsAtMs,firstObservedAtMs:e.firstObservedAtMs,
        checkedAtMs:s?.checkedAtMs??null,plan:e.plan,priceDate:e.priceDate,closed:e.resetsAtMs<=now||adjusted,adjusted,
        observationGapMs:s?Math.max(0,(adjusted?newest.firstObservedAtMs:e.resetsAtMs<=now?e.resetsAtMs:now)-s.checkedAtMs):null};
    });
    return {state:this.error?'unavailable':'ready',reason:this.error,entries};
  }
}
