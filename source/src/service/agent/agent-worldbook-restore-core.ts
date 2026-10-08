/**
 * Agent 世界书接管恢复的共用核心（R4-07）。
 * 接管停用（agent-worldbook-takeover）与 scope 变更（agent-worldbook-snapshot-restore）原先各写一份恢复逻辑，
 * pending 条目、注释被改过的条目、剥离口径、「已恢复」判定都已分叉。现在逐条目的决策、patch 构造与
 * 恢复判定只在这里实现；两个调用方只各自负责批量写入与（scope 路径的）回滚记账。
 *
 * 刻意保留的两处差异由调用方显式传入（不再是两份代码里的隐性分叉）：
 * - missingCommentHash：快照条目缺少 comment 指纹时，接管停用跳过（避免覆盖用户修改），
 *   scope 变更照常恢复（旧快照没有指纹，跳过会让 scope 永远改不了）；
 * - metaStripMode：接管停用用 strict（未知版本/非法接管块视为不受支持并跳过，不盲剥别的版本写的数据），
 *   scope 变更用 loose（切换前清掉任何残留接管块，含 {} 这类非法块；见 shared/agent-worldbook-comment 的说明）。
 */
import type { AgentWorldbookControlSnapshotEntry_ACU } from '../../shared/models/agent-worldbook-model';
import { hashUserInput_ACU } from '../../shared/utils';
import { createAgentTakeoverMetaPattern_ACU, stripAgentTakeoverMetaBlockLoose_ACU, stripAgentTakeoverMetaBlockStrict_ACU } from '../../shared/agent-worldbook-comment';
import { stripWorldbookSkillMetaBlock_ACU } from './agent-worldbook-skill-meta';

export type AgentWorldbookMissingCommentHashPolicy_ACU = 'skip' | 'restore';
export type AgentWorldbookTakeoverMetaStripMode_ACU = 'strict' | 'loose';

export interface AgentWorldbookRestorePolicy_ACU {
  missingCommentHash: AgentWorldbookMissingCommentHashPolicy_ACU;
  metaStripMode: AgentWorldbookTakeoverMetaStripMode_ACU;
}

function stripTakeoverMeta_ACU(comment: unknown, mode: AgentWorldbookTakeoverMetaStripMode_ACU): string {
  return mode === 'loose' ? stripAgentTakeoverMetaBlockLoose_ACU(comment) : stripAgentTakeoverMetaBlockStrict_ACU(comment);
}

export interface AgentWorldbookRestorePatch_ACU {
  uid: string | number;
  comment: string;
  enabled: boolean;
  keys: unknown[];
  type: unknown;
}

export type AgentWorldbookRestoreDecision_ACU =
  | { kind: 'invalid_uid' }
  | { kind: 'missing'; uid: string | number }
  | { kind: 'skip'; uid: string | number; reason: 'unsupported_meta' | 'missing_comment_hash' | 'comment_changed' }
  | { kind: 'restore'; uid: string | number; patch: AgentWorldbookRestorePatch_ACU; preImage: Record<string, any> };

function commentText_ACU(comment: unknown): string {
  return typeof comment === 'string' ? comment : '';
}

export function hasValidAgentWorldbookUid_ACU(uid: unknown): uid is string | number {
  return uid !== null && uid !== undefined && String(uid).trim() !== '';
}

export function hasAgentTakeoverMetaBlock_ACU(comment: unknown): boolean {
  return new RegExp(createAgentTakeoverMetaPattern_ACU().source).test(commentText_ACU(comment));
}

