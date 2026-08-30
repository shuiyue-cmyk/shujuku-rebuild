/**
 * service/loop/loop-evaluator.ts — 循环生成结果评估核心逻辑
 * 从 presentation/triggers/auto-loop.ts 的 onLoopGenerationEnded_ACU 中提取
 * 
 * 只负责「评估 AI 回复是否满足循环条件」，不涉及 UI（toast/按钮/文本框）。
 */

import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getCurrentCharacterFallback_ACU } from '../host/host-state-service';

export type LoopAction = 'continue' | 'retry_delete' | 'retry_no_delete' | 'ignore' | 'wait';

export interface LoopEvaluationResult {
    action: LoopAction;
    reason: string;
}

/**
 * 验证循环标签是否存在于内容中
 */
export function validateLoopTags_ACU(content: string, tags: string): boolean {
    if (!tags || !tags.trim()) return true;
    const tagList = tags.split(/[,，]/).map((t: string) => t.trim()).filter((t: string) => t);
    if (tagList.length === 0) return true;
    for (const tag of tagList) {
        if (!content.includes(tag)) {
            logDebug_ACU(`[剧情推进] Loop validation failed: missing tag "${tag}"`);
            return false;
        }
    }
    return true;
}

/**
 * 评估循环生成结果，决定下一步动作
 * 
 * @param chat - 当前聊天记录数组
 * @param loopSettings - 循环设置
 * @param planningGuard - 规划守卫状态
 * @returns LoopEvaluationResult 包含 action 和 reason
 */
export function evaluateLoopGenerationResult_ACU(
    chat: any[],
    loopSettings: any,
    planningGuard: { inProgress: boolean; ignoreNextGenerationEndedCount: number }
): LoopEvaluationResult {
    if (!chat || chat.length === 0) {
        return { action: 'ignore', reason: 'Chat is empty' };
    }

    // 检查规划守卫
    if (planningGuard.inProgress) {
        return { action: 'ignore', reason: 'Planning in progress' };
    }
    if (planningGuard.ignoreNextGenerationEndedCount > 0) {
        return { action: 'ignore', reason: `Ignoring planning-triggered event (${planningGuard.ignoreNextGenerationEndedCount} left)` };
    }

    const lastMessage = chat[chat.length - 1];

    // 检查是否是规划层
    if (lastMessage.is_user && lastMessage._qrf_from_planning) {
        return { action: 'wait', reason: 'Detected planning layer, waiting for AI reply' };
    }

    // 最后一条是用户消息（无规划标记）
    if (lastMessage.is_user) {
        return { action: 'wait', reason: 'Last message is user message without planning mark, need to wait' };
    }

    // 检查是否来自当前角色
    const activeChar = getCurrentCharacterFallback_ACU();
    const activeCharName = activeChar?.name;
    if (activeCharName && lastMessage.name && lastMessage.name !== activeCharName) {
        return { action: 'ignore', reason: `AI reply from different character (${lastMessage.name} != ${activeCharName})` };
    }

    // 验证标签
    const tagsOk = validateLoopTags_ACU(lastMessage.mes, loopSettings.loopTags);
    if (tagsOk) {
        return { action: 'continue', reason: 'Tags validation passed' };
    }

    return { action: 'retry_delete', reason: 'Tags validation failed' };
}
