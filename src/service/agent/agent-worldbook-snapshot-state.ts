import type { AgentWorldbookControlSnapshot_ACU } from '../../shared/models/agent-worldbook-model';

let cachedAgentWorldbookSnapshot_ACU: AgentWorldbookControlSnapshot_ACU = {
  active: false,
  selectionSignature: '',
  createdAt: 0,
  books: {},
};
let cachedAgentWorldbookSnapshotRevision_ACU = 0;

export function getAgentWorldbookSnapshotState_ACU(): AgentWorldbookControlSnapshot_ACU {
  return cachedAgentWorldbookSnapshot_ACU;
}

export function getAgentWorldbookSnapshotRevision_ACU(): number {
  return cachedAgentWorldbookSnapshotRevision_ACU;
}

export function setAgentWorldbookSnapshotState_ACU(snapshot: AgentWorldbookControlSnapshot_ACU): void {
  cachedAgentWorldbookSnapshot_ACU = snapshot;
  cachedAgentWorldbookSnapshotRevision_ACU += 1;
}

export function setAgentWorldbookSnapshotStateIfRevision_ACU(
  expectedRevision: number,
  snapshot: AgentWorldbookControlSnapshot_ACU,
): boolean {
  if (cachedAgentWorldbookSnapshotRevision_ACU !== expectedRevision) return false;
  cachedAgentWorldbookSnapshot_ACU = snapshot;
  cachedAgentWorldbookSnapshotRevision_ACU += 1;
  return true;
}
