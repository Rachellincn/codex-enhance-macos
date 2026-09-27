const valid=n=>Number.isFinite(n)&&n>=0;
export function observeActivity(turn,tools,now) {
 if(!turn)return;
 const running=tools.filter(t=>t.status==='running');
 const kind=turn.completedAtMs?turn.phase==='idle'?'complete':turn.phase:turn.phase==='waiting'?'waiting':turn.phase==='compacting'?'compacting':turn.phase==='working'?running.length?'tools':'model':'unknown';
 const old=turn.liveActivity,ids=running.map(t=>t.id).sort();
 const gap=!old||now<old.observedAtMs||now-old.observedAtMs>5000;
 const differentTools=kind==='tools'&&old?.kind==='tools'&&!ids.some(id=>old.toolIds.includes(id));
 let startedAtMs=old?.startedAtMs??now,approximate=old?.approximate??true;
 if(gap||old.kind!==kind||differentTools) {
   const anchors=running.map(t=>t.timingStartAtMs??t.observedStartedAtMs).filter(n=>valid(n)&&n<=now&&n>=turn.startedAtMs);
   const anchor=kind==='tools'&&anchors.length?Math.min(...anchors):kind==='compacting'?turn.compactionStartedAtMs:null;
   startedAtMs=valid(anchor)&&anchor<=now?anchor:now;
   approximate=kind!=='tools'||running.some(t=>t.timingApproximate||!valid(t.timingStartAtMs));
 }
 turn.liveActivity={kind,startedAtMs,observedAtMs:now,approximate,toolIds:ids};
}
export function activityView(turn,tools,now,connected) {
 if(!turn)return {kind:'unknown',elapsedMs:null,items:[]};
 if(turn.completedAtMs)return {kind:turn.phase==='idle'?'complete':turn.phase,elapsedMs:null,items:[]};
 const a=turn.liveActivity;
 if(!connected||!a||now-a.observedAtMs>5000||now<a.observedAtMs)return {kind:'unknown',elapsedMs:null,items:[]};
 return {kind:a.kind,startedAtMs:a.startedAtMs,observedAtMs:a.observedAtMs,elapsedMs:Math.max(0,now-a.startedAtMs),approximate:a.approximate,
  items:tools.filter(t=>t.status==='running').map(t=>({id:t.id,label:t.label??'工具调用',name:t.name??''})).slice(0,16)};
}
