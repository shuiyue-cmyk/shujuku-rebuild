/**
 * presentation/components/optimization-ui/optimization-ui-exec.ts
 * 优化执行逻辑
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
  getChatArray_ACU,
  replaceChatMessage_ACU,
  getOriginalContent_ACU
} from '../../../service/chat/chat-service';
// re-export 从 service 层搬迁的业务逻辑函数，保持外部调用方兼容
export { replaceChatMessage_ACU, getOriginalContent_ACU } from '../../../service/chat/chat-service';
import {
  CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU,
  captureChatMessageWriteTarget_ACU,
  isChatMessageWriteTargetCurrent_ACU,
  type ChatMessageWriteTarget_ACU
} from '../../../service/chat/chat-message-write-target';
import {
  jQuery_API_ACU
} from '../../dom-utils';

import {
  settings_ACU
} from '../../../service/runtime/state-manager';



import {
  escapeHtml_ACU
} from '../../../shared/html-helpers';
import {
  ensureHostDialogStylesInjected_ACU,
  renderOptimizationReviewDialog_ACU
} from '../../theme/host-dialog';
import {
  logDebug_ACU,
  logError_ACU
} from '../../../shared/utils';
import {
  triggerAutomaticUpdateIfNeeded_ACU
} from '../../triggers/settings-ui-sync';
import {
  contentOptimizationAbortRequested_ACU,
  ensureOptimizationNotCancelled_ACU,
  performContentOptimization_ACU,
  setLastOptimizationBase_ACU,
  shouldSkipDuplicateAutoContentOptimization_ACU,
  recordAutoContentOptimizationProcessed_ACU,
  _set_optimizationProgressToast_ACU,
  _set_contentOptimizationAbortRequested_ACU
} from '../../../service/optimization/content-optimization';
import {
  applyContextTagFilters_ACU
} from '../../../service/runtime/helpers-remaining';

import {
  showOptimizationOverlay_ACU,
  hideOptimizationOverlay_ACU,
  showOptimizationProgressToast_ACU,
  hideOptimizationProgressToast_ACU
} from './optimization-ui-overlay';
// 循环 import — 运行时安全
import {
  showOptimizationDiffDialogForLoop_ACU,
  showOptimizationResultDialog_ACU,
  showOptimizationResultToast_ACU
} from './optimization-ui-diff';

  // replaceChatMessage_ACU 和 getOriginalContent_ACU 已搬迁到 service/chat/chat-service.ts
  // 通过文件顶部的 re-export 保持外部调用方兼容

  /**
   * 重新优化消息
   * @param {number} messageIndex - 消息索引
   * @returns {Promise<boolean>} 是否成功
   */
  export async function reoptimizeMessage_ACU(messageIndex: number) {
    const config = settings_ACU.contentOptimizationSettings || {};
    _set_contentOptimizationAbortRequested_ACU(false);
    
    // 检查是否启用
    if (!config.enabled) {
      showToastr_ACU('warning', '正文优化功能未启用');
      return false;
    }
    
    const chat = getChatArray_ACU();
    if (!chat || !chat[messageIndex]) {
      showToastr_ACU('error', '消息不存在');
      return false;
    }
    
    const message = chat[messageIndex];
    
    // 跳过用户消息
    if (message.is_user) {
      showToastr_ACU('warning', '无法优化用户消息');
      return false;
    }
    
    // 获取原始内容
    const originalContent = getOriginalContent_ACU(messageIndex) || message.mes;
    // R9-01：AI 在途与对话框打开期间楼层可能被滑动、删除或切聊天；应用前按此快照复核。
    const writeTarget = captureChatMessageWriteTarget_ACU(messageIndex);
    
    if (!originalContent) {
      showToastr_ACU('error', '无法获取消息内容');
      return false;
    }
    
    logDebug_ACU(`[重新优化] 开始重新优化消息 ${messageIndex}，内容长度: ${originalContent.length}`);
    
    if (config.seamlessMode) {
      showOptimizationOverlay_ACU('正在重新优化正文...');
    } else {
      showOptimizationProgressToast_ACU('正在进行正文优化（重新优化）...');
    }
    
    try {
      ensureOptimizationNotCancelled_ACU();
      const result = await performContentOptimization_ACU(originalContent, {
        currentLoop: 1,
        userMessage: ''
      });
      
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      
      if (contentOptimizationAbortRequested_ACU) {
        return false;
      }

      if (!result.success) {
        showToastr_ACU('error', `重新优化失败: ${result.error || '未知错误'}`);
        return false;
      }
      
      if (!result.optimizations || result.optimizations.length === 0) {
        showToastr_ACU('info', '原文已足够好，无需优化');
        return true;
      }
      
      showReoptimizationDialog_ACU(messageIndex, result, originalContent, writeTarget);
      return true;
      
    } catch (error) {
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      if (contentOptimizationAbortRequested_ACU || error?.message === '用户终止正文优化') {
        logDebug_ACU('[重新优化] 用户已取消正文优化');
        return false;
      }
      logError_ACU('[重新优化] 执行出错:', error);
      showToastr_ACU('error', `重新优化失败: ${error.message}`);
      return false;
    } finally {
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      _set_contentOptimizationAbortRequested_ACU(false);
    }
  }
  
  /**
   * 显示重新优化对话框
   * @param {number} messageIndex - 消息索引
   * @param {object} result - 优化结果
   * @param {string} originalContent - 原始内容
   */
  function showReoptimizationDialog_ACU(messageIndex: number, result: any, originalContent: string, writeTarget: ChatMessageWriteTarget_ACU | null) {
    const dialogHtml = renderOptimizationReviewDialog_ACU({
      title: '重新优化结果',
      icon: 'fa-solid fa-rotate-right',
      summaryHtml: escapeHtml_ACU(String(result.summary || '')),
      optimizations: result.optimizations,
      buttons: [
        { id: 'acu-opt-cancel', label: '取消', variant: 'ghost' },
        { id: 'acu-opt-reoptimize', label: '再次优化', variant: 'soft', icon: 'fa-solid fa-rotate-right' },
        { id: 'acu-opt-apply', label: '应用优化', variant: 'primary' },
      ],
    });
    
    ensureHostDialogStylesInjected_ACU();
    jQuery_API_ACU('body').append(dialogHtml);
    
    // 绑定取消事件
    jQuery_API_ACU('#acu-opt-cancel, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
    });
    
    // 绑定再次优化事件
    jQuery_API_ACU('#acu-opt-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      
      // 关闭当前对话框
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      
      // 重新优化（使用原始内容）
      await reoptimizeMessage_ACU(messageIndex);
    });
    
    // 绑定应用事件
    jQuery_API_ACU('#acu-opt-apply').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('应用中...');
      
      const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, {
        originalContent: getOriginalContent_ACU(messageIndex) || originalContent,
        expected: writeTarget,
      });

      if (success) {
        jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
        showToastr_ACU('success', '优化已应用');
      } else if (!isChatMessageWriteTargetCurrent_ACU(writeTarget)) {
        jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
        showToastr_ACU('warning', CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU);
      } else {
        jQuery_API_ACU(this).prop('disabled', false).text('应用优化');
        showToastr_ACU('error', '应用失败');
      }
    });
  }
  
  /** 写回被拒或失败时的提示：楼层已变化与写入出错分开说明（R9-01）。 */
  function reportOptimizationWriteBackFailure_ACU(writeTarget: ChatMessageWriteTarget_ACU | null) {
    if (!isChatMessageWriteTargetCurrent_ACU(writeTarget)) {
      showToastr_ACU('warning', CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU);
    } else {
      showToastr_ACU('error', '正文优化结果写回失败，原文未改动，详情见运行日志。');
    }
  }

  /**
   * 自动替换成功写回后登记「已处理」指纹，供下一次自动触发判重。
   * 指纹取写回后聊天数组里该楼的实际正文，避免宿主二次渲染导致内容漂移而漏判。
   * @param {number} messageIndex - 已写回的消息索引
   * @param {string} fallbackContent - 读不到实时内容时兜底使用的写回内容
   */
  function recordAutoProcessedAfterWriteBack_ACU(messageIndex: number, fallbackContent: string) {
    try {
      const liveMessage = getChatArray_ACU()?.[messageIndex];
      const liveContent = typeof liveMessage?.mes === 'string' && liveMessage.mes ? liveMessage.mes : fallbackContent;
      const recorded = recordAutoContentOptimizationProcessed_ACU({
        messageIndex,
        messageId: liveMessage?.message_id ?? null,
        content: liveContent
      });
      if (recorded) {
        logDebug_ACU(`[正文优化] 已登记第 ${messageIndex} 楼的自动替换指纹，用于后续重复触发判重`);
      }
    } catch (error) {
      logDebug_ACU('[正文优化] 登记自动替换已处理记录失败:', error);
    }
  }
  
  /**
   * 执行正文优化流程（在GENERATION_ENDED后调用）
   * @param {number} messageIndex - AI消息索引
   * @returns {Promise<boolean>} 是否成功
   */
  export async function executeContentOptimization_ACU(messageIndex: number) {
    const config = settings_ACU.contentOptimizationSettings || {};
    _set_contentOptimizationAbortRequested_ACU(false);
    
    // 检查是否启用
    if (!config.enabled) {
      return false;
    }
    
    const chat = getChatArray_ACU();
    if (!chat || !chat[messageIndex]) {
      return false;
    }
    
    const message = chat[messageIndex];
    
    // 跳过用户消息
    if (message.is_user) {
      return false;
    }
    
    let content = message.mes || '';
    
    // [自动链判重] 宿主可能对本楼再派发一条无配对上下文的 GENERATION_ENDED（典型来源：外部 MVU
    // 插件非静默 generate 收尾时 hideStopButton 的第二次 emit）。内容未变说明上一次自动替换已生效，
    // 直接跳过：不调 AI、不写回，也不覆盖优化基准缓存。手动「重新优化」/测试入口不经过本函数，不受影响。
    if (shouldSkipDuplicateAutoContentOptimization_ACU(message.message_id, content)) {
      logDebug_ACU(`[正文优化] 第 ${messageIndex} 楼内容未变，跳过重复自动替换`);
      return true;
    }
    
    setLastOptimizationBase_ACU({
      messageIndex,
      messageId: message.message_id,
      baseContent: content
    });
    // R9-01：AI 在途期间楼层可能被滑动、删除或切聊天；写回前按此快照复核，不按下标盲写。
    const writeTarget = captureChatMessageWriteTarget_ACU(messageIndex);

    // [新增] 获取用户消息（用于$8占位符）
    let userMessage = '';
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (chat[i] && chat[i].is_user) {
        userMessage = chat[i].mes || '';
        break;
      }
    }
    
    const extractTags = (config.extractTags || '').trim();
    const extractRules = config.extractRules || [];
    const excludeTags = (config.excludeTags || '').trim();
    const excludeRules = config.excludeRules || [];
    
    let processedContent = applyContextTagFilters_ACU(content, {
      extractTags,
      extractRules,
      excludeTags,
      excludeRules
    });
    
    const minLength = config.minLength || 100;
    if (processedContent.length < minLength) {
      logDebug_ACU(`[正文优化] 处理后正文长度 ${processedContent.length} 小于最小阈值 ${minLength}，跳过优化`);
      return false;
    }
    
    const loopCount = config.loopCount || 1;
    logDebug_ACU(`[正文优化] 开始优化消息 ${messageIndex}，原始长度 ${content.length}，处理后长度 ${processedContent.length}，循环次数: ${loopCount}`);
    
    if (config.seamlessMode) {
      showOptimizationOverlay_ACU(loopCount > 1 ? `正在优化正文 (1/${loopCount})...` : '正在优化正文...');
    } else {
      showOptimizationProgressToast_ACU(loopCount > 1 ? `正在进行正文优化 (1/${loopCount})...` : '正在进行正文优化...');
    }
    
    try {
      ensureOptimizationNotCancelled_ACU();
      if (config.autoApply || config.seamlessMode) {
        let currentContent = content;
        let totalOptimizations: any[] = [];
        let finalOptimizedContent = content;
        
        for (let loop = 1; loop <= loopCount; loop++) {
          ensureOptimizationNotCancelled_ACU();
          logDebug_ACU(`[正文优化] 执行第 ${loop}/${loopCount} 轮优化`);
          
          if (config.seamlessMode && loopCount > 1) {
            showOptimizationOverlay_ACU(`正在优化正文 (${loop}/${loopCount})...`);
          } else if (!config.seamlessMode) {
            showOptimizationProgressToast_ACU(`正在进行正文优化 (${loop}/${loopCount})...`);
          }
          
          const result = await performContentOptimization_ACU(currentContent, {
            currentLoop: loop,
            userMessage: userMessage
          });
          ensureOptimizationNotCancelled_ACU();
          
          if (!result.success) {
            logDebug_ACU(`[正文优化] 第 ${loop} 轮优化失败:`, result.error);
            if (loop === 1) {
              if (config.seamlessMode) {
                hideOptimizationOverlay_ACU();
              } else {
                hideOptimizationProgressToast_ACU();
              }
              return false;
            }
            break;
          }
          
          if (result.optimizedContent === currentContent) {
            logDebug_ACU(`[正文优化] 第 ${loop} 轮没有实际正文变化，放弃写回`);
            if (totalOptimizations.length === 0) {
              if (config.seamlessMode) {
                hideOptimizationOverlay_ACU();
              } else {
                hideOptimizationProgressToast_ACU();
              }
              return false;
            }
            break;
          }

          if (!result.optimizations || result.optimizations.length === 0) {
            logDebug_ACU(`[正文优化] 第 ${loop} 轮无需优化，原文已足够好`);
            if (loop === 1) {
              if (config.seamlessMode) {
                hideOptimizationOverlay_ACU();
              } else {
                hideOptimizationProgressToast_ACU();
              }
              return true;
            }
            break;
          }
          
          totalOptimizations = totalOptimizations.concat(result.optimizations);
          finalOptimizedContent = result.optimizedContent;
          currentContent = result.optimizedContent;
          
          logDebug_ACU(`[正文优化] 第 ${loop} 轮完成，本轮 ${result.optimizations.length} 个优化项，累计 ${totalOptimizations.length} 个`);
        }
        
        if (totalOptimizations.length === 0) {
          logDebug_ACU('[正文优化] 所有轮次均无需优化');
          if (config.seamlessMode) {
            hideOptimizationOverlay_ACU();
          } else {
            hideOptimizationProgressToast_ACU();
          }
          return true;
        }
        
        const writtenBack = await replaceChatMessage_ACU(messageIndex, finalOptimizedContent, { expected: writeTarget });

        if (config.seamlessMode) {
          hideOptimizationOverlay_ACU();
        } else {
          hideOptimizationProgressToast_ACU();
        }
        if (!writtenBack) {
          reportOptimizationWriteBackFailure_ACU(writeTarget);
          return false;
        }
        recordAutoProcessedAfterWriteBack_ACU(messageIndex, finalOptimizedContent);
        
        const doneText = `正文优化完成，共 ${loopCount} 轮优化，累计 ${totalOptimizations.length} 处改进`;
        const resultForReview = {
          optimizations: totalOptimizations,
          summary: `共 ${loopCount} 轮优化，累计 ${totalOptimizations.length} 处改进`,
          optimizedContent: finalOptimizedContent
        };
        if (config.showDiff && !config.seamlessMode) {
          // 自动链已写回：用只读结果对话框展示对比（原文/修改方案/优化）。
          // 对话框是 DOM 覆盖层，不受静默提示框拦截。
          showOptimizationResultDialog_ACU(messageIndex, resultForReview);
        } else if (config.showDiff) {
          // 无感模式不弹模态框打扰，完成提示带「查看对比」入口；用户开了对比，静默时也照常显示。
          showOptimizationResultToast_ACU(messageIndex, resultForReview, doneText);
        } else {
          showToastr_ACU('success', doneText);
        }
        
        return true;
      } else {
        hideOptimizationProgressToast_ACU();
        return await executeContentOptimizationWithConfirm_ACU(messageIndex, content, userMessage, loopCount, writeTarget);
      }
      
    } catch (error) {
      if (contentOptimizationAbortRequested_ACU || error?.message === '用户终止正文优化') {
        logDebug_ACU('[正文优化] 用户已取消正文优化');
        return false;
      }
      logError_ACU('[正文优化] 执行出错:', error);
      if (config.seamlessMode) {
        hideOptimizationOverlay_ACU();
      } else {
        hideOptimizationProgressToast_ACU();
      }
      return false;
    } finally {
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      _set_contentOptimizationAbortRequested_ACU(false);
    }
  }
  
  /**
   * 执行正文优化（手动确认模式，逐轮确认）
   * @param {number} messageIndex - 消息索引
   * @param {string} content - 原始内容
   * @param {string} userMessage - 用户消息
   * @param {number} totalLoops - 总循环次数
   * @param writeTarget - 读取正文时的楼层快照，写回前复核（R9-01）
   * @param {number} currentLoop - 当前循环次数（内部使用）
   * @param {string} currentContent - 当前内容（内部使用）
   * @param {Array} totalOptimizations - 累计优化项（内部使用）
   * @returns {Promise<boolean>} 是否成功
   */
  async function executeContentOptimizationWithConfirm_ACU(messageIndex: number, content: string, userMessage: string, totalLoops: number, writeTarget: ChatMessageWriteTarget_ACU | null, currentLoop = 1, currentContent: string | null = null, totalOptimizations: any[] = []): Promise<boolean> {
    // 使用传入的当前内容，或者原始内容
    let workingContent = currentContent !== null ? currentContent : content;

    // R9-08：前几轮「应用并继续」只把结果交给下一轮，不写回。后续轮次失败、无需优化或跳过时，
    // 要写回已确认的内容，否则用户确认过的修改会丢失，界面却报成功。填表只触发一次。
    const finishWithConfirmedContent = async (confirmedContent: string, confirmedOptimizations: any[]): Promise<boolean> => {
      if (confirmedOptimizations.length > 0 && confirmedContent !== content) {
        const written = await replaceChatMessage_ACU(messageIndex, confirmedContent, { expected: writeTarget });
        if (written) {
          recordAutoProcessedAfterWriteBack_ACU(messageIndex, confirmedContent);
          showToastr_ACU('success', `正文优化完成，共 ${totalLoops} 轮优化，累计 ${confirmedOptimizations.length} 处改进`);
        } else {
          reportOptimizationWriteBackFailure_ACU(writeTarget);
        }
      } else {
        showToastr_ACU('info', '正文无需优化');
      }
      await triggerAutomaticUpdateIfNeeded_ACU();
      return true;
    };
    
    logDebug_ACU(`[正文优化-手动确认] 执行第 ${currentLoop}/${totalLoops} 轮优化`);
    
    // 执行优化
    const result = await performContentOptimization_ACU(workingContent, {
      currentLoop: currentLoop,
      userMessage: userMessage
    });
    
    if (!result.success) {
      logDebug_ACU(`[正文优化-手动确认] 第 ${currentLoop} 轮优化失败:`, result.error);
      // 如果是第一轮就失败，显示错误
      if (currentLoop === 1) {
        showToastr_ACU('error', `正文优化失败: ${result.error}`);
        return false;
      }
      // 后续轮次失败：写回此前已确认的结果，再触发填表
      return finishWithConfirmedContent(workingContent, totalOptimizations);
    }
    
    // 检查是否有实际优化
    if (!result.optimizations || result.optimizations.length === 0) {
      logDebug_ACU(`[正文优化-手动确认] 第 ${currentLoop} 轮无需优化，原文已足够好`);
      // 如果没有优化项，检查是否还有下一轮
      if (currentLoop < totalLoops) {
        // 继续下一轮（使用当前内容）
        return await executeContentOptimizationWithConfirm_ACU(messageIndex, content, userMessage, totalLoops, writeTarget, currentLoop + 1, workingContent, totalOptimizations);
      } else {
        // 所有轮次完成：写回此前已确认的结果，再触发填表
        return finishWithConfirmedContent(workingContent, totalOptimizations);
      }
    }
    
    // 累积优化项
    const newTotalOptimizations = totalOptimizations.concat(result.optimizations);
    
    // 显示对比对话框
    return new Promise((resolve) => {
      showOptimizationDiffDialogForLoop_ACU(messageIndex, {
        optimizations: result.optimizations,
        summary: `第 ${currentLoop}/${totalLoops} 轮优化，本轮 ${result.optimizations.length} 处改进`,
        optimizedContent: result.optimizedContent,
        currentLoop: currentLoop,
        totalLoops: totalLoops,
        totalOptimizations: newTotalOptimizations,
        writeTarget
      }, async (action: string) => {
        if (action === 'apply') {
          // 用户确认应用
          if (currentLoop < totalLoops) {
            // 还有下一轮，继续优化
            const nextResult = await executeContentOptimizationWithConfirm_ACU(
              messageIndex,
              content,
              userMessage,
              totalLoops,
              writeTarget,
              currentLoop + 1,
              result.optimizedContent,
              newTotalOptimizations
            );
            resolve(nextResult);
          } else {
            // 所有轮次完成：末轮对话框已按快照复核并写回（只写一次），这里登记已处理并触发填表
            recordAutoProcessedAfterWriteBack_ACU(messageIndex, result.optimizedContent);
            showToastr_ACU('success', `正文优化完成，共 ${totalLoops} 轮优化，累计 ${newTotalOptimizations.length} 处改进`);
            await triggerAutomaticUpdateIfNeeded_ACU();
            resolve(true);
          }
        } else if (action === 'skip') {
          // 用户跳过本轮，但继续下一轮
          if (currentLoop < totalLoops) {
            const nextResult = await executeContentOptimizationWithConfirm_ACU(
              messageIndex,
              content,
              userMessage,
              totalLoops,
              writeTarget,
              currentLoop + 1,
              workingContent,  // 使用未优化的内容
              totalOptimizations  // 不累积本轮优化项
            );
            resolve(nextResult);
          } else {
            // 最后一轮跳过：写回此前已确认的结果
            resolve(await finishWithConfirmedContent(workingContent, totalOptimizations));
          }
        } else {
          // 用户取消，结束优化流程
          await triggerAutomaticUpdateIfNeeded_ACU();
          resolve(true);
        }
      });
    });
  }
  
  /**
   * 显示优化对比对话框（支持循环优化）
   */
