/**
 * presentation/triggers/settings-ui-sync/settings-ui-trigger.ts
 */

import {
  AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU
} from '../../../shared/defaults';
import {
  showToastr_ACU
} from '../../theme/toast';

import {
  getChatArray_ACU
} from '../../../service/chat/chat-service';


import {
  allChatMessages_ACU,
  isAutoUpdatingCard_ACU,
  wasStoppedByUser_ACU,
  _set_isAutoUpdatingCard_ACU,
  coreApisAreReady_ACU,
  currentChatFileIdentifier_ACU,
  currentJsonTableData_ACU,
  getCurrentIsolationKey_ACU,
  lastTotalAiMessages_ACU,
  settings_ACU,
  _set_lastTotalAiMessages_ACU,
  _set_wasStoppedByUser_ACU
} from '../../../service/runtime/state-manager';
import {
  processUpdates_ACU
} from '../update-process';
import {
  getSortedSheetKeys_ACU
} from '../../../service/template/chat-scope';
import {
  loadAllChatMessages_ACU,
  updateReadableLorebookEntry_ACU
} from '../../../service/worldbook/pipeline';
import {
  getStorageProvider
} from '../../../service/table/table-storage-strategy';

import {
  topLevelWindow_ACU
} from '../../../shared/env';
import {
  logDebug_ACU
} from '../../../shared/utils';


import {
  purgeOldLayerData_ACU
} from './settings-ui-config';
import {
  buildAutoUpdatePlan_ACU,
  checkAutoUpdatePreConditions_ACU,
  executeAutoUpdatePlan_ACU,
  handleFloorIncreaseDelay_ACU
} from '../../../service/table/update-scheduler';
import {
  resolveLatestAiFloor_ACU,
  shouldSkipDuplicateAutoTableFill_ACU,
  recordAutoTableFillProcessedForFloor_ACU,
} from '../../../service/table/auto-fill-echo-guard';
import {
  executeAutoFillStagingGroups_ACU,
  type CardUpdateProgressEvent
} from '../../../service/table/update-orchestrator';
import {
  isSqliteMode
} from '../../../service/table/storage-mode';
import {
  startRuntimePerformanceSpan_ACU
} from '../../../shared/runtime-performance';
import {
  logAutoFillSkip_ACU
} from '../../../shared/trigger-diagnostics';
import { countAiFloors_ACU } from '../../../shared/ai-floor';

function buildAutoUpdateProgressLabel_ACU(event: Partial<CardUpdateProgressEvent>): string {
    if (Number.isFinite(event.currentBatch) && Number.isFinite(event.totalBatches)) {
        return `第 ${event.currentBatch}/${event.totalBatches} 批`;
    }
    return '当前批次';
}

function buildAutoUpdateProgressMessage_ACU(event: CardUpdateProgressEvent): string {
    const batchLabel = buildAutoUpdateProgressLabel_ACU(event);
    switch (event.phase) {
        case 'preparing':
            return `${batchLabel}：准备AI输入...`;
        case 'calling_ai':
            return `${batchLabel}：第 ${event.attempt || 1}/${event.maxRetries || 1} 次调用AI进行增量更新...`;
        case 'parsing':
            return `${batchLabel}：解析并应用AI返回的更新...`;
        case 'saving':
            return `${batchLabel}：正在将更新后的数据库保存到聊天记录...`;
        case 'chunk_done':
            return `${batchLabel}：分块处理成功...`;
        case 'complete':
            return `${batchLabel}：数据库增量更新成功！`;
        case 'retry':
            return `${batchLabel}：第 ${event.attempt || 1}/${event.maxRetries || 1} 次尝试失败，5秒后重试...${event.message ? ` (${event.message})` : ''}`;
        case 'error':
            return `${batchLabel}：错误：更新失败。`;
        default:
            return `${batchLabel}：正在处理...`;
    }
}

