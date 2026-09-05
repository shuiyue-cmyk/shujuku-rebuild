/**
 * service/table/auto-fill-echo-guard.ts — 自动填表「此楼已自动填过」回声防重
 *
 * 背景：外部 MVU 插件的非静默 generate 收尾会让宿主对本楼多派发一条 GENERATION_ENDED，
 * state-manager 的门控对「无配对上下文」的 ended 一律放行，于是自动填表链被再拉一次。
 * 现有 in-flight 锁只防并发（锁未释放时合并成一次补跑），锁释放后的回声不受它约束。
 *
 * 与正文替换链的判重（content-optimization 的 shouldSkipDuplicateAutoContentOptimization_ACU）
 * 刻意不同：**这里不比对楼层内容指纹**。自动填表成功后，同一楼仍可能被正文替换链改写内容，
 * 拿内容当基准会被自家改动误判成「新内容」，反而再烧一次填表 AI；填表要防的是同一条楼层的
 * 事件回声，所以判重键只取 messageId（外加 chatKey 兜底跨聊天重号）。
 *
 * 记录集合与正文替换链分键分集合（见 optimization-cache-storage 的 auto_table_fill 链），
 * 两条链的完成时机与基准不同，绝不互相污染。
 *
 * 失败姿态：任何存储/环境异常一律 fail-open（放行填表），宁可多跑一次也不静默漏填。
 */

import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import {
    findAutoTableFillProcessedEntry_ACU,
    recordAutoTableFillProcessed_ACU,
} from '../../data/storage/optimization-cache-storage';
import { logDebug_ACU } from '../../shared/utils';

export interface AutoFillFloor_ACU {
    messageIndex: number;
    messageId: any;
}

/**
 * 取当前聊天里最新的 AI 楼层——自动填表触发身份就落在这一楼上。
 * 拿不到（空聊天 / 无 AI 楼 / message_id 缺失）时返回 null，调用方据此放行。
 */
export function resolveLatestAiFloor_ACU(chat: any): AutoFillFloor_ACU | null {
    const list = Array.isArray(chat) ? chat : [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
        const message = list[index];
        if (!message || message.is_user) continue;
        return { messageIndex: index, messageId: message.message_id ?? null };
    }
    return null;
}

/**
 * 该楼是否已经成功自动填过表（同一 messageId 的回声触发）。
 * 填表链只看 messageId：内容被别的链改写不构成「需要重填」的信号。
 */
export function shouldSkipDuplicateAutoTableFill_ACU(floor: AutoFillFloor_ACU | null): boolean {
    const messageId = floor?.messageId;
    if (messageId === null || messageId === undefined) return false;

    try {
        const entry = findAutoTableFillProcessedEntry_ACU(
            messageId,
            String(currentChatFileIdentifier_ACU ?? ''),
        );
        return !!entry;
    } catch (error) {
        logDebug_ACU('[自动填表] 读取自动填表已处理集合失败，按放行处理:', error);
        return false;
    }
}

/**
 * 自动填表成功提交后登记该 messageId「已自动填表」。
 * @returns 登记的条目；拿不到 messageId 时返回 null（不登记）。
 */
export function recordAutoTableFillProcessedForFloor_ACU(floor: AutoFillFloor_ACU | null) {
    const messageId = floor?.messageId;
    if (messageId === null || messageId === undefined) return null;

    try {
        return recordAutoTableFillProcessed_ACU({
            messageId,
            messageIndex: Number.isInteger(floor?.messageIndex) ? floor!.messageIndex : -1,
            chatKey: String(currentChatFileIdentifier_ACU ?? ''),
            updatedAt: Date.now(),
        });
    } catch (error) {
        logDebug_ACU('[自动填表] 登记自动填表已处理记录失败:', error);
        return null;
    }
}
