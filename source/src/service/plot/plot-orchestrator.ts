/**
 * service/plot/plot-orchestrator.ts — 剧情推进编排逻辑（service 层：纯业务决策）
 * 从 presentation/bootstrap/init.ts 的 GENERATION_AFTER_COMMANDS 回调提取。
 * 
 * 负责：判断是否应该进行剧情规划、调用规划逻辑、返回规划结果。
 * 不负责：写回消息、清空输入框、停止生成等 UI 操作。
 */

import {
  _set_isProcessing_Plot_ACU
} from '../runtime/state-manager';
import {
  logDebug_ACU,
  logError_ACU,
  hashUserInput_ACU
} from '../../shared/utils';

// ============================================================
// 类型定义
// ============================================================

export interface PlotOrchestrationResult {
    /** 规划后的最终消息文本 */
    finalMessage: string | null;
    /** 是否被跳过（重复触发） */
    skipped: boolean;
    /** 是否被用户中止 */
    aborted: boolean;
    /** 是否是手动中止 */
    manual: boolean;
    /** 需要恢复的文本（中止时） */
    restoreText?: string;
    /** 原始输入的哈希 */
    originalInputHash?: string;
}

// ============================================================
// 核心业务函数
// ============================================================

/**
 * 为策略1（已有用户消息）准备规划上下文
 * 纯业务逻辑
 */
export function prepareStrategy1Context_ACU(lastMessage: any): {
    messageToProcess: string;
    originalInputHash: string;
} | null {
    if (!lastMessage || !lastMessage.is_user || lastMessage._plot_processed) {
        return null;
    }

    const messageToProcess = lastMessage.mes;
    if (!messageToProcess || !messageToProcess.trim()) {
        return null;
    }

    lastMessage._plot_processed = true;
    const originalInputHash = hashUserInput_ACU(messageToProcess);
    lastMessage._qrf_plot_pending_hash = originalInputHash;
    logDebug_ACU('[剧情推进] [Plot] 在消息对象上保存原始输入哈希:', originalInputHash);

    return { messageToProcess, originalInputHash };
}

// ============================================================
// 编排函数类型定义
// ============================================================

/**
 * 规划函数类型：由 presentation 层传入，负责调用 AI 规划并处理 UI 反馈（toast、中止按钮等）
 * 返回值与 runOptimizationLogicWithUI_ACU 兼容
 */
export type PlanningFn = (userMessage: string, options: any) => Promise<string | null | { skipped?: boolean; aborted?: boolean; manual?: boolean; restoreText?: string }>;

/**
 * GENERATION_AFTER_COMMANDS 策略1编排结果
 */
export interface Strategy1Result {
    /** 'no_match' = 不匹配策略1, 'planned' = 规划成功, 'aborted' = 用户中止, 'skipped' = 跳过 */
    action: 'no_match' | 'planned' | 'aborted' | 'skipped';
    /** 规划后的最终消息 */
    finalMessage?: string;
    /** 是否是手动中止（需要停止生成、删除消息、恢复输入框） */
    manual?: boolean;
    /** 需要恢复的文本 */
    restoreText?: string;
    /** 原始用户消息（用于比对和恢复） */
    originalMessage?: string;
    /** 最后一条消息的索引 */
    lastMessageIndex?: number;
}

/**
 * GENERATION_AFTER_COMMANDS 策略2编排结果
 */
export interface Strategy2Result {
    /** 'skip' = 不处理, 'planned' = 规划成功, 'aborted' = 用户中止 */
    action: 'skip' | 'planned' | 'aborted';
    /** 规划后的最终消息 */
    finalMessage?: string;
    /** 是否是手动中止 */
    manual?: boolean;
}

// ============================================================
// GENERATION_AFTER_COMMANDS 策略1编排
// ============================================================

