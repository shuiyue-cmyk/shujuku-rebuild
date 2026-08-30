/**
 * service/loop/loop-controller.ts — 循环控制状态机（service 层：纯业务逻辑）
 * 从 presentation/triggers/auto-loop.ts 提取。
 * UI 操作（写输入框、点发送按钮、更新定时器显示）通过回调传入。
 */

import { getChatArray_ACU, deleteLastMessage_ACU } from '../chat/chat-service';
import { loopState_ACU, planningGuard_ACU, settings_ACU } from '../runtime/state-manager';
import { ensureLoopPromptsArray_ACU } from '../plot/plot-logic';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { evaluateLoopGenerationResult_ACU } from './loop-evaluator';
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';

// ============================================================\n// 核心业务函数\n// ============================================================

/**
 * 验证循环启动参数
 * 纯业务逻辑
 * @returns null 表示验证通过，否则返回错误信息
 */
export function validateLoopStartParams_ACU(): string | null {
    const plotSettings = settings_ACU.plotSettings;
    ensureLoopPromptsArray_ACU(plotSettings);
    const loopSettings = plotSettings.loopSettings;
    const loopDuration = (loopSettings.loopTotalDuration || 0) * 60 * 1000;

    if (!loopSettings.quickReplyContent || !Array.isArray(loopSettings.quickReplyContent) || loopSettings.quickReplyContent.length === 0) {
        return '请先添加至少一个循环提示词';
    }

    if (loopDuration <= 0) {
        return '请设置有效的总倒计时 (大于0分钟)';
    }

    return null;
}

/**
 * 初始化循环状态
 * 纯业务逻辑
 */
export function initLoopState_ACU(): { loopDuration: number } {
    const plotSettings = settings_ACU.plotSettings;
    ensureLoopPromptsArray_ACU(plotSettings);
    const loopSettings = plotSettings.loopSettings;
    const loopDuration = (loopSettings.loopTotalDuration || 0) * 60 * 1000;

    loopSettings.currentPromptIndex = 0;
    loopState_ACU.isLooping = true;
    loopState_ACU.isRetrying = false;
    loopState_ACU.startTime = Date.now();
    loopState_ACU.totalDuration = loopDuration;
    loopState_ACU.retryCount = 0;

    logDebug_ACU('[剧情推进] Auto Loop Started. Duration: ' + loopDuration + 'ms');

    return { loopDuration };
}

/**
 * 停止循环状态
 * 纯业务逻辑
 */
export function stopLoopState_ACU(): void {
    loopState_ACU.isLooping = false;
    loopState_ACU.isRetrying = false;
    loopState_ACU.awaitingReply = false;
    if (loopState_ACU.timerId) {
        clearTimeout(loopState_ACU.timerId);
        loopState_ACU.timerId = null;
    }
    if (loopState_ACU.tickInterval) {
        clearInterval(loopState_ACU.tickInterval);
        loopState_ACU.tickInterval = null;
    }
    logDebug_ACU('[剧情推进] Auto Loop Stopped.');
}

/**
 * 获取下一个循环提示词
 * 纯业务逻辑
 * @returns 提示词文本，或 null 表示没有可用提示词
 */
export function getNextLoopPrompt_ACU(): string | null {
    if (!loopState_ACU.isLooping) return null;
    const plotSettings = settings_ACU.plotSettings;
    ensureLoopPromptsArray_ACU(plotSettings);
    const loopSettings = plotSettings.loopSettings;
    const prompts = loopSettings.quickReplyContent || [];

    if (!prompts || prompts.length === 0) {
        logWarn_ACU('[剧情推进] Loop prompts array is empty, stopping loop.');
        return null;
    }

    const currentIndex = loopSettings.currentPromptIndex || 0;
    const quickReplyContent = prompts[currentIndex] || prompts[0];
    if (!quickReplyContent || !quickReplyContent.trim()) {
        logWarn_ACU('[剧情推进] Current prompt is empty, stopping loop.');
        return null;
    }
    loopSettings.currentPromptIndex = (currentIndex + 1) % prompts.length;
    logDebug_ACU(`[剧情推进] 使用提示词 ${currentIndex + 1}/${prompts.length}: ${quickReplyContent.substring(0, 50)}...`);

    loopState_ACU.awaitingReply = true;
    return quickReplyContent;
}

/**
 * 处理重试流程的业务逻辑
 * @returns 是否应该继续重试
 */
