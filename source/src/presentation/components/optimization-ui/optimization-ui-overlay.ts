/**
 * presentation/components/optimization-ui/optimization-ui-overlay.ts
 * 优化覆盖层和进度 Toast
 */
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../../shared/defaults-json.js';
import { activePlotEditorSettings_ACU, buildDefaultPlotPromptGroup_ACU, currentEditablePlotPresetState_ACU, currentPlotTaskEditorId_ACU, ensurePlotPromptGroup_ACU , _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU} from '../../../service/plot/plot-state';
import { showToastr_ACU } from '../../theme/toast';
import { getChatArray_ACU, saveChatToHost_ACU, setChatMessages_ACU, emitMessageUpdated_ACU } from '../../../service/chat/chat-service';
import { jQuery_API_ACU } from '../../dom-utils';
import { toastr_API_ACU } from '../../../shared/host-api';
import { currentChatFileIdentifier_ACU, settings_ACU } from '../../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../settings-ui-helpers';
import { buildChatPlotScopeStateFromSettings_ACU, clearCurrentChatPlotScopeState_ACU, getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU, setCurrentChatPlotScopeState_ACU } from '../../../service/template/chat-scope';
import { SCRIPT_ID_PREFIX_ACU } from '../../../shared/constants';
import { escapeHtml_ACU, renderStopButton_ACU } from '../../../shared/html-helpers';
import { cleanChatName_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU } from '../../../shared/utils';
import { triggerAutomaticUpdateIfNeeded_ACU } from '../../triggers/settings-ui-sync';
import { cancelContentOptimization_ACU, contentOptimizationAbortRequested_ACU, ensureOptimizationNotCancelled_ACU, getLastOptimizationBase_ACU, optimizationProgressToast_ACU, performContentOptimization_ACU, setLastOptimizationBase_ACU, _set_optimizationProgressToast_ACU, _set_contentOptimizationAbortRequested_ACU } from '../../../service/optimization/content-optimization';
import { applyContextTagFilters_ACU } from '../../../service/runtime/helpers-remaining';
import { getActivePlotEditorSettings_ACU, getPlotPromptContentByIdFromSettings_ACU, setPlotPromptContentByIdForSettings_ACU, ensureLoopPromptsArray_ACU } from '../../../service/plot/plot-logic';

  // --- [正文优化] 构建默认提示词组 ---
  export function showOptimizationOverlay_ACU(message = '正在优化正文...') {
    // 移除已存在的遮罩
    hideOptimizationOverlay_ACU();
    
    const overlayHtml = `
      <div id="acu-optimization-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 16px;
      ">
        <div style="
          width: 50px;
          height: 50px;
          border: 3px solid rgba(255, 255, 255, 0.3);
          border-top-color: #7bb7ff;
          border-radius: 50%;
          animation: acu-spin 1s linear infinite;
        "></div>
        <div style="
          color: rgba(255, 255, 255, 0.9);
          font-size: 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">${message}</div>
        <button id="acu-optimization-overlay-cancel" style="
          padding: 10px 18px;
          border: 1px solid rgba(255, 193, 7, 0.7);
          background: transparent;
          color: #ffc107;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        ">取消优化</button>
      </div>
      <style>
        @keyframes acu-spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
    
    jQuery_API_ACU('body').append(overlayHtml);
    jQuery_API_ACU('#acu-optimization-overlay-cancel').off('click.acu_opt_cancel').on('click.acu_opt_cancel', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const cancelResult = cancelContentOptimization_ACU('正文优化已取消。');
      if (cancelResult.cancelled) showToastr_ACU('warning', cancelResult.reason);
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
    });
  }

  /**
   * 显示正文优化进度提示框（无遮罩模式）
   * @param {string} message - 提示消息
   */
  export function showOptimizationProgressToast_ACU(message = '正在进行正文优化...') {
    hideOptimizationProgressToast_ACU();
    const stopButtonHtml = renderStopButton_ACU('acu-opt-stop-btn', '取消优化');
    _set_optimizationProgressToast_ACU(showToastr_ACU('info', `<div>${message}${stopButtonHtml}</div>`, {
      timeOut: 0,
      extendedTimeOut: 0,
      tapToDismiss: false,
      onShown: function() {
        jQuery_API_ACU('#acu-opt-stop-btn').off('click.acu_opt_cancel').on('click.acu_opt_cancel', function(e) {
          e.preventDefault();
          e.stopPropagation();
          const cancelResult2 = cancelContentOptimization_ACU('正文优化已取消。');
          if (cancelResult2.cancelled) showToastr_ACU('warning', cancelResult2.reason);
          hideOptimizationOverlay_ACU();
          hideOptimizationProgressToast_ACU();
          jQuery_API_ACU(this).closest('.toast').remove();
        });
      }
    }));
  }

  /**
   * 隐藏正文优化进度提示框
   */
  export function hideOptimizationProgressToast_ACU() {
    if (optimizationProgressToast_ACU && toastr_API_ACU) {
      toastr_API_ACU.clear(optimizationProgressToast_ACU);
    }
    _set_optimizationProgressToast_ACU(null);
  }
  
  /**
   * 隐藏无感替换遮罩
   */
  export function hideOptimizationOverlay_ACU() {
    jQuery_API_ACU('#acu-optimization-overlay').remove();
  }
  
  /**
   * 替换酒馆消息内容
   * @param {number} messageIndex - 消息索引
   * @param {string} newContent - 新内容
   */
