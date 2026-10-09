/**
 * presentation/components/optimization-ui/optimization-ui-diff.ts
 * 优化 Diff 对话框
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
  escapeHtml_ACU
} from '../../../shared/html-helpers';
import {
  ensureHostDialogStylesInjected_ACU,
  renderOptimizationReviewDialog_ACU
} from '../../theme/host-dialog';
import {
  logDebug_ACU
} from '../../../shared/utils';

import {
  _set_optimizationProgressToast_ACU,
  _set_contentOptimizationAbortRequested_ACU
} from '../../../service/optimization/content-optimization';


import {
  CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU,
  isChatMessageWriteTargetCurrent_ACU
} from '../../../service/chat/chat-message-write-target';

// 循环 import — 运行时安全
import {
  getOriginalContent_ACU,
  reoptimizeMessage_ACU,
  replaceChatMessage_ACU
} from './optimization-ui-exec';

  export function showOptimizationDiffDialogForLoop_ACU(messageIndex: number, result: any, callback: Function) {
    const isLastLoop = result.currentLoop >= result.totalLoops;
    const applyButtonText = isLastLoop ? '应用并完成' : '应用并继续';
    const originalContent = getOriginalContent_ACU(messageIndex) || result.optimizedContent;
    
    const dialogHtml = renderOptimizationReviewDialog_ACU({
      title: '正文替换建议',
      summaryHtml: escapeHtml_ACU(String(result.summary || '')),
      meta: result.totalLoops > 1 ? `第 ${result.currentLoop}/${result.totalLoops} 轮` : undefined,
      optimizations: result.optimizations,
      buttons: [
        { id: 'acu-opt-cancel', label: '取消优化', variant: 'ghost' },
        ...(!isLastLoop ? [{ id: 'acu-opt-skip', label: '跳过本轮', variant: 'ghost' as const }] : []),
        { id: 'acu-opt-reoptimize', label: '重新优化', variant: 'soft', icon: 'fa-solid fa-rotate-right' },
        { id: 'acu-opt-apply', label: applyButtonText, variant: 'primary' },
      ],
    });
    
    ensureHostDialogStylesInjected_ACU();
    jQuery_API_ACU('body').append(dialogHtml);
    
    // 绑定取消事件
    jQuery_API_ACU('#acu-opt-cancel, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('cancel');
    });
    
    // 绑定跳过事件（仅非最后一轮显示）
    jQuery_API_ACU('#acu-opt-skip').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('skip');
    });
    
    // 绑定重新优化事件
    jQuery_API_ACU('#acu-opt-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      
      // 关闭当前对话框
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      
      // 获取原始内容并重新优化
      const originalContent = getOriginalContent_ACU(messageIndex) || result.optimizedContent;
      
      logDebug_ACU(`[正文优化] 用户点击重新优化，messageIndex=${messageIndex}`);
      
      // 重新优化
      await reoptimizeMessage_ACU(messageIndex);
      
      // 触发回调，结束当前优化流程
      callback('cancel');
    });
    
    // 绑定应用事件
    jQuery_API_ACU('#acu-opt-apply').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('处理中...');
      
      logDebug_ACU(`[正文优化] 用户点击应用，isLastLoop=${isLastLoop}, messageIndex=${messageIndex}`);
      logDebug_ACU(`[正文优化] optimizedContent长度: ${result.optimizedContent?.length || 0}`);
      
      // 如果是最后一轮，先应用优化
      if (isLastLoop) {
        logDebug_ACU(`[正文优化] 准备调用 replaceChatMessage_ACU...`);
        const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, {
          originalContent: getOriginalContent_ACU(messageIndex) || originalContent,
          expected: result.writeTarget,
        });
        logDebug_ACU(`[正文优化] replaceChatMessage_ACU 返回: ${success}`);
        // R9-01：对话框打开期间楼层被滑动/删除或聊天已切换：结果作废，关闭对话框并结束本次优化。
        if (!success && result.writeTarget !== undefined && !isChatMessageWriteTargetCurrent_ACU(result.writeTarget)) {
          jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
          showToastr_ACU('warning', CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU);
          callback('cancel');
          return;
        }
        if (!success) {
          jQuery_API_ACU(this).prop('disabled', false).text(applyButtonText);
          showToastr_ACU('error', '应用失败');
          return;
        }
      } else {
        logDebug_ACU(`[正文优化] 非最后一轮，跳过应用，直接回调`);
      }
      
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('apply');
    });
  }
  
  /**
   * 自动链只读结果对话框：内容已由自动流程写回，这里只展示对比（原文/修改方案/优化），
   * 不提供「应用」按钮。用于 showDiff 开启 + 非无感模式的自动替换收尾；
   * DOM 对话框不受静默提示框拦截。
   */
  export function showOptimizationResultDialog_ACU(messageIndex: number, result: any) {
    const optimizations = Array.isArray(result?.optimizations) ? result.optimizations : [];
    const dialogHtml = renderOptimizationReviewDialog_ACU({
      title: '正文替换完成',
      icon: 'fa-solid fa-circle-check',
      summaryHtml: `共 ${optimizations.length} 处改进${result?.summary ? `，${escapeHtml_ACU(String(result.summary))}` : ''}`,
      optimizations,
      buttons: [
        { id: 'acu-opt-result-reoptimize', label: '重新优化', variant: 'soft', icon: 'fa-solid fa-rotate-right' },
        { id: 'acu-opt-result-close', label: '关闭', variant: 'primary' },
      ],
    });

    jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
    ensureHostDialogStylesInjected_ACU();
    jQuery_API_ACU('body').append(dialogHtml);

    jQuery_API_ACU('#acu-opt-result-close, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
    });

    jQuery_API_ACU('#acu-opt-result-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      logDebug_ACU(`[正文优化] 结果对话框点击重新优化，messageIndex=${messageIndex}`);
      await reoptimizeMessage_ACU(messageIndex);
    });
  }

  /**
   * HTML转义
   */

  // === 以下为 presentation 层独有的 UI 函数（DOM 操作/渲染）===