async function refreshRuntimeDataAndNotifyAfterAutoUpdate_ACU(): Promise<void> {
    const data = getStorageProvider().getCurrentData() || currentJsonTableData_ACU;
    if (data) {
        await updateReadableLorebookEntry_ACU(true, false, null, data);
    }
    try {
        (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
    } catch (_) {}
}

// 存储模式恒为 SQLite：自动填表不再弹常驻进度框（原非 SQLite 分组路径已删除，R9-12），只提示重试。
function handleAutoGroupedProgressEvent_ACU(event: CardUpdateProgressEvent) {
    if (event.phase === 'retry') showToastr_ACU('warning', buildAutoUpdateProgressMessage_ACU(event), { timeOut: 5000 });
}

let autoUpdateTriggerInFlight_ACU = false;
let pendingAutoUpdateTrigger_ACU = false;
let pendingAutoUpdatePerformanceContext_ACU: { runId?: string; parentSpanId?: string } | undefined;
/** R9-18：跟发登记时所在的聊天与隔离域；补跑前比对，切了聊天就作废，不在新聊天上无消息烧一轮填表。 */
let pendingAutoUpdateScopeKey_ACU = '';

function currentAutoUpdateScopeKey_ACU(): string {
  return `${String(currentChatFileIdentifier_ACU || '')}::${String(getCurrentIsolationKey_ACU() || '')}`;
}

  export async function triggerAutomaticUpdateIfNeeded_ACU(
    performanceContext?: { runId?: string; parentSpanId?: string },
  ) {
    logDebug_ACU('ACU Auto-Trigger: Starting independent check...');
    if (autoUpdateTriggerInFlight_ACU) {
      pendingAutoUpdateTrigger_ACU = true;
      pendingAutoUpdatePerformanceContext_ACU = performanceContext;
      pendingAutoUpdateScopeKey_ACU = currentAutoUpdateScopeKey_ACU();
      logDebug_ACU('ACU Auto-Trigger: trigger already in flight. Coalescing a follow-up run.');
      logAutoFillSkip_ACU('auto_update_coalesced', {
        inFlight: true,
      });
      return;
    }
    // [回声防重] 外部 MVU 插件的非静默 generate 收尾会让宿主对本楼多派发一条 GENERATION_ENDED，
    // 此时 in-flight 锁已释放，填表链会被再拉一次（多烧一轮填表 AI）。这里按 messageId 短路：
    // 该楼已成功自动填过表 → 记日志直接返回，不构建计划、不调 AI。
    // 只作用于自动入口；手动填表/历史补填走各自入口，不经过本函数。
    const autoFillTargetFloor = resolveLatestAiFloor_ACU(getChatArray_ACU());
    if (shouldSkipDuplicateAutoTableFill_ACU(autoFillTargetFloor)) {
      logDebug_ACU(
        `[自动填表] 第 ${autoFillTargetFloor!.messageIndex} 楼（messageId=${autoFillTargetFloor!.messageId}）已完成自动填表，跳过重复自动触发`,
      );
      logAutoFillSkip_ACU('duplicate_auto_fill_ended', {
        messageId: autoFillTargetFloor!.messageId,
        resolvedMessageIndex: autoFillTargetFloor!.messageIndex,
      });
      return;
    }
    autoUpdateTriggerInFlight_ACU = true;
    // 新一轮自动填表开跑前清掉上一轮「终止」残留，避免 isStopped() 立刻把新任务掐死。
    _set_wasStoppedByUser_ACU(false);
    const performanceSpan = startRuntimePerformanceSpan_ACU('auto-update-trigger', {
      ...performanceContext,
      settings: settings_ACU,
    });

    try {
    // [重构] 调用 service 层前置检查
    const preCheck = checkAutoUpdatePreConditions_ACU(
        settings_ACU,
        coreApisAreReady_ACU,
        isAutoUpdatingCard_ACU,
        currentJsonTableData_ACU,
        allChatMessages_ACU.length
    );
    if (!preCheck.canProceed) {
      logDebug_ACU(`ACU Auto-Trigger: ${preCheck.reason} Skipping.`);
      logAutoFillSkip_ACU('preconditions_failed', {
        aiFloorCount: countAiFloors_ACU(allChatMessages_ACU),
        inFlight: isAutoUpdatingCard_ACU,
        preconditionReason: preCheck.code,
      });
      return;
    }

    let liveChat = getChatArray_ACU();
    if (!liveChat || liveChat.length === 0) {
      logAutoFillSkip_ACU('empty_chat');
      return;
    }

    let totalAiMessages = countAiFloors_ACU(liveChat);

    // [重构] 调用 service 层楼层增加延迟逻辑
    const delayResult = await handleFloorIncreaseDelay_ACU(
        totalAiMessages,
        lastTotalAiMessages_ACU,
        AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU,
        getChatArray_ACU,
        _set_lastTotalAiMessages_ACU
    );
    if (delayResult === null) {
      logAutoFillSkip_ACU('empty_chat');
      return;
    }
    if (delayResult) {
        liveChat = delayResult.liveChat;
        totalAiMessages = delayResult.totalAiMessages;
    }

    // [重构] 调用 service 层构建更新计划
    const triggerIsolationKey = getCurrentIsolationKey_ACU();
    const plan = buildAutoUpdatePlan_ACU(
      liveChat,
      currentJsonTableData_ACU,
      settings_ACU,
      triggerIsolationKey,
      { runId: performanceContext?.runId || performanceSpan.id, parentSpanId: performanceSpan.id },
    );
    if (plan.tablesToUpdate.length === 0) {
      logAutoFillSkip_ACU('no_tables_due', { aiFloorCount: totalAiMessages });
      return;
    }

    // UI：显示开始 toast
    const totalGroups = Object.keys(plan.updateGroups).length;
    const maxConcurrentGroups = Math.max(1, settings_ACU.maxConcurrentGroups || 1);
    if (totalGroups > maxConcurrentGroups) {
        showToastr_ACU('info', `检测到 ${plan.tablesToUpdate.length} 个表格需要更新，将分批并发处理 ${totalGroups} 组（每批最多 ${maxConcurrentGroups} 组）。`);
    } else {
        showToastr_ACU('info', `检测到 ${plan.tablesToUpdate.length} 个表格需要更新，将并发处理 ${totalGroups} 组。`);
    }

    const autoGroupedAbortController = new AbortController();
    // 调用 service 层执行更新计划，传入纯业务操作委托（不含 UI 操作）
    const result = await executeAutoUpdatePlan_ACU(
        plan,
        settings_ACU,
        _set_isAutoUpdatingCard_ACU,
        {
            processUpdates: (indices, mode, options) => processUpdates_ACU(indices, mode, options),
            // spv8.9：跨 replay 根（requiresBoundaryStaging）的组必须走 staging runner。
            // normal 组走 processUpdates_ACU，但跨根 staging 组必须有可用的 staging runner，
            // 否则 scheduler 会以 staging_runner_unavailable 稳定失败（不再降级到
            // processUpdates —— 那会让写目标早于 full checkpoint 的 bucket 在 AI 消耗
            // token 后才被 persist 层 fail-fast）。
            processStagingGroupedUpdates: (groups, mode, options) => {
                // 跨 full checkpoint 边界组：共享 staging runner（pre 段 stage_only、
                // 边界原子汇合、post 段普通持久化）。boundary 元数据来自计划构建层。
                const upstreamProgress = options?.onProgress;
                return executeAutoFillStagingGroups_ACU(groups, mode, {
                    ...options,
                    boundary: {
                        fullCheckpointIndices: plan.boundary?.fullCheckpointIndices || [],
                        requiresBoundaryStaging: plan.boundary?.requiresBoundaryStaging || false,
                    },
                    abortController: autoGroupedAbortController,
                    onProgress: event => {
                        upstreamProgress?.(event);
                        handleAutoGroupedProgressEvent_ACU(event);
                    },
                });
            },
            refreshData: () => refreshRuntimeDataAndNotifyAfterAutoUpdate_ACU(),
            loadAllChatMessages: () => loadAllChatMessages_ACU(),
            purgeOldLayerData: () => purgeOldLayerData_ACU(),
        },
        { runId: performanceContext?.runId || performanceSpan.id, parentSpanId: performanceSpan.id },
    );

    // [回声防重] 只有「确实有活干且全部分组成功提交、且未被用户终止」才登记该楼已自动填表；
    // 空计划（本轮无表到期）不登记，避免把「还没填过」误标成「已填完」。
    if (result.totalGroups > 0 && result.failedGroups === 0 && !wasStoppedByUser_ACU) {
      const recordedFloor = recordAutoTableFillProcessedForFloor_ACU(autoFillTargetFloor);
      if (recordedFloor) {
        logDebug_ACU(`[自动填表] 已登记第 ${recordedFloor.messageIndex} 楼的自动填表完成记录，用于回声触发判重`);
      }
    }

    // UI：根据返回值显示结果
    if (result.failedGroups > 0) {
        const firstError = Array.isArray(result.errors) && result.errors.length > 0 ? result.errors[0] : '';
        showToastr_ACU('warning', firstError
            ? `并发分组更新有 ${result.failedGroups} 组失败：${firstError}`
            : `并发分组更新有 ${result.failedGroups} 组失败，请查看日志。`);
    }
    } finally {
      performanceSpan.end({
        messageCount: getChatArray_ACU()?.length || 0,
        sheetCount: currentJsonTableData_ACU ? getSortedSheetKeys_ACU(currentJsonTableData_ACU).length : 0,
        sqlite: isSqliteMode(),
      });
      autoUpdateTriggerInFlight_ACU = false;
      if (
        !pendingAutoUpdateTrigger_ACU
        || wasStoppedByUser_ACU
        || pendingAutoUpdateScopeKey_ACU !== currentAutoUpdateScopeKey_ACU()
      ) {
        pendingAutoUpdateTrigger_ACU = false;
        pendingAutoUpdatePerformanceContext_ACU = undefined;
        pendingAutoUpdateScopeKey_ACU = '';
        return;
      }
      const followUpContext = pendingAutoUpdatePerformanceContext_ACU;
      pendingAutoUpdateTrigger_ACU = false;
      pendingAutoUpdatePerformanceContext_ACU = undefined;
      queueMicrotask(() => { void triggerAutomaticUpdateIfNeeded_ACU(followUpContext); });
    }
  }

