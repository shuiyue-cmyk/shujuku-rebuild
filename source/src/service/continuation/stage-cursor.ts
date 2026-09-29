import type { ContinuationEnvelope_ACU, ContinuationStage_ACU, ContinuationTask_ACU, StageRevision_ACU } from './model';

type CompletionEntry_ACU = ContinuationTask_ACU['timeline'][number];

function isRecordMessage_ACU(message: unknown): message is Record<string, unknown> {
  return !!message && typeof message === 'object' && !Array.isArray(message);
}

function messageIdOf_ACU(record: Record<string, unknown> | null): string | number | undefined {
  const rawId = record ? (record.message_id ?? record.id) : undefined;
  return (typeof rawId === 'string' || (typeof rawId === 'number' && Number.isFinite(rawId))) ? rawId : undefined;
}

function messageFingerprintText_ACU(message: unknown): string {
  const record = isRecordMessage_ACU(message) ? message : {};
  const payload = JSON.stringify({
    is_user: record.is_user === true,
    is_system: record.is_system === true,
    role: String(record.role ?? ''),
    name: String(record.name ?? ''),
    mes: String(record.mes ?? ''),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `mf-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function getStableMessageIdentity_ACU(message: unknown): { messageId?: string | number; messageFingerprint: string } {
  const record = isRecordMessage_ACU(message) ? message : null;
  const messageId = messageIdOf_ACU(record);
  return { ...(messageId === undefined ? {} : { messageId }), messageFingerprint: messageFingerprintText_ACU(message) };
}

/**
 * 一次调和内的逐楼身份条目。指纹按需计算并就地缓存：
 * 完成记录带 messageId 且与本楼相等时，判定已经成立，指纹一个字节都不必算。
 * 身份表是单次调和的局部量，不跨调用复用，因此不存在陈旧值问题。
 */
interface FloorIdentity_ACU {
  message: unknown;
  messageId: string | number | undefined;
  fingerprint: string | null;
}

function floorIdentityOf_ACU(identity: FloorIdentity_ACU): string {
  if (identity.fingerprint === null) {
    identity.fingerprint = messageFingerprintText_ACU(identity.message);
  }
  return identity.fingerprint;
}

function buildFloorIdentities_ACU(chat: unknown): FloorIdentity_ACU[] {
  const floors = chat as readonly unknown[];
  const size = typeof floors.length === 'number' ? floors.length : 0;
  const identities: FloorIdentity_ACU[] = new Array(size);
  for (let index = 0; index < size; index += 1) {
    const message = floors[index];
    identities[index] = {
      message,
      messageId: messageIdOf_ACU(isRecordMessage_ACU(message) ? message : null),
      fingerprint: null,
    };
  }
  return identities;
}

function completionSurvives_ACU(
  entry: CompletionEntry_ACU,
  chat: readonly unknown[] | undefined,
  chatLength: number,
  identities: FloorIdentity_ACU[],
  used: Set<number>,
): boolean {
  const hasDurableIdentity = entry.messageId !== undefined || entry.messageFingerprint !== undefined;
  if (!chat) return !hasDurableIdentity && typeof entry.messageIndex === 'number' ? entry.messageIndex < chatLength : !hasDurableIdentity;
  if (!hasDurableIdentity) return typeof entry.messageIndex === 'number' && entry.messageIndex < chat.length;
  for (let index = 0; index < chat.length; index += 1) {
    if (used.has(index)) continue;
    const identity = identities[index];
    if (entry.messageId !== undefined && identity.messageId !== entry.messageId) continue;
    if (entry.messageFingerprint !== undefined && floorIdentityOf_ACU(identity) !== entry.messageFingerprint) continue;
    used.add(index);
    return true;
  }
  return false;
}

/**
 * 按聊天实际楼层重算阶段硬游标。
 * 新写入的完成记录带稳定 message identity；旧记录没有 identity 时才回退到旧下标兼容。
 */
export function reconcileTaskCursorFromChat_ACU(task: ContinuationTask_ACU, chatLength: number, chat?: readonly unknown[]): ContinuationTask_ACU {
  const effectiveLength = Array.isArray(chat) ? chat.length : chatLength;
  if (!Number.isInteger(effectiveLength) || effectiveLength < 0) return task;
  const completions = task.timeline.filter(entry => entry.kind === 'turn_completed' && entry.stageId);
  // 逐楼身份只建一次：旧实现是「每条完成记录从 0 楼扫全聊天、每楼每条都重算整段 mes 指纹」，
  // 成本 O(完成数×楼层)。这里预计算一遍身份表（O(楼层)），指纹按需算、messageId 命中即短路。
  const identities = chat ? buildFloorIdentities_ACU(chat) : [];
  const survivingByStage = new Map<string, number>();
  const hasAnchorByStage = new Map<string, boolean>();
  for (const entry of completions) {
    const stageId = entry.stageId as string;
    if (typeof entry.messageIndex === 'number' || entry.messageId !== undefined || entry.messageFingerprint !== undefined) hasAnchorByStage.set(stageId, true);
    const surviving = survivingByStage.get(stageId) ?? 0;
    survivingByStage.set(stageId, surviving + (completionSurvives_ACU(entry, chat, effectiveLength, identities, new Set()) ? 1 : 0));
  }
  // 从前往后扫：一旦某阶段因楼层消失而未完成，其后没有任何存活完成的阶段应废弃。
  let firstOpenIndex = -1;
  let changed = false;
  const stages = task.stages.map((stage, index) => {
    const revision = stage.revisions.find(item => item.revision === stage.activeRevision) ?? null;
    const totalTurns = revision?.outline.totalTurns ?? 0;
    const hasAnchor = hasAnchorByStage.get(stage.stageId) === true;
    if (!hasAnchor) {
      if (stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed' && firstOpenIndex < 0) firstOpenIndex = index;
      return stage;
    }
    const recorded = completions.filter(entry => entry.stageId === stage.stageId).length;
    const used = new Set<number>();
    let surviving = 0;
    for (const entry of completions) {
      if (entry.stageId !== stage.stageId) continue;
      if (!completionSurvives_ACU(entry, chat, effectiveLength, identities, used)) break;
      surviving += 1;
    }
    surviving = Math.min(surviving, recorded, totalTurns);
    const cursor = cursorFromCompletedTurns_ACU(revision, surviving);
    const fullyDone = totalTurns > 0 && surviving >= totalTurns;
    let nextStatus: ContinuationStage_ACU['status'] = stage.status;
    if (fullyDone) {
      if (stage.status !== 'abandoned' && stage.status !== 'failed') nextStatus = 'completed';
    } else if (stage.status === 'completed') {
      nextStatus = 'running';
    }
    if (!fullyDone && firstOpenIndex < 0) firstOpenIndex = index;
    if (stage.completedTurns === surviving && stage.activeNodeIndex === cursor.nodeIndex && stage.activeTurnIndex === cursor.turnIndex && stage.status === nextStatus) return stage;
    changed = true;
    return { ...stage, completedTurns: surviving, activeNodeIndex: cursor.nodeIndex, activeTurnIndex: cursor.turnIndex, status: nextStatus };
  });

  if (firstOpenIndex >= 0) {
    for (let index = firstOpenIndex + 1; index < stages.length; index += 1) {
      const stage = stages[index];
      const hasAnchor = hasAnchorByStage.get(stage.stageId) === true;
      const surviving = hasAnchor ? (survivingByStage.get(stage.stageId) ?? 0) : stage.completedTurns;
      if (surviving > 0) continue;
      if (stage.status === 'abandoned' && stage.completedTurns === 0 && stage.activeNodeIndex === 0 && stage.activeTurnIndex === 0) continue;
      stages[index] = { ...stage, status: 'abandoned', completedTurns: 0, activeNodeIndex: 0, activeTurnIndex: 0 };
      changed = true;
    }
  }

  const firstOpen = stages.find(stage => stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed') ?? null;
  const activeStageId = firstOpen?.stageId ?? task.activeStageId;
  if (activeStageId !== task.activeStageId) changed = true;
  if (!changed) return task;
  return { ...task, activeStageId, stages };
}

/** 把信封里的任务游标按聊天楼层对齐。 */
export function reconcileContinuationEnvelopeCursor_ACU(envelope: ContinuationEnvelope_ACU, chatLength: number, chat?: readonly unknown[]): ContinuationEnvelope_ACU {
  const task = envelope.activeTask;
  if (!task) return envelope;
  const next = reconcileTaskCursorFromChat_ACU(task, chatLength, chat);
  return next === task ? envelope : { ...envelope, activeTask: next };
}

/**
 * 由已完成轮数还原节点/轮次下标。全部完成时停在最后一轮，与 advanceConfirmedTurn 终局写法一致。
 */
export function cursorFromCompletedTurns_ACU(revision: StageRevision_ACU | null, completedTurns: number): { nodeIndex: number; turnIndex: number } {
  if (!revision || completedTurns <= 0) return { nodeIndex: 0, turnIndex: 0 };
  let remaining = completedTurns;
  for (let nodeIndex = 0; nodeIndex < revision.outline.nodes.length; nodeIndex += 1) {
    const turnCount = revision.outline.nodes[nodeIndex].turns.length;
    if (remaining < turnCount) return { nodeIndex, turnIndex: remaining };
    remaining -= turnCount;
  }
  const lastNodeIndex = Math.max(0, revision.outline.nodes.length - 1);
  const lastTurnCount = revision.outline.nodes[lastNodeIndex]?.turns.length ?? 1;
  return { nodeIndex: lastNodeIndex, turnIndex: Math.max(0, lastTurnCount - 1) };
}
