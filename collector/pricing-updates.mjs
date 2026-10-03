import fs from 'node:fs';
import path from 'node:path';
import {BUNDLED_PRICING,validatePricing} from './price-catalog.mjs';

// Public data only: no model names, account identifiers, usage or credentials
// leave the computer. Never download or evaluate executable update code.
export const PRICING_URL='https://raw.githubusercontent.com/Rachellincn/codex-enhance-macos/main/collector/prices.json';
export const PRICING_INTERVAL_MS=6*60*60*1000;
const MAX_BYTES=64*1024;
async function readLimited(response) {
 if(Number(response.headers.get('content-length'))>MAX_BYTES||!response.body)throw Error('Invalid catalog size');
 const reader=response.body.getReader();let length=0;const chunks=[];
 try {
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES)throw Error('Catalog too large');chunks.push(Buffer.from(value));}
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));
}
export class PricingUpdates {
 constructor(stateDir,{fetchFn=fetch,now=Date.now}={}) {
  this.file=path.join(stateDir,'pricing-cache.json');this.fetchFn=fetchFn;this.now=now;
  this.catalog=BUNDLED_PRICING;this.pending=null;this.nextAt=0;this.lastAttemptAt=null;this.checkedAtMs=null;this.error=null;this.closed=false;
  this.missingKey='';this.source='bundled';
  try {
   if(fs.statSync(this.file).size<=MAX_BYTES) {
    const saved=validatePricing(JSON.parse(fs.readFileSync(this.file,'utf8').replace(/^\uFEFF/,'')));
    if(this.acceptable(saved)){this.catalog=saved;this.source='cache';}
   }
  }catch{}
 }
 acceptable(catalog) {
  return catalog&&catalog.revision>=this.catalog.revision&&catalog.verifiedAt>=this.catalog.verifiedAt&&
   Object.keys(this.catalog.models).every(id=>Object.hasOwn(catalog.models,id))&&
   (catalog.revision!==this.catalog.revision||JSON.stringify(catalog)===JSON.stringify(this.catalog));
 }
 refresh() {this.nextAt=0;}
 observeMissing(models=[]) {
  const missing=[...new Set(models.filter(m=>m.unpriced>0&&!Object.hasOwn(this.catalog.models,m.model)).map(m=>m.model))].sort().join('|');
  if(missing&&missing!==this.missingKey)this.nextAt=Math.min(this.nextAt,(this.lastAttemptAt??0)+60000);
  // While genuinely missing a model, retry at most hourly instead of every tick.
  if(missing&&this.lastAttemptAt!==null)this.nextAt=Math.min(this.nextAt,this.lastAttemptAt+3600000);
  this.missingKey=missing;
 }
 sample() {
  if(!this.closed&&!this.pending&&this.now()>=this.nextAt)this.check();
  return {revision:this.catalog.revision,verifiedAt:this.catalog.verifiedAt,source:this.source,checking:!!this.pending,checkedAtMs:this.checkedAtMs,nextCheckAtMs:this.nextAt,error:this.error};
 }
 check() {
  this.lastAttemptAt=this.now();this.nextAt=this.lastAttemptAt+PRICING_INTERVAL_MS;
  this.controller=new AbortController();const controller=this.controller;
  const timer=setTimeout(()=>controller.abort(),5000);timer.unref?.();
  this.pending=(async()=>{
   try {
    const response=await this.fetchFn(PRICING_URL,{method:'GET',credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
    if(!response.ok)throw Error('Catalog unavailable');
    const next=validatePricing(await readLimited(response));
    if(this.closed)return;
    if(!this.acceptable(next))throw Error('Catalog invalid or older');
    const changed=next.revision!==this.catalog.revision;
    this.catalog=next;this.source='remote';this.error=null;this.checkedAtMs=this.now();
    // Cache a validated, whitelisted document, never a raw remote response.
    if(changed||!fs.existsSync(this.file)) {
     const temp=this.file+`.${process.pid}.tmp`;
     try {fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(temp,JSON.stringify(next));fs.renameSync(temp,this.file);}
     catch {this.error='cache_write_failed';try{fs.unlinkSync(temp);}catch{}}
    }
   }catch {
    if(!this.closed){this.error='update_unavailable';this.nextAt=this.now()+3600000;}
   }finally{clearTimeout(timer);this.pending=null;}
  })();
 }
 close(){this.closed=true;this.controller?.abort();}
}