/** 注释里有本版本识别不了的接管块（未知 version/kind 或非 JSON）：恢复必须跳过，不能盲剥。 */
export function hasUnsupportedAgentTakeoverMetaBlock_ACU(comment: unknown): boolean {
  const text = commentText_ACU(comment);
  const pattern = createAgentTakeoverMetaPattern_ACU();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    try {
      const meta = JSON.parse(match[1].trim()) as Record<string, unknown>;
      if (meta.version !== 1 || meta.kind !== 'agent_worldbook_takeover') return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** 当前注释与快照指纹比对：去掉接管块与 Skill 块后比；旧快照的指纹含 Skill 块，也认。 */
export function doesAgentTakeoverCommentHashMatch_ACU(
  snapshotCommentHash: string | undefined,
  currentComment: unknown,
  mode: AgentWorldbookTakeoverMetaStripMode_ACU = 'strict',
): boolean {
  if (!snapshotCommentHash) return true;
  const strippedComment = stripTakeoverMeta_ACU(currentComment, mode);
  const comparableComment = stripWorldbookSkillMetaBlock_ACU(strippedComment);
  return hashUserInput_ACU(comparableComment) === snapshotCommentHash
    || hashUserInput_ACU(strippedComment) === snapshotCommentHash;
}

/** 只有已真正禁用过的条目才是恢复对象：pending 条目从未被改动过，恢复它会把 keys/type 覆盖成快照值。 */
export function selectRestorableSnapshotEntries_ACU(
  entries: readonly AgentWorldbookControlSnapshotEntry_ACU[] | null | undefined,
): AgentWorldbookControlSnapshotEntry_ACU[] {
  return Array.isArray(entries) ? entries.filter(entry => entry?.takeoverStatus !== 'pending') : [];
}

export function decideAgentWorldbookEntryRestore_ACU(
  snapshotEntry: AgentWorldbookControlSnapshotEntry_ACU,
  currentEntry: any,
  policy: AgentWorldbookRestorePolicy_ACU,
): AgentWorldbookRestoreDecision_ACU {
  if (!hasValidAgentWorldbookUid_ACU(snapshotEntry?.uid)) return { kind: 'invalid_uid' };
  const uid = snapshotEntry.uid;
  // 宿主已删除：无可恢复对象，交给调用方从账本剔除 / 不计 skipped。
  if (!currentEntry) return { kind: 'missing', uid };
  const currentComment = commentText_ACU(currentEntry.comment);
  if (policy.metaStripMode === 'strict' && hasUnsupportedAgentTakeoverMetaBlock_ACU(currentComment)) return { kind: 'skip', uid, reason: 'unsupported_meta' };
  if (!snapshotEntry.commentHash && policy.missingCommentHash === 'skip') return { kind: 'skip', uid, reason: 'missing_comment_hash' };
  // 注释已被用户改过：不覆盖，也不剥接管块——块里是之后恢复所需的依据。
  if (!doesAgentTakeoverCommentHashMatch_ACU(snapshotEntry.commentHash, currentComment, policy.metaStripMode)) return { kind: 'skip', uid, reason: 'comment_changed' };
  return {
    kind: 'restore',
    uid,
    patch: {
      uid,
      comment: stripTakeoverMeta_ACU(currentComment, policy.metaStripMode),
      enabled: snapshotEntry.previousEnabled !== false,
      keys: Array.isArray(snapshotEntry.previousKeys) ? snapshotEntry.previousKeys : [],
      type: snapshotEntry.previousType,
    },
    preImage: {
      uid,
      comment: currentEntry.comment,
      enabled: currentEntry.enabled,
      keys: currentEntry.keys,
      type: currentEntry.type,
    },
  };
}

/** 写入后读回判定是否已恢复：启用状态、类型一致，keys 按集合比较，且接管块已不在注释里。 */
export function isAgentWorldbookEntryRestored_ACU(entry: any, patch: AgentWorldbookRestorePatch_ACU): boolean {
  if (!entry || String(entry.uid) !== String(patch.uid)) return false;
  const patchKeys = Array.isArray(patch.keys) ? patch.keys.map(key => String(key)) : [];
  const currentKeys = Array.isArray(entry.keys) ? (entry.keys as unknown[]).map(key => String(key)) : [];
  const keysMatch = currentKeys.length === patchKeys.length && patchKeys.every(key => currentKeys.includes(key));
  return entry.enabled === patch.enabled
    && entry.type === patch.type
    && keysMatch
    && !hasAgentTakeoverMetaBlock_ACU(entry.comment);
}
