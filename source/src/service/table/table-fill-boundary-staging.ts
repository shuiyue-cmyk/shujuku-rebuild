import {
  getChatArray_ACU,
  saveChatToHostStrict_ACU
} from '../../data/gateways/chat-gateway';
import {
  readIsolatedDataContainer_ACU,
  writeMessageIdentity_ACU
} from '../../data/repositories/chat-message-data-repo';
import {
  currentChatFileIdentifier_ACU,
  getCurrentIsolationKey_ACU,
  settings_ACU
} from '../runtime/state-manager';
import {
  logDebug_ACU
} from '../../shared/utils';
import {
  isV2TagData_ACU
} from './storage-strategy-resolver';
import {
  loadTableStatesAtBoundariesFromFramesV2Detailed_ACU
} from './storage-frame-v2-replay';
import {
  buildCanonicalSheetCheckpoint_ACU
} from './canonical-checkpoint-builder';
import type {
  TableStorageFrameV2_ACU
} from './storage-frame-v2-types';
import {
  runTableWriteTransaction_ACU
} from './table-write-transaction';

export type TableFillRunKind = 'manual_refill' | 'auto_fill' | 'manual_catch_up';

export type TableFillBoundaryStagingPhase =
  | 'pre_boundary_staging'
  | 'boundary_committing'
  | 'post_boundary_persisting';

export class TableFillBoundaryPlanError_ACU extends Error {
  constructor(
    readonly code: 'invalid_input' | 'multiple_full_checkpoints',
    message: string,
  ) {
    super(message);
    this.name = 'TableFillBoundaryPlanError_ACU';
  }
}

export interface TableFillBoundaryStagingScope_ACU {
  readonly runKind: TableFillRunKind;
  readonly runId: string;
  readonly chatKey: string;
  readonly isolationKey: string;
  readonly originalFullIndex: number | null;
  readonly rangeStartMessageIndex: number | null;
  readonly rangeEndMessageIndex: number | null;
  readonly targetSheetKeys: readonly string[];
  readonly templateFingerprint: string;
}

export interface TableFillBoundaryStagingPlanInput_ACU {
  runKind: TableFillRunKind;
  runId: string;
  chatKey: string;
  isolationKey: string;
  targetSheetKeys: readonly string[];
  templateFingerprint: string;
  messageIndices: readonly number[];
  fullCheckpointIndices: readonly number[];
}

export interface TableFillBoundaryStagingPlan_ACU {
  readonly scope: TableFillBoundaryStagingScope_ACU;
  preBoundaryIndices: number[];
  postBoundaryIndices: number[];
  requiresStaging: boolean;
  phase: TableFillBoundaryStagingPhase;
  lastStagedTargetMessageIndex: number | null;
  stagedBucketCount: number;
  boundaryCommitted: boolean;
}

/**
 * 共享 stage-only runner 的运行时上下文（计划 5.3）。
 *
 * - stagedWorkingData：边界前连续 bucket 的累计目标表快照，只存在于本 run 内；
 *   每个成功 bucket 立即替换为最新 AI 结果，失败 bucket 回滚到 bucket 前快照。
 * - writeSet/registry 冲突由调用方（orchestrator/scheduler）在进入 runner 前用
 *   run 级互斥保证；此处只保存作用域身份供提交事务复检。
 */
export interface TableFillStagingRunContext_ACU {
  readonly runId: string;
  readonly chatKey: string;
  readonly isolationKey: string;
  readonly targetSheetKeys: readonly string[];
  stagedWorkingData: Record<string, any> | null;
  /** 最近一次成功 staging 的 bucket 快照，供失败恢复与边界汇合取数。 */
  lastStagedSnapshot: Record<string, any> | null;
  lastStagedTargetMessageIndex: number | null;
  stagedBucketCount: number;
}

function requireNonEmptyString_ACU(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', `跨 full checkpoint 填表规划缺少有效 ${field}。`);
  }
  return normalized;
}

function normalizeStrictlyIncreasingIndices_ACU(indices: readonly number[], field: string): number[] {
  if (!Array.isArray(indices)) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', `跨 full checkpoint 填表规划的 ${field} 必须是消息索引数组。`);
  }
  const normalized = [...indices];
  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    if (!Number.isInteger(value) || value < 0 || (index > 0 && value <= normalized[index - 1])) {
      throw new TableFillBoundaryPlanError_ACU('invalid_input', `跨 full checkpoint 填表规划的 ${field} 必须为严格递增的非负整数。`);
    }
  }
  return normalized;
}

