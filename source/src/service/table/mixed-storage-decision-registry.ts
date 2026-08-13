import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import type { IsolationConfig_ACU } from '../../data/models/chat-message-data';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { commitMixedStorageDecision_ACU, type MixedStorageCommitAction_ACU, type MixedStorageCommitResult_ACU } from './mixed-storage-commit';
import type { MixedStorageDecision_ACU, MixedStorageDecisionAction_ACU, MixedStorageDecisionDiagnosticCode_ACU, MixedStorageDecisionKind_ACU } from './mixed-storage-decision';
import { buildMixedStorageSnapshotTransfer_ACU, type MixedStorageSnapshotTransfer_ACU } from './mixed-storage-snapshot-transfer';

export interface MixedStorageDecisionSummary_ACU {
  decisionId: string;
  kind: MixedStorageDecisionKind_ACU;
  diagnosticCodes: readonly MixedStorageDecisionDiagnosticCode_ACU[];
  allowedActions: readonly MixedStorageDecisionAction_ACU[];
  createdAt: number;
  /** anchor 状态：anchored / missing_with_artifacts / missing_without_artifacts。 */
  anchorStatus: 'anchored' | 'missing_with_artifacts' | 'missing_without_artifacts';
  /** replay 状态：not_present / unavailable / success / failed。 */
  replayStatus: 'not_present' | 'unavailable' | 'success' | 'failed';
  /** V2 静态可见的 sheet key 数量（仅诊断透出，不含业务数据）。 */
  staticSheetKeyCount: number;
}

interface RegisteredMixedStorageDecision_ACU {
  decision: MixedStorageDecision_ACU;
  isolationConfig: Readonly<IsolationConfig_ACU>;
}

const decisions_ACU = new Map<string, RegisteredMixedStorageDecision_ACU>();
let activeDecisionId_ACU: string | null = null;

function deepFreeze_ACU<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    // chatReference 是 live chat 的 identity guard；不可 clone 或冻结它。
    if (key !== 'chatReference') deepFreeze_ACU(item);
  });
  return Object.freeze(value);
}

function freezeDecisionSnapshot_ACU(decision: MixedStorageDecision_ACU): MixedStorageDecision_ACU {
  const { chatReference, ...scope } = decision.scopeSnapshot;
  const snapshot = JSON.parse(JSON.stringify({
    ...decision,
    scopeSnapshot: scope,
  })) as MixedStorageDecision_ACU;
  snapshot.scopeSnapshot = { ...snapshot.scopeSnapshot, chatReference };
  return deepFreeze_ACU(snapshot);
}

function isCurrentScope_ACU(decision: MixedStorageDecision_ACU): boolean {
  return getChatArray_ACU() === decision.scopeSnapshot.chatReference
    && String(currentChatFileIdentifier_ACU || '').trim() === decision.scopeSnapshot.chatIdentifier
    && getCurrentIsolationKey_ACU() === decision.scopeSnapshot.activeIsolationKey;
}

function summaryOf_ACU(decision: MixedStorageDecision_ACU): MixedStorageDecisionSummary_ACU {
  return Object.freeze({
    decisionId: decision.decisionId,
    kind: decision.kind,
    diagnosticCodes: Object.freeze([...decision.diagnosticCodes]),
    allowedActions: Object.freeze([...decision.allowedActions]),
    createdAt: decision.createdAt,
    anchorStatus: decision.evidence?.v2?.anchor?.status ?? 'missing_without_artifacts',
    replayStatus: decision.evidence?.v2?.replay?.status ?? 'unavailable',
    // 决策层不透出静态扫描结果（evidence 不含）；由注册方补充。
    staticSheetKeyCount: 0,
  });
}

function requireCurrentDecision_ACU(decisionId: string): RegisteredMixedStorageDecision_ACU {
  const registered = decisions_ACU.get(decisionId);
  if (!registered) throw new Error('混合存储决议不存在、已失效或已被替换。');
  if (!isCurrentScope_ACU(registered.decision)) {
    decisions_ACU.delete(decisionId);
    if (activeDecisionId_ACU === decisionId) activeDecisionId_ACU = null;
    throw new Error('混合存储决议已失效：当前聊天或隔离范围已变化。');
  }
  return registered;
}

export function registerMixedStorageDecision_ACU(
  decision: MixedStorageDecision_ACU,
  isolationConfig: Readonly<IsolationConfig_ACU>,
  staticSheetKeyCount?: number,
): MixedStorageDecisionSummary_ACU {
  const frozenDecision = freezeDecisionSnapshot_ACU(decision);
  decisions_ACU.set(frozenDecision.decisionId, { decision: frozenDecision, isolationConfig: Object.freeze({ ...isolationConfig }) });
  activeDecisionId_ACU = decision.decisionId;
  const summary = summaryOf_ACU(frozenDecision);
  return Object.freeze({
    ...summary,
    staticSheetKeyCount: Number.isInteger(staticSheetKeyCount) && staticSheetKeyCount! > 0 ? staticSheetKeyCount! : 0,
  });
}

export function getActiveMixedStorageDecisionSummary_ACU(): MixedStorageDecisionSummary_ACU | null {
  if (!activeDecisionId_ACU) return null;
  try {
    return summaryOf_ACU(requireCurrentDecision_ACU(activeDecisionId_ACU).decision);
  } catch {
    return null;
  }
}

export function buildRegisteredMixedStorageSnapshotTransfer_ACU(decisionId: string): MixedStorageSnapshotTransfer_ACU {
  return buildMixedStorageSnapshotTransfer_ACU(requireCurrentDecision_ACU(decisionId).decision);
}

export async function commitRegisteredMixedStorageDecision_ACU(
  decisionId: string,
  action: MixedStorageCommitAction_ACU,
): Promise<MixedStorageCommitResult_ACU> {
  const registered = requireCurrentDecision_ACU(decisionId);
  const result = await commitMixedStorageDecision_ACU({
    decision: registered.decision,
    action,
    isolationConfig: registered.isolationConfig,
  });
  if (result.status === 'committed' || result.status === 'committed_postcondition_failed') {
    decisions_ACU.delete(decisionId);
    if (activeDecisionId_ACU === decisionId) activeDecisionId_ACU = null;
  }
  return result;
}

export function __resetMixedStorageDecisionRegistryForTests_ACU(): void {
  decisions_ACU.clear();
  activeDecisionId_ACU = null;
}
