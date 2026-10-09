/**
 * presentation/components/plot-planning-ui.ts — 剧情规划 UI 层封装
 * 负责：进度 toast、中止按钮事件绑定、根据 service 层结果弹 toast 通知
 */
import { showToastr_ACU } from '../theme/toast';
import { toastr_API_ACU } from '../../shared/host-api';
import { abortController_ACU, _set_isProcessing_Plot_ACU } from '../../service/runtime/state-manager';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { runOptimizationLogic_ACU } from '../../service/runtime/helpers-remaining';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

/**
 * 在 presentation 层调用 runOptimizationLogic_ACU 并处理所有 UI 反馈。
 * 返回值与原 runOptimizationLogic_ACU 兼容：
 *   - string: 规划成功的最终消息
 *   - { apiRetriesExhausted: true }: API 调用失败且重试耗尽（发送层据此中断）
 *   - { blocked: true, reason: string }: 规划失败（阶段失败 / 全部任务无结果 / 异常等），发送层据此中断：
 *     宁可不发，也不带着残缺的规划发（移植上游 2adf068b）
 *   - { skipped: true, reason: string }: 未执行规划（关闭 / 在途去重 / 没有任务 / 已切走聊天），继续宿主发送
 *   - { aborted: true, manual: true, restoreText: string }: 用户中止
 */
const PLOT_FAILED_STOP_SUFFIX_ACU = '本次发送已停止，可重新发送或点「重新生成」重试（会重新规划）。';
/** 不算规划失败、照常发送的情形：没有可执行任务、规划期间已切走聊天（停发会误伤新聊天）。 */
const PLOT_NON_FAILURE_ERROR_TYPES_ACU = new Set(['no_tasks', 'scope_changed']);

export async function runOptimizationLogicWithUI_ACU(userMessage: any, options: any = {}) {
  let manuallyAborted = false;
  // 1. 创建带中止按钮的进度 toast
  const toastMsg = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
          <span class="toastr-message" style="margin-right: 10px;">正在读取过往的记忆并分析，请稍后...</span>
          <button class="qrf-abort-btn">终止</button>
      </div>
  `;

  const $toast = showToastr_ACU('info', toastMsg, {
    timeOut: 0,
    extendedTimeOut: 0,
    escapeHtml: false,
    tapToDismiss: false,
    closeButton: false,
    progressBar: false,
    toastClass: 'toast acu-toast acu-toast--info',
    acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLANNING,
  });

  // 2. 绑定中止按钮事件
  setTimeout(() => {
    const $abortBtn = ($toast && $toast.find) ? $toast.find('.qrf-abort-btn') : null;
    if ($abortBtn && $abortBtn.length > 0) {
      $abortBtn.off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        manuallyAborted = true;
        logDebug_ACU('[剧情推进] 用户点击了中止按钮。');

        if (abortController_ACU) {
          abortController_ACU.abort();
          logDebug_ACU('[剧情推进] 用户手动中止了规划任务。');
        }

        try {
          if ($toast) toastr_API_ACU.clear($toast);
        } catch (e) {}
        // DOM 级兜底：确保 toast 元素被彻底移除，防止 toastr.clear 不生效
        try {
          if ($toast && $toast.closest) $toast.closest('.toast').remove();
        } catch (e) {}
        _set_isProcessing_Plot_ACU(false);

        setTimeout(() => {
          showToastr_ACU('info', '规划任务已被用户中止。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLANNING });
        }, 500);
      });
      logDebug_ACU('[剧情推进] 中止按钮事件已绑定。');
    } else {
      logWarn_ACU('[剧情推进] 未找到中止按钮元素。');
    }
  }, 200);

  // 3. 调用 service 层纯函数：异常不向外抛，转 blocked 由发送层停发
  let result: Awaited<ReturnType<typeof runOptimizationLogic_ACU>>;
  try {
    result = await runOptimizationLogic_ACU(userMessage, {
      ...options,
      reportWarning: (text: string) => showToastr_ACU('warning', text, '剧情推进'),
    });
  } catch {
    try { if ($toast) toastr_API_ACU.clear($toast); } catch (e) {}
    if (manuallyAborted) return { aborted: true, manual: true, restoreText: String(userMessage || '') };
    showToastr_ACU('error', `剧情任务处理异常，${PLOT_FAILED_STOP_SUFFIX_ACU}`, '规划失败', {
      acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
    });
    return { blocked: true, reason: 'processing_error' };
  }

  // 4. 清除进度 toast
  try { if ($toast) toastr_API_ACU.clear($toast); } catch (e) {}

  // 5. 根据结果做 UI 通知
  if (manuallyAborted) return { aborted: true, manual: true, restoreText: String(userMessage || '') };
  if (!result) {
    return { skipped: true, reason: 'no_result' };
  }

  // 跳过的情况（retrying / inflight / disabled）—— 不弹 toast，静默返回
  if (result.skipped) {
    return { skipped: true, reason: result.reason };
  }

  // 用户中止
  if (result.aborted) {
    return { aborted: true, manual: result.manual, restoreText: result.restoreText };
  }

  // 规划失败一律停止本次发送；只有「没有可执行的任务」「已切走聊天」不算失败，照常发送。
  if (!result.success) {
    const errorMsg = result.errorMessage || '剧情任务未返回结果。';
    if (result.apiRetriesExhausted === true) {
      showToastr_ACU('error', errorMsg, '规划失败', {
        acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
      });
      return { apiRetriesExhausted: true };
    }
    if (PLOT_NON_FAILURE_ERROR_TYPES_ACU.has(String(result.errorType || ''))) {
      showToastr_ACU('warning', errorMsg, '剧情推进');
      return { skipped: true, reason: result.errorType || 'no_result' };
    }
    showToastr_ACU('error', `${errorMsg}${PLOT_FAILED_STOP_SUFFIX_ACU}`, '规划失败', {
      acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
    });
    return { blocked: true, reason: result.errorType || 'no_result' };
  }

  // 成功：弹结果 toast
  if (result.aggregatedTagNames && result.aggregatedTagNames.length > 0) {
    showToastr_ACU('info', `已成功聚合 [${result.aggregatedTagNames.join(', ')}] 标签内容并注入。`, '标签摘取');
  }

  if (result.hasPartialFailure) {
    showToastr_ACU(
      'warning',
      `剧情规划完成，${result.successCount}/${result.enabledTaskCount} 个任务成功。`,
      '部分成功',
      { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK },
    );
  } else {
    showToastr_ACU(
      'success',
      `剧情规划成功，共完成 ${result.successCount} 个任务。`,
      '规划成功',
      { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK },
    );
  }

  return result.finalMessage;
}
