import fs from 'node:fs';
import path from 'node:path';
// Read only the already-loaded client RPC service. No microphone, media data,
// transcripts, auth state, start/stop controls or recording APIs are accessed.
export async function readVoiceSnapshot() {
 const candidates=[...performance.getEntriesByType('resource').map(r=>r.name),...Array.from(document.scripts,s=>s.src)];
 let source=candidates.find(u=>/\/app-shared-[^/]+\.js$/.test(u));
 if(!source)for(const entry of candidates.filter(u=>/\/app-main-[^/]+\.js$/.test(u)).slice(0,2)) {
   const response=await fetch(entry);if(!response.ok)continue;
   const match=(await response.text()).match(/\.\/app-shared-[\w-]+\.js/);
   if(match){source=new URL(match[0],entry).href;break;}
 }
 // Current installed client, when Resource Timing has evicted startup assets.
 source??=new URL('assets/app-shared-c568b0b98683.js',location.href).href;
 const u=new URL(source);if(u.protocol!=='app:'||u.origin!==new URL(location.href).origin)return null;
 const module=await import(source),service=module.nC?.realtimeVoice;
 if(!service?.getSnapshot)return null;
 const s=await service.getSnapshot();
 if(!['active','inactive','starting','stopping'].includes(s?.phase))return null;
 return {phase:s.phase,activity:['listening','speaking','thinking','idle'].includes(s.activity)?s.activity:'idle',
  hostId:s.locator?.hostId??null,threadId:s.locator?.conversationId??null,checkedAtMs:Date.now()};
}

export class VoiceUsage {
 constructor(stateDir) {
  this.raw=null;this.session=null;this.revision=0;this.pending=null;this.requested=false;this.tried=false;
  // Old estimates included an unverified retained connection age. Keep the
  // evidence privately, but never load or use it as duration or cost again.
  const legacy=path.join(stateDir,'voice-usage.json');
  if(fs.existsSync(legacy))fs.renameSync(legacy,path.join(stateDir,`voice-usage.invalid-${Date.now()}.json`));
 }
 inspect(){this.requested=true;}
 sample(session,selectedThreadId,now=Date.now()) {
  if(session!==this.session){this.session=session;this.revision++;this.pending=null;this.raw=null;this.tried=false;}
  if(this.requested&&!this.pending) {
   this.requested=false;this.tried=true;
   if(session) {
    const revision=this.revision;
    this.pending=session.evaluate(`(${readVoiceSnapshot.toString()})()`,3000).then(raw=>{if(revision===this.revision)this.raw=raw;})
     .catch(()=>{if(revision===this.revision)this.raw=null;}).finally(()=>{if(revision===this.revision)this.pending=null;});
   }
  }
  const raw=this.raw;
  return {state:this.pending?'checking':raw?'observed':this.tried?'unavailable':'unchecked',
   reportedPhase:raw?.phase??null,reportedActivity:raw?.activity??null,localScope:raw?.hostId==='local',
   sameTask:raw?.threadId?raw.threadId===selectedThreadId:null,checkedAtMs:raw?.checkedAtMs??null,
   currentMs:null,currentUsd:null,week:null,billingVerified:false,
   scope:'客户端连接标记不能证明实际通话时长；语音时长和消耗尚未核实，不参与额度估算。'};
 }
 close(){this.revision++;this.session=null;}
}