function normalizeTargetSheetKeys_ACU(targetSheetKeys: readonly string[]): string[] {
  if (!Array.isArray(targetSheetKeys)) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划的目标表必须是数组。');
  }
  const normalized = [...new Set(targetSheetKeys.map(sheetKey => requireNonEmptyString_ACU(sheetKey, '目标表')))].sort();
  if (!normalized.length) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划至少需要一个目标表。');
  }
  return normalized;
}

export function planTableFillBoundaryStaging_ACU(input: TableFillBoundaryStagingPlanInput_ACU): TableFillBoundaryStagingPlan_ACU {
  if (!input || typeof input !== 'object') {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划输入无效。');
  }
  if (!['manual_refill', 'auto_fill', 'manual_catch_up'].includes(input.runKind)) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划的运行类型无效。');
  }

  const runId = requireNonEmptyString_ACU(input.runId, 'runId');
  const chatKey = requireNonEmptyString_ACU(input.chatKey, 'chatKey');
  const isolationKey = typeof input.isolationKey === 'string' ? input.isolationKey : '';
  if (typeof input.isolationKey !== 'string') {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划的 isolationKey 必须是字符串。');
  }
  const templateFingerprint = requireNonEmptyString_ACU(input.templateFingerprint, '模板指纹');
  const targetSheetKeys = normalizeTargetSheetKeys_ACU(input.targetSheetKeys);
  const messageIndices = normalizeStrictlyIncreasingIndices_ACU(input.messageIndices, '待填索引');
  const fullCheckpointIndices = normalizeStrictlyIncreasingIndices_ACU(input.fullCheckpointIndices, 'full checkpoint 索引');

  if (fullCheckpointIndices.length > 1) {
    throw new TableFillBoundaryPlanError_ACU(
      'multiple_full_checkpoints',
      `跨 full checkpoint 填表规划拒绝执行：同一 isolationKey 下存在 ${fullCheckpointIndices.length} 个 full checkpoint（${fullCheckpointIndices.join(', ')}）。`,
    );
  }

  const originalFullIndex = fullCheckpointIndices[0] ?? null;
  const preBoundaryIndices = originalFullIndex === null ? [] : messageIndices.filter(index => index < originalFullIndex);
  const postBoundaryIndices = originalFullIndex === null ? messageIndices : messageIndices.filter(index => index >= originalFullIndex);
  const requiresStaging = preBoundaryIndices.length > 0;
  const scope: TableFillBoundaryStagingScope_ACU = Object.freeze({
    runKind: input.runKind,
    runId,
    chatKey,
    isolationKey,
    originalFullIndex,
    rangeStartMessageIndex: messageIndices[0] ?? null,
    rangeEndMessageIndex: messageIndices.length > 0 ? messageIndices[messageIndices.length - 1] : null,
    targetSheetKeys: Object.freeze([...targetSheetKeys]),
    templateFingerprint,
  });

  return {
    scope,
    preBoundaryIndices,
    postBoundaryIndices,
    requiresStaging,
    phase: requiresStaging ? 'pre_boundary_staging' : 'post_boundary_persisting',
    lastStagedTargetMessageIndex: null,
    stagedBucketCount: 0,
    boundaryCommitted: false,
  };
}

/**
 * 计划 5.2：统一按边界拆分计划。
 *
 * 跨原 full 边界的原 batch（indices 同时含 < originalFullIndex 与 >= originalFullIndex）
 * 必须拆成两个新 batch，并重新计算 messageIndices / first-last / saveTargetIndex /
 * mergeBaseMaxMessageIndex / batch/progress 序号。
 *
 * 每段返回：
 * - indices：该段实际待填楼层（已滤除不在 messageIndices 内的楼层）；
 * - saveTargetIndex：段内最后实际楼层；
 * - mergeBaseMaxMessageIndex：段内首楼 - 1；若段首为原根，则取 max(首楼-1, originalFullIndex)
 *   以便基底覆盖原根；pre 段段首即 rangeStart 时允许 -1（无边界基底，落模板基线）。
 */
export interface BoundarySegment_ACU {
  readonly indices: readonly number[];
  readonly saveTargetIndex: number;
  readonly mergeBaseMaxMessageIndex: number;
}

