/**
 * service/table/runtime-only-pending-flush.ts — 把 runtime-only 变更物化进聊天 V2 帧。
 *
 * 触发时机（见 runtime-only-pending-state 的问题描述）：
 * - 任何普通（非 skipChatSave）持久化提交之前——兑现文档承诺「随后一次落盘写入即持久化」；
 * - 任何填表构建基底之前——填表基底来自聊天回放，必须先让聊天追上 live runtime，
 *   否则 AI 会把 runtime 里已有的行当作不存在重新 INSERT；
 * - 首楼 seed checkpoint 建立之前——seed 会重载运行时，未落盘的行会被直接丢弃。
 *
 * 做法：对登记的表，以当前运行时内容写一条 source:'system' 的 sheet_replace 增量到
 * 最新可追加的 AI 楼层；与聊天回放内容完全一致的表跳过（避免无意义的日志条目）。
 * 不推进 runtime revision（runtime 本身没有变化），不作为填表记录（不推进调度）。
 */

import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import type { ITableStorageProvider } from '../../shared/table-storage-provider';
import type { TableMutationOperationV2_ACU } from './storage-frame-v2-types';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { isSqliteMode } from './storage-mode';
import { loadTableStateFromFramesV2Detailed_ACU } from './storage-frame-v2-replay';
import { getLatestTableAppendMessageIndexFromChat_ACU } from './table-history';
import { ensureStorageProviderReady_ACU } from './table-storage-strategy';
import { runTableUpdateCommit_ACU } from './table-update-commit';
import {
  clearRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  registerRuntimeOnlyPendingFlusher_ACU,
  type RuntimeOnlyPendingFlushResult_ACU,
} from './runtime-only-pending-state';

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function currentScope_ACU(): { chatKey: string; isolationKey: string } {
  return {
    chatKey: String(currentChatFileIdentifier_ACU || ''),
    isolationKey: String(getCurrentIsolationKey_ACU() || ''),
  };
}

/**
 * 读取 live runtime 的当前内容。
 *
 * SqlTableService.getCurrentData() 在引擎未就绪或导出失败时按既有 dataStale 契约回落到
 * 共享 JSON 视图——那份视图可能停留在写入前状态，拿它写回聊天会把陈旧数据固化成楼层帧。
 * 因此 SQLite 模式优先走严格导出：导出不可用就返回 null，让本次 flush 保留登记、下次再试。
 */
function readLiveRuntimeDataStrict_ACU(provider: ITableStorageProvider): TableDataObject_ACU | null {
  const strictExport = (provider as { exportLiveRuntimeDataStrict_ACU?: () => TableDataObject_ACU | null }).exportLiveRuntimeDataStrict_ACU;
  if (typeof strictExport === 'function') return strictExport.call(provider);
  return provider.getCurrentData();
}

async function readRuntimeSnapshot_ACU(): Promise<TableDataObject_ACU | null> {
  if (isSqliteMode()) {
    const provider = await ensureStorageProviderReady_ACU();
    const data = readLiveRuntimeDataStrict_ACU(provider);
    return data ? cloneJson_ACU(data as TableDataObject_ACU) : null;
  }
  return currentJsonTableData_ACU ? cloneJson_ACU(currentJsonTableData_ACU as TableDataObject_ACU) : null;
}

function serializeSheetContent_ACU(sheet: unknown): string {
  const content = (sheet as Sheet_ACU | null)?.content;
  return JSON.stringify(Array.isArray(content) ? content : null);
}

/**
 * 回放到目标楼层，找出运行时内容与聊天不一致的表。回放失败时保守地返回全部候选表：
 * 多写一条与既有状态相同的 sheet_replace 是幂等的，漏写才会丢数据。
 */
async function resolveDivergedSheetKeys_ACU(
  chat: any[],
  isolationKey: string,
  targetMessageIndex: number,
  runtimeData: TableDataObject_ACU,
  candidateSheetKeys: string[],
): Promise<string[]> {
  try {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
      maxMessageIndex: targetMessageIndex,
      updateRuntimeState: false,
      allowTemporaryTemplateBaseline: true,
    });
    const replayed = replay?.data as Record<string, unknown> | undefined;
    if (!replayed) return candidateSheetKeys;
    return candidateSheetKeys.filter(sheetKey => (
      serializeSheetContent_ACU(replayed[sheetKey]) !== serializeSheetContent_ACU((runtimeData as Record<string, unknown>)[sheetKey])
    ));
  } catch (error) {
    logWarn_ACU('[RuntimeOnlyFlush] 回放比对失败，按全部登记表落盘。', error);
    return candidateSheetKeys;
  }
}

