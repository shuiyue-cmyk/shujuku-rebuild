/**
 * presentation/components/optimization-ui/optimization-ui-diff.ts
 * 优化 Diff 对话框
 */

import {
  showHostSurfaceToast_ACU,
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
  CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU,
  captureChatMessageWriteTarget_ACU,
  isChatMessageWriteTargetCurrent_ACU,
  type ChatMessageWriteTarget_ACU
} from '../../../service/chat/chat-message-write-target';
import {
  getChatArray_ACU
} from '../../../data/gateways/chat-gateway';
import {
  currentChatFileIdentifier_ACU
} from '../../../service/runtime/state-manager';

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
   *
   * G01-01：writeTarget 仅由「查看对比」toast 的延迟入口传入（toast 出现时同步捕获的楼层身份快照）；
   * 非无感模式的同步入口不传——模态遮罩挡住聊天操作，楼号无法位移。「重新优化」前按快照复核身份。
   */
  export function showOptimizationResultDialog_ACU(messageIndex: number, result: any, writeTarget?: ChatMessageWriteTarget_ACU) {
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
      let targetIndex = messageIndex;
      // G01-01：toast 是 8 秒非模态提示，「查看对比」点开本框期间可能已删楼/切聊天，裸楼号会指错楼层
      // 甚至指到另一个聊天。按快照的 message_id 重定位并复核聊天身份；找不到或不一致即放弃重新优化。
      if (writeTarget) {
        targetIndex = relocateResultDialogTargetIndex_ACU(writeTarget);
        if (targetIndex < 0) {
          jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
          showToastr_ACU('warning', OPTIMIZATION_RESULT_TARGET_CHANGED_MESSAGE_ACU);
          return;
        }
      }
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      logDebug_ACU(`[正文优化] 结果对话框点击重新优化，messageIndex=${targetIndex}`);
      await reoptimizeMessage_ACU(targetIndex);
    });
  }

  /** 「重新优化」前目标楼层身份复核不通过时的提示（G01-01）。 */
  export const OPTIMIZATION_RESULT_TARGET_CHANGED_MESSAGE_ACU = '楼层已变化（被删除或已切换聊天），本次「重新优化」已取消。';

  /**
   * G01-01：按 toast 出现时捕获的快照重定位目标楼层（同 getLastOptimizedMessageIndex_ACU 的思路）：
   * 聊天已切换直接拒绝；有 message_id 按 id 找当前位置（上方删楼导致位移时仍能找对）；
   * 找不到（楼层已删）或没有 id 且原对象已不在原下标时返回 -1，由调用方提示「楼层已变化」并放弃。
   */
  function relocateResultDialogTargetIndex_ACU(target: ChatMessageWriteTarget_ACU): number {
    if (String(currentChatFileIdentifier_ACU || '') !== target.chatIdentity) return -1;
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat)) return -1;
    if (target.messageId != null) {
      return chat.findIndex((message: any) => !!message && message.message_id === target.messageId);
    }
    const at = chat[target.messageIndex];
    return at && at === target.message ? target.messageIndex : -1;
  }

  /**
   * 无感模式 + 显示优化对比的完成提示：内容已写回，不弹模态框打扰，提示里给「查看对比」入口，
   * 点开即只读结果对话框。用户主动开了对比，所以不受静默提示框拦截。
   */
  export function showOptimizationResultToast_ACU(messageIndex: number, result: any, text: string) {
    // G01-01：提示出现的此刻（写回刚收尾）同步捕获楼层身份快照，随「查看对比」交给结果对话框复核；
    // 捕获不到说明楼层已不在（理论不可达），退回普通完成提示，不给无法复核的延迟入口。
    const writeTarget = captureChatMessageWriteTarget_ACU(messageIndex);
    if (!writeTarget) {
      showToastr_ACU('success', text);
      return;
    }
    showHostSurfaceToast_ACU({
      kind: 'success',
      text,
      action: {
        label: '查看对比',
        onClick: () => showOptimizationResultDialog_ACU(messageIndex, result, writeTarget),
      },
    });
  }

  /**
   * HTML转义
   */

  // === 以下为 presentation 层独有的 UI 函数（DOM 操作/渲染）===

