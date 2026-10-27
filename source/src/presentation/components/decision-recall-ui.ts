/**
 * presentation/components/decision-recall-ui.ts — 决策召回「单独召回」在发送前的 UI 封装。
 *
 * 与剧情推进共用发送层编排（策略 1 / 策略 2、写回本轮输入、伪装楼层、中止恢复），
 * 返回值与 runOptimizationLogicWithUI_ACU 同口径：
 *   - string：写进本轮输入的最终内容
 *   - { skipped: true }：不改本轮输入，照常发送（纪要表为空 / 读不到、出错、切走聊天、飞行模式、在途去重）
 *   - { aborted: true, manual: true, restoreText }：用户点了「终止」
 * 打分失败、没填 Key 都不会停发：只弹提示，按已有结果照常发送。
 */
import { showToastr_ACU } from '../theme/toast';
import { toastr_API_ACU } from '../../shared/host-api';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { currentChatFileIdentifier_ACU, settings_ACU, trackAbortController_ACU, untrackAbortController_ACU } from '../../service/runtime/state-manager';
import { isFlightModeActive_ACU } from '../../service/flight-mode/flight-mode-state';
import { normalizeDecisionRecallSettings_ACU } from '../../service/decision-recall/decision-recall-settings';
import {
  buildDecisionRecallFinalMessage_ACU,
  describeDecisionRecallWarning_ACU,
  logDecisionRecallResult_ACU,
  runDecisionRecall_ACU,
} from '../../service/decision-recall/decision-recall-runtime';
import type { PendingDisguiseNotice_ACU } from './plot-pending-disguise';

export const DECISION_RECALL_PENDING_NOTICE_ACU: PendingDisguiseNotice_ACU = {
  message: '正在决策召回相关纪要，完成后会自动发送当前消息。',
  title: '决策召回',
};

const TOAST_TITLE_ACU = '决策召回';
let inFlight_ACU = false;

function showProgressToast_ACU(onAbort: () => void): any {
  const $toast = showToastr_ACU('info', `
      <div style="display: flex; align-items: center; justify-content: space-between;">
          <span class="toastr-message" style="margin-right: 10px;">正在用决策模型挑选相关纪要，请稍候...</span>
          <button class="qrf-abort-btn">终止</button>
      </div>
  `, {
    timeOut: 0,
    extendedTimeOut: 0,
    escapeHtml: false,
    tapToDismiss: false,
    closeButton: false,
    progressBar: false,
    toastClass: 'toast acu-toast acu-toast--info',
    acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLANNING,
  });
  setTimeout(() => {
    const $button = $toast?.find ? $toast.find('.qrf-abort-btn') : null;
    if (!$button?.length) return;
    $button.off('click').on('click', (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      onAbort();
    });
  }, 200);
  return $toast;
}

function clearToast_ACU($toast: any): void {
  try { if ($toast) toastr_API_ACU.clear($toast); } catch (e) {}
  try { if ($toast?.closest) $toast.closest('.toast').remove(); } catch (e) {}
}

export async function runDecisionRecallWithUI_ACU(userMessage: any, _options: any = {}) {
  const userInput = String(userMessage || '');
  if (isFlightModeActive_ACU()) return { skipped: true, reason: 'flight_mode' };
  if (inFlight_ACU) return { skipped: true, reason: 'inflight' };
  inFlight_ACU = true;

  const chatAtStart = currentChatFileIdentifier_ACU;
  const controller = new AbortController();
  // 按剧情推进的请求登记：切聊天时一并中止，用户终止填表时不受影响
  trackAbortController_ACU(controller, 'plot');
  let manuallyAborted = false;
  const $toast = showProgressToast_ACU(() => {
    manuallyAborted = true;
    controller.abort();
    logDebug_ACU('[决策召回] 用户点击了终止。');
  });

  try {
    const settings = normalizeDecisionRecallSettings_ACU(settings_ACU?.decisionRecallSettings);
    const result = await runDecisionRecall_ACU({ userInput, settings, signal: controller.signal });
    clearToast_ACU($toast);
    logDecisionRecallResult_ACU(result);
    if (manuallyAborted) {
      showToastr_ACU('info', '决策召回已被用户终止。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLANNING });
      return { aborted: true, manual: true, restoreText: userInput };
    }
    if (result.status === 'aborted' || currentChatFileIdentifier_ACU !== chatAtStart) {
      return { skipped: true, reason: 'scope_changed' };
    }
    if (result.status === 'skipped') return { skipped: true, reason: result.reason };

    const warning = describeDecisionRecallWarning_ACU(result);
    if (warning) showToastr_ACU('warning', warning, TOAST_TITLE_ACU);
    const pickedCount = result.selected.length - result.fixed.length;
    showToastr_ACU('success', `已带上 ${result.selected.length} 条纪要（最新 ${result.fixed.length} 条 + 挑选 ${pickedCount} 条）。`, TOAST_TITLE_ACU, {
      acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK,
    });
    return buildDecisionRecallFinalMessage_ACU(settings.directive, userInput, result.selected.map(row => row.indexCode));
  } catch (error) {
    clearToast_ACU($toast);
    if (manuallyAborted) return { aborted: true, manual: true, restoreText: userInput };
    logError_ACU('[决策召回] 发送前召回出错，本次照常发送、不带召回纪要:', error);
    showToastr_ACU('warning', '决策召回出错，本次没带召回纪要、照常发送。详情见运行日志。', TOAST_TITLE_ACU);
    return { skipped: true, reason: 'error' };
  } finally {
    untrackAbortController_ACU(controller);
    inFlight_ACU = false;
  }
}
