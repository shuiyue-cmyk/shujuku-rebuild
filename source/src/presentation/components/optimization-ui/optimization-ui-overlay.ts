/**
 * presentation/components/optimization-ui/optimization-ui-overlay.ts
 * 优化覆盖层和进度 Toast
 */

import {
  _set_currentEditablePlotPresetState_ACU,
  _set_activePlotEditorSettings_ACU,
  _set_currentPlotTaskEditorId_ACU
} from '../../../service/plot/plot-state';
import {
  showToastr_ACU
} from '../../theme/toast';
import {
  jQuery_API_ACU
} from '../../dom-utils';
import {
  toastr_API_ACU
} from '../../../shared/host-api';



import {
  escapeHtml_ACU,
  renderStopButton_ACU
} from '../../../shared/html-helpers';
import {
  ACU_HOST_SURFACE_CLASS_ACU
} from '../../../shared/constants';
import {
  ensureHostDialogStylesInjected_ACU,
  renderHostDialogButton_ACU
} from '../../theme/host-dialog';

import {
  cancelContentOptimization_ACU,
  optimizationProgressToast_ACU,
  _set_optimizationProgressToast_ACU,
  _set_contentOptimizationAbortRequested_ACU
} from '../../../service/optimization/content-optimization';


  // --- [正文优化] 构建默认提示词组 ---
  export function showOptimizationOverlay_ACU(message = '正在优化正文...') {
    // 移除已存在的遮罩
    hideOptimizationOverlay_ACU();
    
    const overlayHtml = `
      <div id="acu-optimization-overlay" class="acu-hd-layer ${ACU_HOST_SURFACE_CLASS_ACU}" data-tt-mobile-surface="backdrop">
        <div class="acu-hd-busy" role="status" aria-live="polite">
          <div class="acu-hd-spinner" aria-hidden="true"></div>
          <div class="acu-hd-busy__text">${escapeHtml_ACU(String(message))}</div>
          ${renderHostDialogButton_ACU({ id: 'acu-optimization-overlay-cancel', label: '取消优化', variant: 'ghost' })}
        </div>
      </div>
    `;
    
    ensureHostDialogStylesInjected_ACU();
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
      escapeHtml: false,
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