/** 持锁重算后无可落盘内容的内部哨兵：apply 以 precondition 失败上浮，flush 层据此清空登记。 */
const NOTHING_TO_FLUSH_ERROR_ACU = '__ACU_RUNTIME_ONLY_FLUSH_NOTHING_TO_FLUSH__';

export async function flushRuntimeOnlyPendingChanges_ACU(reason: string): Promise<RuntimeOnlyPendingFlushResult_ACU> {
  const scope = currentScope_ACU();
  const pending = readRuntimeOnlyPendingSheets_ACU(scope);
  if (!pending) return { flushed: false, sheetKeys: [] };

  // T0 快路径预检（锁外）：全部一致时直接清登记返回，不进提交事务。
  let runtimeData: TableDataObject_ACU | null;
  try {
    runtimeData = await readRuntimeSnapshot_ACU();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn_ACU(`[RuntimeOnlyFlush] ${reason}: 无法读取运行时快照，保留待落盘登记。`, error);
    return { flushed: false, sheetKeys: [], error: message };
  }
  if (!runtimeData) return { flushed: false, sheetKeys: [], error: 'runtime snapshot unavailable' };

  const runtimeSheetKeys = Object.keys(runtimeData).filter(key => key.startsWith('sheet_'));
  const candidateSheetKeys = pending.all
    ? runtimeSheetKeys
    : pending.sheetKeys.filter(sheetKey => runtimeSheetKeys.includes(sheetKey));
  if (candidateSheetKeys.length === 0) {
    // 登记的表已不在运行时（被删除/重载），没有可落盘的内容。
    clearRuntimeOnlyPendingSheets_ACU(scope);
    return { flushed: false, sheetKeys: [] };
  }

  const chat = getChatArray_ACU();
  const targetMessageIndex = getLatestTableAppendMessageIndexFromChat_ACU(chat, scope.isolationKey, settings_ACU);
  if (targetMessageIndex < 0) {
    return { flushed: false, sheetKeys: [], error: 'no AI message to persist runtime-only changes' };
  }

  const divergedSheetKeys = await resolveDivergedSheetKeys_ACU(chat, scope.isolationKey, targetMessageIndex, runtimeData, candidateSheetKeys);
  if (divergedSheetKeys.length === 0) {
    clearRuntimeOnlyPendingSheets_ACU(scope);
    logDebug_ACU(`[RuntimeOnlyFlush] ${reason}: 运行时与聊天回放一致，无需落盘（${candidateSheetKeys.join('、')}）。`);
    return { flushed: false, sheetKeys: [] };
  }

  // 事务内重建（持锁后 fresh strict export）：T0 快照可能已过期——并发第二写者在
  // 快照读取与抢锁之间提交时，旧快照会把它已提交的结果回滚掉。写入集、目标楼层与
  // operations 一律以持锁后的最新运行时为准；T0 值仅作提交选项回退。writeSet 取全部
  // 候选表（⊇ 持锁重算后的任何分歧集），保证重算新增的分歧表也在锁覆盖范围内。
  let flushedSheetKeys: string[] | null = null;
  let flushedMessageIndex: number | null = null;
  const commitResult = await runTableUpdateCommit_ACU<null>({
    source: 'system',
    reason: `runtime_only_flush:${reason}`,
    isolationKey: scope.isolationKey,
    writeSet: candidateSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey })),
    // 运行时本身没有变化，只是把它写回聊天：不推进 runtime revision，
    // 否则会让并发填表已捕获的 baseRevision 误判为冲突。
    revisionWriteSet: [],
    workingDataMode: 'none',
    initialData: runtimeData,
    targetMessageIndex,
    targetSheetKeys: divergedSheetKeys,
    updateGroupKeys: null,
    trackingSheetKeys: [],
    trackAsUpdate: false,
    skipRuntimeOnlyPendingFlush: true,
  }, async () => {
    let freshData: TableDataObject_ACU | null;
    try {
      freshData = await readRuntimeSnapshot_ACU();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn_ACU(`[RuntimeOnlyFlush] ${reason}: 持锁后无法读取运行时快照，保留待落盘登记。`, error);
      return { success: false as const, error: message, errorCategory: 'infrastructure' as const };
    }
    if (!freshData) {
      return { success: false as const, error: 'runtime snapshot unavailable', errorCategory: 'infrastructure' as const };
    }
    const freshSheetKeys = Object.keys(freshData).filter(key => key.startsWith('sheet_'));
    const freshCandidates = pending.all
      ? freshSheetKeys
      : pending.sheetKeys.filter(sheetKey => freshSheetKeys.includes(sheetKey));
    const freshChat = getChatArray_ACU();
    const freshTargetMessageIndex = getLatestTableAppendMessageIndexFromChat_ACU(freshChat, scope.isolationKey, settings_ACU);
    if (freshTargetMessageIndex < 0) {
      return { success: false as const, error: 'no AI message to persist runtime-only changes', errorCategory: 'precondition' as const };
    }
    if (freshCandidates.length === 0) {
      // 登记表在持锁期间已从运行时消失：无可落盘内容，与 T0 同语义（清空登记）。
      return { success: false as const, error: NOTHING_TO_FLUSH_ERROR_ACU, errorCategory: 'precondition' as const };
    }
    const freshDivergedSheetKeys = await resolveDivergedSheetKeys_ACU(freshChat, scope.isolationKey, freshTargetMessageIndex, freshData, freshCandidates);
    if (freshDivergedSheetKeys.length === 0) {
      // 并发写者已把内容物化进聊天：与回放一致，无需落盘（清空登记）。
      return { success: false as const, error: NOTHING_TO_FLUSH_ERROR_ACU, errorCategory: 'precondition' as const };
    }
    const freshOperations: TableMutationOperationV2_ACU[] = freshDivergedSheetKeys.map(sheetKey => ({
      kind: 'sheet_replace',
      sheetKey,
      sheet: cloneJson_ACU((freshData as Record<string, any>)[sheetKey]) as Sheet_ACU,
      reason: 'system',
    }));
    flushedSheetKeys = freshDivergedSheetKeys;
    flushedMessageIndex = freshTargetMessageIndex;
    return {
      success: true as const,
      value: null,
      tableData: freshData,
      persist: {
        targetMessageIndex: freshTargetMessageIndex,
        targetSheetKeys: freshDivergedSheetKeys,
        operations: freshOperations,
      },
    };
  });

  if (!commitResult.success) {
    if (commitResult.error === NOTHING_TO_FLUSH_ERROR_ACU) {
      clearRuntimeOnlyPendingSheets_ACU(scope);
      logDebug_ACU(`[RuntimeOnlyFlush] ${reason}: 持锁重算后运行时与聊天回放一致，无需落盘（${candidateSheetKeys.join('、')}）。`);
      return { flushed: false, sheetKeys: [] };
    }
    logWarn_ACU(`[RuntimeOnlyFlush] ${reason}: 运行时未落盘变更写回聊天失败，保留登记待下次重试：${commitResult.error || 'unknown error'}`);
    return { flushed: false, sheetKeys: divergedSheetKeys, error: commitResult.error };
  }

  clearRuntimeOnlyPendingSheets_ACU(scope);
  const finalSheetKeys = flushedSheetKeys ?? divergedSheetKeys;
  const finalMessageIndex = flushedMessageIndex ?? targetMessageIndex;
  logDebug_ACU(`[RuntimeOnlyFlush] ${reason}: 已把运行时未落盘变更写回 AI 楼层 #${commitResult.messageIndex ?? finalMessageIndex}：${finalSheetKeys.join('、')}。`);
  return { flushed: true, sheetKeys: finalSheetKeys, messageIndex: commitResult.messageIndex ?? finalMessageIndex };
}
registerRuntimeOnlyPendingFlusher_ACU(flushRuntimeOnlyPendingChanges_ACU);
