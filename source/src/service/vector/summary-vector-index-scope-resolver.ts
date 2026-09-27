/**
 * 纪要向量 scope 的**当前运行态**解析。
 *
 * 单独成叶模块的原因：storage-service / chat-service / cache-service 都要按同一口径
 * 解析「当前 scope」，而它们能引用的既有模块（archive-service、flush-queue）都反向
 * 依赖 storage-service，直接 import 会形成环。本模块只依赖 state-manager 与 shared，
 * 因此三方都能安全引用，也保证 scopeKey 口径与 flush 队列完全一致。
 */
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { isSummaryOrOutlineTable_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU, type SummaryVectorIndexCanonicalScope_ACU } from '../../shared/summary-vector-index-scope';

export interface SummaryTableSelection_ACU {
    summaryKey: string;
    table: any;
}

function normalizeText_ACU(value: any): string {
    return String(value ?? '').trim();
}

/**
 * 定位当前（或指定的）纪要表。archive-service 的 findSummaryTable_ACU 委托到这里，
 * 保证「纪要表是哪张」在全仓只有一份实现——两处判定漂移会让墓碑写到错误 scopeKey 上。
 */
export function findSummaryTableSelection_ACU(sourceTableKey?: string): SummaryTableSelection_ACU | null {
    if (!currentJsonTableData_ACU || typeof currentJsonTableData_ACU !== 'object') {
        return null;
    }

    const requestedKey = normalizeText_ACU(sourceTableKey);
    const candidateKeys = requestedKey ? [requestedKey] : Object.keys(currentJsonTableData_ACU);
    const summaryKey = candidateKeys.find((key) => {
        const table = currentJsonTableData_ACU[key];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
    });

    if (!summaryKey) return null;
    const table = currentJsonTableData_ACU[summaryKey];
    if (!table || !Array.isArray(table.content)) return null;

    return {
        summaryKey,
        table,
    };
}

/**
 * 解析当前运行态的纪要向量 scope。无当前聊天标识或无可用纪要表时返回 null——
 * 调用方必须据此按「无当前 scope」处理（统计按 0、清理放弃删除），
 * 不得回退成无 scope 的全库口径。
 */
export function resolveCurrentSummaryVectorScopeParts_ACU(): SummaryVectorIndexCanonicalScope_ACU | null {
    const chatKey = normalizeText_ACU(currentChatFileIdentifier_ACU);
    const sourceTableKey = normalizeText_ACU(findSummaryTableSelection_ACU()?.summaryKey);
    if (!chatKey || !sourceTableKey) return null;
    return normalizeSummaryVectorIndexScope_ACU({
        chatKey,
        isolationKey: getCurrentIsolationKey_ACU(),
        sourceTableKey,
    });
}
