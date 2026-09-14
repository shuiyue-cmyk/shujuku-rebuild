/**
 * service/loop/loop-evaluator.ts — 循环标签校验
 * 从 presentation/triggers/auto-loop.ts 的 onLoopGenerationEnded_ACU 中提取
 *
 * 只负责「校验 AI 回复是否带齐循环标签」，不涉及 UI（toast/按钮/文本框）。
 */

import { logDebug_ACU } from '../../shared/utils';

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
