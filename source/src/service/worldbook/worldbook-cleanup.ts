/**
 * service/worldbook/worldbook-cleanup.ts — 世界书条目清理（service 层：纯业务逻辑）
 * 从 presentation/triggers/data-admin-ui.ts 提取。
 */

import { getLorebookEntries_ACU, deleteLorebookEntries_ACU, isWorldbookApiAvailable_ACU } from './worldbook-service';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU } from './injection-engine';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { getImportStablePrefix_ACU } from '../../shared/constants';

function isImportProtectedComment_ACU(comment: unknown, isolationPrefix: string): boolean {
    const importPrefix = getImportStablePrefix_ACU();
    const rawComment = String(comment || '');
    const normalized = isolationPrefix && rawComment.startsWith(isolationPrefix)
        ? rawComment.slice(isolationPrefix.length)
        : rawComment;
    return normalized.startsWith(importPrefix);
}

/**
 * 删除聊天数据后清理世界书中的 Wrapper、PersonsHeader、Memory 条目
 * 纯业务逻辑，不涉及任何 UI 操作
 * @returns 删除的条目总数
 */
export async function cleanupWorldbookEntriesAfterDataDeletion_ACU(): Promise<number> {
    let totalDeleted = 0;

    // 删除 Wrapper 条目
    try {
        const primaryLorebookName = await getInjectionTargetLorebook_ACU();
        if (primaryLorebookName && isWorldbookApiAvailable_ACU()) {
            const isoPrefix = getIsolationPrefix_ACU();
            const WRAPPER_START_COMMENT = isoPrefix + 'TavernDB-ACU-WrapperStart';
            const WRAPPER_END_COMMENT = isoPrefix + 'TavernDB-ACU-WrapperEnd';

            const allEntries = await getLorebookEntries_ACU(primaryLorebookName);
            const wrapperUidsToDelete = allEntries
                .filter(e =>
                    !isImportProtectedComment_ACU(e.comment, isoPrefix) &&
                    (e.comment === WRAPPER_START_COMMENT || e.comment === WRAPPER_END_COMMENT),
                )
                .map(e => e.uid);

            if (wrapperUidsToDelete.length > 0) {
                await deleteLorebookEntries_ACU(primaryLorebookName, wrapperUidsToDelete);
                totalDeleted += wrapperUidsToDelete.length;
                logDebug_ACU('Deleted Wrapper entries: ' + wrapperUidsToDelete.length);
            }
        }
    } catch (wrapperError) {
        logError_ACU('Failed to delete Wrapper entries:', wrapperError);
    }

    // 删除 PersonsHeader 和 Memory wrapper 条目
    try {
        const primaryLorebookName2 = await getInjectionTargetLorebook_ACU();
        if (primaryLorebookName2 && isWorldbookApiAvailable_ACU()) {
            const isoPrefix2 = getIsolationPrefix_ACU();
            const PERSONS_HEADER_COMMENT = isoPrefix2 + 'TavernDB-ACU-PersonsHeader';
            const MEMORY_START_COMMENT = isoPrefix2 + 'TavernDB-ACU-MemoryStart';
            const MEMORY_END_COMMENT = isoPrefix2 + 'TavernDB-ACU-MemoryEnd';

            const allEntries2 = await getLorebookEntries_ACU(primaryLorebookName2);
            const headerUidsToDelete = allEntries2
                .filter(e =>
                    !isImportProtectedComment_ACU(e.comment, isoPrefix2) &&
                    (e.comment === PERSONS_HEADER_COMMENT ||
                    e.comment === MEMORY_START_COMMENT ||
                    e.comment === MEMORY_END_COMMENT),
                )
                .map(e => e.uid);

            if (headerUidsToDelete.length > 0) {
                await deleteLorebookEntries_ACU(primaryLorebookName2, headerUidsToDelete);
                totalDeleted += headerUidsToDelete.length;
                logDebug_ACU('Deleted PersonsHeader and Memory wrapper entries: ' + headerUidsToDelete.length);
            }
        }
    } catch (headerError) {
        logError_ACU('Failed to delete PersonsHeader and Memory wrapper entries:', headerError);
    }

    return totalDeleted;
}
