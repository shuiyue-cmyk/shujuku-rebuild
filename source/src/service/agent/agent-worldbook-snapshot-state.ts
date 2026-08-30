import type { AgentWorldbookControlSnapshot_ACU } from '../../shared/models/agent-worldbook-model';

let cachedAgentWorldbookSnapshot_ACU: AgentWorldbookControlSnapshot_ACU = {
  active: false,
  selectionSignature: '',
  createdAt: 0,
  books: {},
};
let cachedAgentWorldbookSnapshotRevision_ACU = 0;

/**
 * 快照是纯 JSON 数据，出入口双向深拷贝隔离：
 * 调用方拿到的对象可随意修改而不污染缓存，缓存也不受调用方 set 后继续改动的影响。
 */
function cloneAgentWorldbookSnapshot_ACU(snapshot: AgentWorldbookControlSnapshot_ACU): AgentWorldbookControlSnapshot_ACU {
  return JSON.parse(JSON.stringify(snapshot)) as AgentWorldbookControlSnapshot_ACU;
}

export function getAgentWorldbookSnapshotState_ACU(): AgentWorldbookControlSnapshot_ACU {
  return cloneAgentWorldbookSnapshot_ACU(cachedAgentWorldbookSnapshot_ACU);
}

export function getAgentWorldbookSnapshotRevision_ACU(): number {
  return cachedAgentWorldbookSnapshotRevision_ACU;
}

export function setAgentWorldbookSnapshotState_ACU(snapshot: AgentWorldbookControlSnapshot_ACU): void {
  cachedAgentWorldbookSnapshot_ACU = cloneAgentWorldbookSnapshot_ACU(snapshot);
  cachedAgentWorldbookSnapshotRevision_ACU += 1;
}

export function setAgentWorldbookSnapshotStateIfRevision_ACU(
  expectedRevision: number,
  snapshot: AgentWorldbookControlSnapshot_ACU,
): boolean {
  if (cachedAgentWorldbookSnapshotRevision_ACU !== expectedRevision) return false;
  cachedAgentWorldbookSnapshot_ACU = cloneAgentWorldbookSnapshot_ACU(snapshot);
  cachedAgentWorldbookSnapshotRevision_ACU += 1;
  return true;
}