export async function handleRetryLogic_ACU(shouldDeleteAiReply: boolean): Promise<boolean> {
    loopState_ACU.isRetrying = true;
    loopState_ACU.retryCount++;
    const loopSettings = settings_ACU.plotSettings.loopSettings || DEFAULT_PLOT_SETTINGS_ACU.loopSettings;
    const maxRetries = loopSettings.maxRetries ?? 3;

    logDebug_ACU(`[剧情推进] 进入重试流程: ${loopState_ACU.retryCount}/${maxRetries}.`);

    if (loopState_ACU.retryCount > maxRetries) {
        return false; // 超过最大重试次数
    }

    if (shouldDeleteAiReply) {
        const chat = getChatArray_ACU();
        const last = chat?.length ? chat[chat.length - 1] : null;
        if (last && !last.is_user) {
            logDebug_ACU('[剧情推进] [重试] 删除缺失标签的AI楼层...');
            try {
                await deleteLastMessage_ACU();
            } catch (e) {
                logError_ACU('[剧情推进] 删除楼层失败:', e);
            }
        } else {
            logDebug_ACU('[剧情推进] [重试] 不需要删除：最新楼层不是AI。');
        }
    }

    return true; // 可以继续重试
}

/**
 * 评估生成结束后的循环状态
 * 纯业务逻辑
 * @returns 动作指令
 */
export async function evaluateLoopEnd_ACU(): Promise<{
    action: 'ignore' | 'continue' | 'retry_delete' | 'retry_no_delete' | 'wait_retry';
    loopDelay?: number;
    retryDelay?: number;
}> {
    if (!loopState_ACU.isLooping) return { action: 'ignore' };
    if (!loopState_ACU.awaitingReply) return { action: 'ignore' };

    await new Promise(resolve => setTimeout(resolve, 1500));
    if (!loopState_ACU.isLooping || !loopState_ACU.awaitingReply) return { action: 'ignore' };

    const loopSettings = settings_ACU.plotSettings.loopSettings || DEFAULT_PLOT_SETTINGS_ACU.loopSettings;
    const chat = getChatArray_ACU();
    if (!chat || chat.length === 0) return { action: 'ignore' };

    const result = evaluateLoopGenerationResult_ACU(chat, loopSettings, planningGuard_ACU);

    if (result.reason.includes('Ignoring planning-triggered')) {
        planningGuard_ACU.ignoreNextGenerationEndedCount--;
    }

    logDebug_ACU(`[剧情推进] [Loop] Evaluation result: action=${result.action}, reason=${result.reason}`);

    const loopDelay = (loopSettings.loopDelay || 5) * 1000;
    const retryDelay = (loopSettings.retryDelay || 3) * 1000;

    switch (result.action) {
        case 'ignore':
            return { action: 'ignore' };

        case 'wait': {
            logWarn_ACU(`[剧情推进] [Loop] ${result.reason}，等待2s后重试检测...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            const updatedChat = getChatArray_ACU();
            const lastMessage = updatedChat?.length ? updatedChat[updatedChat.length - 1] : null;
            if (!lastMessage || lastMessage.is_user) {
                logWarn_ACU('[剧情推进] [Loop] 未找到AI回复楼层，进入重试。');
                loopState_ACU.awaitingReply = false;
                return { action: 'retry_no_delete', retryDelay };
            }
            // 重新评估
            const retryResult = evaluateLoopGenerationResult_ACU(updatedChat, loopSettings, planningGuard_ACU);
            if (retryResult.action === 'continue') {
                loopState_ACU.isRetrying = false;
                loopState_ACU.retryCount = 0;
                loopState_ACU.awaitingReply = false;
                return { action: 'continue', loopDelay };
            } else if (retryResult.action === 'retry_delete') {
                loopState_ACU.awaitingReply = false;
                return { action: 'retry_delete', retryDelay };
            } else {
                loopState_ACU.awaitingReply = false;
                return { action: 'retry_no_delete', retryDelay };
            }
        }

        case 'continue':
            logDebug_ACU('[剧情推进] 标签检测通过。继续循环。');
            loopState_ACU.isRetrying = false;
            loopState_ACU.retryCount = 0;
            loopState_ACU.awaitingReply = false;
            return { action: 'continue', loopDelay };

        case 'retry_delete':
            logDebug_ACU('[剧情推进] 标签检测未通过。进入重试。');
            loopState_ACU.awaitingReply = false;
            return { action: 'retry_delete', retryDelay };

        case 'retry_no_delete':
            loopState_ACU.awaitingReply = false;
            return { action: 'retry_no_delete', retryDelay };

        default:
            return { action: 'ignore' };
    }
}
