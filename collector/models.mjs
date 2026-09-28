// Provider identity is evidence, never an inference from configuration or prose.
export const modelId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value)?value:null;
const headerModel=headers=>{
 if(!headers||typeof headers!=='object'||Array.isArray(headers))return null;
 for(const name of ['openai-model','x-openai-model'])for(const [key,value]of Object.entries(headers))
  if(key.toLowerCase()===name&&modelId(value))return modelId(value);
 return null;
};
export function responseIdentity(event) {
 if(!['response.created','response.in_progress','response.completed','response.metadata','codex.response.metadata'].includes(event?.type))return null;
 const response=event.response;
 const responseId=modelId(response?.id??event.response_id);
 if(!responseId)return null;
 const fromHeader=headerModel(response?.headers)??headerModel(event.headers);
 const fromField=modelId(response?.model);
 if(!fromHeader&&!fromField)return null;
 return {responseId,model:fromHeader??fromField,source:fromHeader?'response_header':'response_model',
  payloadModel:fromHeader&&fromField!==fromHeader?fromField:null};
}
export function observeResponse(turn,event,at) {
 if(!turn)return;
 const responseId=modelId(event?.response?.id??event?.response_id);
 if(!responseId)return;
 const evidence=responseIdentity(event);
 turn.responseCandidates??=new Map();
 if(evidence) {
  const previous=turn.responseCandidates.get(responseId);
  // A completed payload often repeats an alias; keep the explicit header.
  turn.responseCandidates.set(responseId,previous?.source==='response_header'&&evidence.source!=='response_header'?previous:evidence);
 }
 while(turn.responseCandidates.size>32)turn.responseCandidates.delete(turn.responseCandidates.keys().next().value);
 if(event.type!=='response.completed'||event.response?.status!=='completed')return;
 const found=turn.responseCandidates.get(responseId)??{responseId,model:null,source:null,payloadModel:null};turn.responseCandidates.delete(responseId);
 turn.responseModels??=[];
 if(turn.responseModels.some(r=>r.responseId===responseId))return;
 turn.responseModels.push({...found,atMs:at});turn.responseModels.sort((a,b)=>a.atMs-b.atMs);
 turn.responseModels=turn.responseModels.slice(-12);
}
export function observeReroute(turn,item,at,source) {
 const from=modelId(item.fromModel??item.from_model),to=modelId(item.toModel??item.to_model);
 if(!turn||!from||!to||from===to)return;
 turn.modelRoutes??=[];
 const id=String(item.id??`${from}:${to}:${at}`);
 if(turn.modelRoutes.some(r=>r.id===id||r.from===from&&r.to===to&&r.source!==source))return;
 turn.modelRoutes.push({id,from,to,atMs:at,source});turn.modelRoutes=turn.modelRoutes.slice(-12);
}
// Only parse the exact diagnostic event emitted by the Responses SSE reader.
// Never scan tool output, messages, requests, or generic tracing `model=` spans.
export function observeModelLog(state,row) {
 if(row.target!=='codex_api::sse::responses'||typeof row.feedback_log_body!=='string')return;
 const body=row.feedback_log_body;
 if(body.length>1024*1024)return;
 const index=body.indexOf('SSE event: ');if(index<0)return;
 const prefix=body.slice(0,index);
 if(/warmup\s*=\s*true|run_auto_compact|session_task\.compact/.test(prefix))return;
 const turnId=prefix.match(/\bturn(?:\.id|_id)="?([0-9a-f-]{36})\b/i)?.[1];
 const turn=state.turns.get(turnId);if(!turn)return;
 try {observeResponse(turn,JSON.parse(body.slice(index+11)),row.ts*1000+Math.floor((row.ts_nanos??0)/1e6));}catch{}
}
export function modelIdentityView(turn,selected) {
 const records=turn?.responseModels??[],routes=turn?.modelRoutes??[],latest=records.at(-1);
 const requested=modelId(turn?.model),selectedModel=modelId(selected);
 return {selected:selectedModel,requested,response:latest?.model??null,source:latest?.source??null,observedAtMs:latest?.atMs??null,
  state:latest?.model?(requested?latest.model===requested?'same':'different':'reported'):routes.length?'rerouted':'unavailable',
  routedModel:routes.at(-1)?.to??null,records:[...records].reverse(),routes:[...routes].reverse()};
}
