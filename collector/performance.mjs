export function turnProblemNotice(error) {
  const value = typeof error === 'string' ? error : JSON.stringify(error ?? {});
  if (/usage.?limit|rate.?limit|too_many_requests|\b429\b|quota|额度|限流/i.test(value)) return '本轮曾收到额度或限流提示，等待不能直接归因于模型计算。';
  if (/context.?window|context_length_exceeded|maximum.*tokens/i.test(value)) return '本轮记录中出现上下文限制提示，可到原对话核对。';
  if (/timed? out|stream.?disconnect|connection|reconnect|retry|network|重试|连接中断/i.test(value)) return '本轮曾出现连接、超时或重试提示，可能包含网络等待。';
  return null;
}
export function performanceView(state, currentTools, now, runtimeConnected) {
  const turn = state.turns.get(state.latestTurnId);
  let phase = turn?.phase ?? 'unknown';
  if (phase === 'working' && !runtimeConnected && now - state.lastActivityAt > 120000) phase = 'unknown';
  const running = currentTools.filter(t => t.status === 'running').length;
  const active = ['working', 'compacting', 'waiting'].includes(phase);
  const progressGapMs = active && runtimeConnected && turn?.lastObservedProgressAt ? Math.max(0, now - turn.lastObservedProgressAt) : null;
  const logGapMs = active && state.lastActivityAt ? Math.max(0, now - state.lastActivityAt) : null;
  const recentTimedTurn = [...state.turns.values()].filter(t => t.completedAtMs && t.ttftMs != null && t.ttftMs >= 0)
    .sort((a, b) => b.completedAtMs - a.completedAtMs)[0];
  const recentTimings = [...state.turns.values()].filter(t => t.completedAtMs && Number.isFinite(t.ttftMs) && t.ttftMs >= 0 && t.model === (turn?.model || state.model) && t.effort === (turn?.effort || state.effort))
    .sort((a, b) => b.completedAtMs - a.completedAtMs).slice(0, 8).reverse()
    .map(t => ({ turnId: t.id, ttftMs: t.ttftMs, completedAtMs: t.completedAtMs }));
  const completed = [...state.turns.values()].filter(t => t.id !== turn?.id && t.completedAtMs && t.ttftMs != null && t.ttftMs >= 0 && t.model === (turn?.model || state.model) && t.effort === (turn?.effort || state.effort))
    .sort((a, b) => b.completedAtMs - a.completedAtMs).slice(0, 5).map(t => t.ttftMs).sort((a, b) => a - b);
  const baselineMs = completed.length ? completed.length % 2 ? completed[(completed.length - 1) / 2] : (completed[completed.length / 2 - 1] + completed[completed.length / 2]) / 2 : null;
  const ratio = baselineMs > 0 && turn?.ttftMs != null ? turn.ttftMs / baselineMs : null;
  let stage = phase === 'waiting' ? turn?.waitReason || '等待输入' : phase === 'compacting' ? '正在压缩' : phase === 'working' ? running ? '工具执行中' : '正在处理' : phase === 'idle' ? '已完成' : phase === 'failed' ? '本轮未完成' : phase === 'interrupted' ? '已中断' : '状态待确认';
  if (phase === 'working' && !running && progressGapMs >= 30000) stage = '等待可见进度';
  const hints = [];
  if (turn?.problemNotice) hints.push(turn.problemNotice);
  if (phase === 'waiting') hints.push('当前在等待你的输入或确认，等待时间不应算作模型变慢。');
  if (phase === 'compacting') hints.push(turn?.compactionHeartbeatAtMs ? '收到过服务端压缩进度；尚不能区分排队和计算耗时。' : '正在压缩上下文，进度百分比不可用。');
  if (completed.length >= 3 && ratio >= 2.5 && turn.ttftMs >= 10000) hints.push(`本轮首 token 约为近 ${completed.length} 轮中位数的 ${ratio.toFixed(1)} 倍，仅为变慢线索。`);
  if ((state.context?.used ?? 0) >= 100000 && state.cacheHit !== null && state.cacheHit < 30) hints.push('最近请求上下文较大、缓存命中偏低，可能增加等待；不能据此直接定因。');
  else if ((state.context?.percent ?? 0) >= 80) hints.push('上下文最近采样超过窗口的 80%；可留意后续压缩。');
  if (phase === 'working' && !running && progressGapMs >= 30000) hints.push('暂时没有新的可见进度，不等于后台空转或卡死。');
  if (phase === 'idle' && turn?.hasUserInput && !turn.hasReply && !turn.wasCompaction && currentTools.length === 0) hints.push('本轮已结束，但记录里没有可见回复或工具产出；需打开原对话核对。');
  return { stage, progressGapMs, logGapMs, baselineMs, baselineSamples: completed.length, ttftRatio: ratio, recentTimings,
    recentTtftMs: recentTimedTurn?.ttftMs ?? null, recentTtftTurnId: recentTimedTurn?.id ?? null, recentTtftAtMs: recentTimedTurn?.completedAtMs ?? null,
    compactionElapsedMs: phase === 'compacting' && turn?.compactionStartedAtMs ? Math.max(0, now - turn.compactionStartedAtMs) : null,
    compactionHeartbeatGapMs: turn?.compactionHeartbeatAtMs ? Math.max(0, now - turn.compactionHeartbeatAtMs) : null,
    hints: hints.slice(0, 4), scope: '只反映本地可观察记录；无法单独测量模型计算、服务端排队和界面渲染时间。' };
}