/**
 * 策略1：处理已存在的用户消息（/send 等命令先创建消息再触发生成）
 * 
 * 职责：准备上下文 → 调用规划 → 判断结果 → 返回结果
 * 不负责：写回 params.prompt、更新消息、清空输入框、停止生成、删除消息（这些由 presentation 层做）
 */
export async function orchestrateAfterCommandsStrategy1_ACU(
    lastMessage: any,
    lastMessageIndex: number,
    runPlanning: PlanningFn
): Promise<Strategy1Result> {
    // 1. 准备策略1上下文
    const context = prepareStrategy1Context_ACU(lastMessage);
    if (!context) {
        return { action: 'no_match' };
    }

    const { messageToProcess, originalInputHash } = context;

    // 2. 调用规划
    _set_isProcessing_Plot_ACU(true);
    try {
        const finalMessage = await runPlanning(messageToProcess, {
            originalUserInput: messageToProcess,
            hasExistingUserMessage: true,
        });

        // 3. 处理跳过
        if (finalMessage && (finalMessage as any).skipped) {
            logDebug_ACU('[剧情推进] Planning skipped in Strategy 1 (duplicate).');
            return { action: 'skipped' };
        }

        // 4. 处理中止
        if (finalMessage && (finalMessage as any).aborted) {
            logDebug_ACU('[剧情推进] Generation aborted by user in Strategy 1.');
            return {
                action: 'aborted',
                manual: (finalMessage as any).manual,
                restoreText: (finalMessage as any).restoreText ?? messageToProcess,
                originalMessage: messageToProcess,
                lastMessageIndex,
            };
        }

        // 5. 规划成功
        if (finalMessage && typeof finalMessage === 'string') {
            return {
                action: 'planned',
                finalMessage,
                originalMessage: messageToProcess,
                lastMessageIndex,
            };
        }

        // 6. 规划返回 null
        return { action: 'no_match' };
    } catch (error) {
        logError_ACU('[剧情推进] Error processing last chat message:', error);
        delete lastMessage._plot_processed;
        return { action: 'no_match' };
    } finally {
        _set_isProcessing_Plot_ACU(false);
    }
}

// ============================================================
// GENERATION_AFTER_COMMANDS 策略2编排
// ============================================================

/**
 * 策略2：处理输入框中的文本（正常发送路径，用户楼层还未写入 chat）
 * 
 * 职责：调用规划 → 返回结果
 * 不负责：读取/写回输入框、停止生成（这些由 presentation 层做）
 */
export async function orchestrateAfterCommandsStrategy2_ACU(
    textInBox: string,
    runPlanning: PlanningFn
): Promise<Strategy2Result> {
    if (!textInBox || !String(textInBox).trim()) {
        return { action: 'skip' };
    }

    const originalInputText = String(textInBox);

    _set_isProcessing_Plot_ACU(true);
    try {
        const finalMessage = await runPlanning(originalInputText, {
            originalUserInput: originalInputText,
            hasExistingUserMessage: false,
        });

        // 处理跳过
        if (finalMessage && (finalMessage as any).skipped) {
            logDebug_ACU('[剧情推进] Planning skipped in Strategy 2 (duplicate).');
            return { action: 'skip' };
        }

        // 处理中止
        if (finalMessage && (finalMessage as any).aborted) {
            logDebug_ACU('[剧情推进] Generation aborted by user in Strategy 2.');
            return { action: 'aborted', manual: (finalMessage as any).manual };
        }

        // 规划成功
        if (finalMessage && typeof finalMessage === 'string') {
            return { action: 'planned', finalMessage };
        }

        return { action: 'skip' };
    } catch (error) {
        logError_ACU('[剧情推进] Error processing textarea input (Strategy 2):', error);
        return { action: 'skip' };
    } finally {
        _set_isProcessing_Plot_ACU(false);
        // 消费掉本次发送意图，避免同一次生成链路重复触发
        // 注意：generationGate 的重置由 presentation 层负责（因为它涉及 UI 状态）
    }
}
