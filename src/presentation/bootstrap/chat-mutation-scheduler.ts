/**
 * presentation/bootstrap/chat-mutation-scheduler.ts
 * 楼层删除/滑动事件的代次化调度器：
 * - 用 trailing 防抖聚合快速连续事件（滑动楼层会连发 MESSAGE_SWIPED）；
 * - 用 MAX_WAIT_MS 上限保证事件流不把刷新无限推迟；
 * - 用 generation + running 保证同一时刻最多一轮执行、不并发 reloadStorageProvider；
 * - 执行体内部对 UI 刷新做失败隔离，确保向量索引 dirty 标记不被 UI 异常吞掉。
 *
 * 回滚开关：TRAILING_DELAY_MS 设 500、MAX_WAIT_MS 设 0 即退化为旧的裸 500ms 防抖行为。
 */
import { chatMutationDebounceTimer_ACU, _set_chatMutationDebounceTimer_ACU } from '../../service/runtime/state-manager';
import { reloadStorageProvider } from '../../service/table/table-storage-strategy';
import { isSqliteMode } from '../../service/table/storage-mode';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../components/pipeline-ui-helpers';
import { findSummaryTable_ACU, buildSummaryVectorIndexArchiveScopeKey_ACU } from '../../service/vector/summary-vector-index-archive-service';
import { markSummaryVectorIndexDirtyForRealign_ACU } from '../../service/vector/summary-vector-index-realign-state';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../../service/runtime/state-manager';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';

/** 连续事件停止后多久执行一轮；旧行为是 500ms。 */
export const TRAILING_DELAY_MS_ACU = 1200;
/** 从首次请求算起的最长等待，超过则立即执行，防止事件流无限推迟刷新。 */
export const MAX_WAIT_MS_ACU = 3000;

let generation_ACU = 0;
let firstRequestAt_ACU = 0;
let running_ACU = false;
let pendingAfterRun_ACU = false;
/** 最近一次调度原因；事件流里取最新一条标记 dirty，避免旧原因覆盖新原因。 */
let latestReason_ACU: 'chat_modified_deleted' | 'chat_modified_swiped' = 'chat_modified_swiped';

/**
 * 触发一次聊天变更刷新请求。同一时刻最多一轮执行；
 * 事件在 trailing 窗口内到达会被聚合，超过 MAX_WAIT_MS 则强制立即执行。
 */
export function scheduleChatMutationRefresh_ACU(reason: 'chat_modified_deleted' | 'chat_modified_swiped'): void {
  latestReason_ACU = reason;
  generation_ACU += 1;

  const now = Date.now();
  if (firstRequestAt_ACU === 0) firstRequestAt_ACU = now;

  if (now - firstRequestAt_ACU >= MAX_WAIT_MS_ACU) {
    clearTimeout(chatMutationDebounceTimer_ACU);
    _set_chatMutationDebounceTimer_ACU(null);
    void runMutationRound_ACU();
    return;
  }

  clearTimeout(chatMutationDebounceTimer_ACU);
  const timer = setTimeout(() => {
    _set_chatMutationDebounceTimer_ACU(null);
    void runMutationRound_ACU();
  }, TRAILING_DELAY_MS_ACU);
  _set_chatMutationDebounceTimer_ACU(timer);
}

/** 取消待执行的调度（聊天切换时调用，避免旧聊天的刷新落到新聊天上）。 */
export function cancelPendingChatMutationRefresh_ACU(): void {
  clearTimeout(chatMutationDebounceTimer_ACU);
  _set_chatMutationDebounceTimer_ACU(null);
  generation_ACU += 1; // 使已排队的 runMutationRound_ACU 变为过期代次
  firstRequestAt_ACU = 0;
}

async function runMutationRound_ACU(): Promise<void> {
  if (running_ACU) {
    pendingAfterRun_ACU = true;
    return;
  }
  running_ACU = true;
  const startedGeneration = generation_ACU;
  firstRequestAt_ACU = 0;

  try {
    // 与旧实现保持一致的执行顺序；每步独立隔离，失败不中断后续步骤
    if (isSqliteMode()) {
      try {
        logDebug_ACU('[SQLite] 聊天变更：重建内存数据库...');
        await reloadStorageProvider();
        logDebug_ACU('[SQLite] 聊天变更：内存数据库重建完成');
      } catch (e: any) {
        logError_ACU(`[SQLite] 聊天变更：数据库重建失败: ${e?.message}`);
      }
    }

    // UI 刷新失败不允许吞掉向量索引 dirty 标记（否则索引永远不对齐）
    try {
      await refreshMergedDataAndNotifyWithUI_ACU();
    } catch (e: any) {
      logError_ACU(`[聊天变更] 合并数据与 UI 刷新失败: ${e?.message}`);
    }

    const realignDirtyReason = latestReason_ACU;
    const summaryTable = findSummaryTable_ACU();
    if (currentChatFileIdentifier_ACU && summaryTable?.summaryKey) {
      const scopeKey = buildSummaryVectorIndexArchiveScopeKey_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey: getCurrentIsolationKey_ACU(),
        sourceTableKey: summaryTable.summaryKey,
      });
      markSummaryVectorIndexDirtyForRealign_ACU(scopeKey, realignDirtyReason);
      logDebug_ACU(`[交火向量索引] ${realignDirtyReason}: 已标记 scope=${scopeKey} 下一次归档后执行懒对齐。`);
    }
  } finally {
    running_ACU = false;
  }

  // 执行期间又有新请求（或旧代次被取消但又有新请求）→ 按最新 generation 再跑一轮
  if (pendingAfterRun_ACU) {
    pendingAfterRun_ACU = false;
    if (generation_ACU > startedGeneration) {
      void runMutationRound_ACU();
    }
  }
}

/** 仅供测试重置内部状态。 */
export function __resetChatMutationSchedulerForTests_ACU(): void {
  clearTimeout(chatMutationDebounceTimer_ACU);
  _set_chatMutationDebounceTimer_ACU(null);
  generation_ACU = 0;
  firstRequestAt_ACU = 0;
  running_ACU = false;
  pendingAfterRun_ACU = false;
}
