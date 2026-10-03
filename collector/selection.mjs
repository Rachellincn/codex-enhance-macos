// A local fallback must never turn automatic following into a manual lock.
export function resolveSelection({lockedId, manualId, follow, connected, currentId, recentId, allowLatest}) {
  if (lockedId) return {id:lockedId, selection:'locked'};
  if (!follow) return {id:manualId, selection:manualId?'manual':'none'};
  if (connected) return {id:currentId ?? null, selection:currentId?'auto':'none'};
  if (manualId) return {id:manualId, selection:'manual'};
  if (allowLatest && recentId) return {id:recentId, selection:'latest'};
  return {id:null,selection:'none'};
}
