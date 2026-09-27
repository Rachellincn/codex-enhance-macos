// Wall-clock attribution, never a model-compute or server-queue measurement.
const valid = n => Number.isFinite(n) && n >= 0;
export function unionIntervals(values) {
  const out = [];
  for (const [start,end] of values.filter(v => valid(v[0]) && valid(v[1]) && v[1]>v[0]).sort((a,b)=>a[0]-b[0])) {
    const last=out.at(-1);
    if (last && start<=last[1]) last[1]=Math.max(last[1],end); else out.push([start,end]);
  }
  return out;
}
export function addTimingRange(turn, kind, start, end) {
  if (!turn || !valid(start) || !valid(end) || end<=start) return;
  turn.timingRanges ??= {};
  turn.timingRanges[kind]=unionIntervals([...(turn.timingRanges[kind]??[]),[start,end]]);
}
// Only adjacent observations can establish a model/waiting/compaction interval.
// Navigation, disconnection, restarts and long polling gaps remain unclassified.
export function observeTiming(turn, now, { modelActive = false } = {}) {
  if (!turn || !valid(now)) return;
  const kind=turn.completedAtMs ? null : turn.phase==='waiting'?'waiting':turn.phase==='compacting'?'compacting':turn.phase==='working'&&modelActive?'model':null;
  const previous=turn.timingObservation;
  if (kind && previous?.kind===kind && now>=previous.at && now-previous.at<=5000)
    addTimingRange(turn,kind,previous.at,now);
  turn.timingObservation={kind,at:now};
}
export function elapsedTurnMs(turn, now) {
  if (!turn || !valid(turn.startedAtMs)) return null;
  if (turn.completedAtMs && valid(turn.durationMs)) return turn.durationMs;
  return Math.max(0,(turn.completedAtMs??now)-turn.startedAtMs);
}
export function timingBreakdown(turn, tools, now, connected) {
  const totalMs=elapsedTurnMs(turn,now);
  if (totalMs===null) return {state:'unavailable',totalMs:null,segments:[]};
  const start=turn.startedAtMs,end=start+totalMs;
  const ranges={waiting:[],compacting:[],tools:[],model:[]};
  const add=(kind,a,b)=>{a=Math.max(start,a);b=Math.min(end,b);if(valid(a)&&valid(b)&&b>a)ranges[kind].push([a,b]);};
  for (const kind of Object.keys(ranges)) for(const [a,b] of turn.timingRanges?.[kind]??[]) add(kind,a,b);
  const observed=turn.timingObservation;
  if (!turn.completedAtMs && connected && observed?.kind && now-observed.at<=5000) add(observed.kind,observed.at,now);
  let missingToolTimings=0, approximateTools=0, summedToolMs=0;
  for (const tool of tools) {
    const anchoredStart=Object.hasOwn(tool,'timingStartAtMs')?tool.timingStartAtMs:tool.startedAtMs;
    const a=valid(anchoredStart)?anchoredStart:tool.observedStartedAtMs;
    let b=tool.timingEndAtMs;
    if (tool.status==='running' || tool.status==='unknown') {
      const last=tool.seenRunningAtMs;
      b=connected && tool.status==='running' && valid(last) && now-last<=5000 && !turn.completedAtMs ? now : last;
    }
    if (!valid(a)||!valid(b)||b<a) { missingToolTimings++; continue; }
    if (!valid(anchoredStart) || tool.timingApproximate) approximateTools++;
    const clipped=Math.max(0,Math.min(end,b)-Math.max(start,a)); summedToolMs+=clipped;
    add('tools',a,b);
  }
  const merged=Object.fromEntries(Object.entries(ranges).map(([kind,values])=>[kind,unionIntervals(values)]));
  // A sweep assigns each millisecond once. User waits supersede tool envelopes;
  // compaction supersedes tools, and all three supersede the model estimate.
  // Parallel calls are merged, not added; unknown is never charged to the model.
  const events=[];
  for(const [kind,values] of Object.entries(merged)) for(const [a,b] of values) events.push({at:a,kind,delta:1},{at:b,kind,delta:-1});
  events.sort((a,b)=>a.at-b.at);
  const counts={waiting:0,compacting:0,tools:0,model:0}, ms={waiting:0,compacting:0,tools:0,model:0,unknown:0};
  let cursor=start;
  for(const event of events) {
    const kind=['waiting','compacting','tools','model'].find(k=>counts[k]>0)??'unknown';
    ms[kind]+=Math.max(0,event.at-cursor); cursor=event.at; counts[event.kind]+=event.delta;
  }
  ms.unknown+=Math.max(0,end-cursor);
  const toolWallMs=merged.tools.reduce((sum,[a,b])=>sum+b-a,0);
  return {state:'available',totalMs,classifiedMs:totalMs-ms.unknown,missingToolTimings,approximateTools,
    modelObserved:merged.model.length>0 || observed?.kind==='model',
    toolWallMs,parallelOverlapMs:Math.max(0,summedToolMs-toolWallMs),observationOnly:true,
    segments:[{key:'model',label:'思考/响应（估算）',ms:ms.model},{key:'tools',label:'工具调用',ms:ms.tools},{key:'waiting',label:'等待你操作',ms:ms.waiting},
      {key:'compacting',label:'上下文整理',ms:ms.compacting},{key:'unknown',label:'其他／未分类',ms:ms.unknown}]};
}