export function splitMessageIndicesAtBoundary_ACU(
  messageIndices: readonly number[],
  originalFullIndex: number | null,
  fullMessageIndexSet: ReadonlySet<number> = new Set(),
): BoundarySegment_ACU[] {
  const normalized = normalizeStrictlyIncreasingIndices_ACU(messageIndices, '待拆索引');
  if (!normalized.length) return [];
  if (originalFullIndex === null) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    return [{
      indices: [...normalized],
      saveTargetIndex: last,
      mergeBaseMaxMessageIndex: first - 1,
    }];
  }

  const segments: BoundarySegment_ACU[] = [];
  const pre = normalized.filter(index => index < originalFullIndex);
  const post = normalized.filter(index => index >= originalFullIndex);
  if (pre.length > 0) {
    segments.push({
      indices: [...pre],
      saveTargetIndex: pre[pre.length - 1],
      mergeBaseMaxMessageIndex: pre[0] - 1,
    });
  }
  if (post.length > 0) {
    const mergeBaseMax = post[0] - 1;
    // 若边界楼层本身在待填集合内且作为正式根，基底必须至少覆盖原根，
    // 防止用边界前空基底覆盖已确认的正式根数据。
    const effectiveMergeBaseMax = fullMessageIndexSet.has(originalFullIndex)
      ? Math.max(mergeBaseMax, originalFullIndex)
      : mergeBaseMax;
    segments.push({
      indices: [...post],
      saveTargetIndex: post[post.length - 1],
      mergeBaseMaxMessageIndex: effectiveMergeBaseMax,
    });
  }
  return segments;
}


/**
 * 计划 5.4：跨 full checkpoint 分阶段提交的边界汇合（boundary commit）。
 *
 * 边界前 bucket 只进入 run 级隔离 staging（stage_only，不写聊天 V2 frame），
 * 到达原 full 边界时，本服务把 staging 累计的目标表快照原子折叠为原 full frame
 * 上的 sheet_rebase，恢复原正式根；边界后继续普通逐 bucket 持久化。
 *
 * 不变量（对应计划 §3.2）：
 *  - 单正式根：事务内复检唯一 full checkpoint（多根 fail-closed）；
 *  - 严格保存：saveChatToHostStrict_ACU 失败原位回滚，不删除已确认数据；
 *  - 边界汇合：selected sheets 等于 staging 累计快照，非目标表等于原正式根语义；
 *  - 零猜测恢复：runId/聊天标识/隔离键/目标表集合不匹配时 fail-closed。
 */
export async function commitStagedSheetsAtFullBoundaryAtomic_ACU(
  runId: string,
  options: {
    chatKey?: string;
    isolationKey?: string;
    /** 原 full 边界楼层（replay 的正式根），staging 快照必须折叠到这个根上。 */
    originalFullIndex: number;
    /** staging 累计的目标表快照（含 mate 等元数据）。 */
    stagedSnapshot: Record<string, any>;
    /** 目标表集合（staging 期间选定的表）。 */
    targetSheetKeys: readonly string[];
  },
): Promise<
  | { ok: true; boundaryCommitSummary: { selectedSheetKeys: string[]; originalFullCheckpointIndex: number } }
  | { ok: false; error: string; diagnosticCode?: string }
> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const chatKey = options.chatKey ?? currentChatFileIdentifier_ACU;

  return runTableWriteTransaction_ACU({
    source: 'manual_fill',
    reason: 'commitStagedSheetsAtFullBoundaryAtomic',
    isolationKey,
    writeSet: [{ kind: 'all' }],
    maintenanceMode: 'exclusive',
  }, async () => {
    const chat = getChatArray_ACU();

    // 0. 聊天标识复检：staging 计划属于哪一份聊天，就只能汇合回那一份聊天。
    //    run 期间切聊（CHAT_CHANGED）会让 live chat / 回放根整体换掉，此时把旧聊天的
    //    staging 快照折叠进新聊天楼层，会产出一张“新聊天里从未出现过”的表内容。
    //    与 §3.2「零猜测恢复」一致：不匹配即丢弃 staging 并 fail-closed。
    const liveChatKey = String(currentChatFileIdentifier_ACU || '');
    if (chatKey !== liveChatKey) {
      return {
        ok: false,
        error: `boundary commit 拒绝执行：staging 所属聊天与当前聊天不一致（staging=${chatKey || '无标识'}, current=${liveChatKey || '无标识'}），已丢弃本次 staging 汇合。`,
        diagnosticCode: 'staging_chat_scope_mismatch',
      };
    }

    // 1. 复检唯一 full 根：同一 isolationKey 下只允许一个 full checkpoint。
    const fullIndices: number[] = [];
    for (let index = 0; index < chat.length; index += 1) {
      const message = chat[index];
      const container = readIsolatedDataContainer_ACU(message);
      if (!container) continue;
      const tagData = container[isolationKey];
      if (!isV2TagData_ACU(tagData)) continue;
      const frame = (tagData as any).storageFrame as TableStorageFrameV2_ACU | undefined;
      if (frame?.checkpoint?.kind === 'full') fullIndices.push(index);
    }
    if (fullIndices.length !== 1) {
      return {
        ok: false,
        error: `boundary commit 拒绝执行：同一 isolationKey 下存在 ${fullIndices.length} 个 full checkpoint（${fullIndices.join(', ')}），必须唯一。`,
        diagnosticCode: 'multiple_full_checkpoints',
      };
    }
    if (fullIndices[0] !== options.originalFullIndex) {
      return {
        ok: false,
        error: `boundary commit 原 full 根不匹配：expected=${options.originalFullIndex}, actual=${fullIndices[0]}；拒绝汇合。`,
        diagnosticCode: 'full_checkpoint_root_mismatch',
      };
    }

    // 2. 取出原 full frame 完整备份（replay 的正式根）。
    const originalMessage = chat[options.originalFullIndex];
    if (!originalMessage) {
      return { ok: false, error: `原 full checkpoint 楼层 ${options.originalFullIndex} 不存在，无法汇合。` };
    }
    const originalContainer = readIsolatedDataContainer_ACU(originalMessage) || {};
    const originalTagData = isV2TagData_ACU(originalContainer[isolationKey])
      ? JSON.parse(JSON.stringify(originalContainer[isolationKey]))
      : { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } };
    const frame = originalTagData.storageFrame as TableStorageFrameV2_ACU;
    if (frame.checkpoint?.kind !== 'full') {
      return { ok: false, error: `原 full checkpoint 楼层 ${options.originalFullIndex} 的 frame 缺少正式 full 根。` };
    }

    // 3. 在原 full frame 的 perSheetCheckpoints 为 selected sheets 写 sheet_rebase。
    const maxSeq = Math.max(0, ...(frame.logEntries || []).map(entry => Number((entry as any).seq) || 0));
    const now = Date.now();
    const perSheetCheckpoints = { ...(frame.perSheetCheckpoints || {}) };
    for (const sheetKey of options.targetSheetKeys) {
      const sheetData = options.stagedSnapshot[sheetKey];
      if (!sheetData || typeof sheetData !== 'object') {
        return { ok: false, error: `boundary commit 缺少 selected sheet 的 staging 快照：${sheetKey}。`, diagnosticCode: 'staging_snapshot_mismatch' };
      }
      const sheetCheckpointResult = buildCanonicalSheetCheckpoint_ACU({
        createdAt: now,
        reason: 'manual',
        sheetKey,
        data: sheetData,
        event: { filledSheetKeys: [sheetKey], changedSheetKeys: [sheetKey], groupKeys: [] },
        context: { messageIndex: options.originalFullIndex, isolationKey, reason: 'manual' },
      });
      if (!sheetCheckpointResult.checkpoint) {
        return { ok: false, error: `boundary commit 无法构建 selected sheet rebase：${sheetKey}：${sheetCheckpointResult.error}`, diagnosticCode: 'staging_snapshot_mismatch' };
      }
      perSheetCheckpoints[sheetKey] = {
        ...sheetCheckpointResult.checkpoint,
        timeline: {
          kind: 'sheet_rebase',
          activateAtMessageIndex: options.originalFullIndex,
          afterSeq: maxSeq,
        },
      };
    }
    frame.perSheetCheckpoints = perSheetCheckpoints;

    // 4. 候选聊天：先深度克隆 live chat，再把含 rebase 的原帧工作副本写进候选原楼层。
    //    全程不触碰 live chat（strict save 失败时原位回滚 chat）。
    const candidateChat = JSON.parse(JSON.stringify(chat)) as any[];
    const candidateOriginalMessage = candidateChat[options.originalFullIndex];
    if (!candidateOriginalMessage) {
      return { ok: false, error: `候选聊天缺少原 full 楼层 ${options.originalFullIndex}，无法汇合。` };
    }
    const candidateContainer = readIsolatedDataContainer_ACU(candidateOriginalMessage) || {};
    candidateContainer[isolationKey] = originalTagData;
    candidateOriginalMessage.TavernDB_ACU_IsolatedData = candidateContainer;

    // 5. 候选 replay 验证：原 full 边界与聊天末端双边界。
    try {
      // 阶段 H：双边界一次前向捕获（同根）或回退逐次冷 replay，校验语义不变。
      const boundaryStates = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(
        candidateChat, isolationKey,
        [options.originalFullIndex, candidateChat.length - 1],
        { updateRuntimeState: false, compatibilityMode: 'disabled' },
      );
      for (const [boundary, verifyReplay] of boundaryStates) {
        if (!verifyReplay || verifyReplay.baseKind !== 'full_checkpoint' || !verifyReplay.data) {
          return { ok: false, error: `boundary commit 候选 replay 未建立正式基底：boundary=${boundary}。`, diagnosticCode: 'boundary_replay_mismatch' };
        }
        if (verifyReplay.requiresCheckpointConvergence || verifyReplay.compatibilityRepairs?.length) {
          return { ok: false, error: `boundary commit 候选 replay 依赖兼容修复：boundary=${boundary}。`, diagnosticCode: 'boundary_replay_mismatch' };
        }
        // selected sheets 必须等于 staging 累计快照。
        for (const sheetKey of options.targetSheetKeys) {
          const verifySheet = verifyReplay.data?.[sheetKey] as { content?: unknown } | undefined;
          const snapshotSheet = options.stagedSnapshot[sheetKey] as { content?: unknown } | undefined;
          if (JSON.stringify(verifySheet?.content) !== JSON.stringify(snapshotSheet?.content)) {
            return { ok: false, error: `boundary commit 后 selected sheet 回放不一致：${sheetKey}。`, diagnosticCode: 'boundary_replay_mismatch' };
          }
        }
        // 非目标表必须等于原正式根语义。
        const originalCheckpointData = frame.checkpoint?.data || {};
        for (const [sheetKey, sheetValue] of Object.entries(originalCheckpointData)) {
          if (!sheetKey.startsWith('sheet_') || options.targetSheetKeys.includes(sheetKey)) continue;
          const verifySheet = verifyReplay.data?.[sheetKey] as { content?: unknown } | undefined;
          const originalSheet = sheetValue as { content?: unknown } | undefined;
          if (JSON.stringify(verifySheet?.content) !== JSON.stringify(originalSheet?.content)) {
            return { ok: false, error: `boundary commit 后非目标表回放不一致：${sheetKey}。`, diagnosticCode: 'boundary_replay_mismatch' };
          }
        }
      }
    } catch (error: any) {
      return { ok: false, error: `boundary commit 候选 replay 验证异常：${error?.message || String(error)}`, diagnosticCode: 'boundary_replay_mismatch' };
    }

    // 6. strict save：失败只撤销 candidate（不恢复已删除数据），原位回滚 chat。
    //    候选 replay 校验是异步边界，切聊可能落在它之后、落盘之前，故写盘前再次复检聊天标识。
    if (chatKey !== String(currentChatFileIdentifier_ACU || '')) {
      return {
        ok: false,
        error: `boundary commit 拒绝执行：候选校验期间当前聊天标识已变化（staging=${chatKey || '无标识'}, current=${String(currentChatFileIdentifier_ACU || '') || '无标识'}），已丢弃本次 staging 汇合。`,
        diagnosticCode: 'staging_chat_scope_mismatch',
      };
    }
    const before = JSON.parse(JSON.stringify(chat));
    try {
      chat.length = 0;
      chat.push(...candidateChat);
      writeMessageIdentity_ACU(candidateOriginalMessage, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });
      await saveChatToHostStrict_ACU();
    } catch (error: any) {
      chat.length = 0;
      chat.push(...before);
      return { ok: false, error: `boundary commit 严格保存失败：${error?.message || String(error)}`, diagnosticCode: 'boundary_commit_failed' };
    }
    logDebug_ACU(`[TableFillBoundaryStaging] 已原子汇合：runId=${runId}, originalFull=${options.originalFullIndex}, sheets=${options.targetSheetKeys.join('、')}。`);
    return {
      ok: true,
      boundaryCommitSummary: {
        selectedSheetKeys: [...options.targetSheetKeys],
        originalFullCheckpointIndex: options.originalFullIndex,
      },
    };
  });
}
