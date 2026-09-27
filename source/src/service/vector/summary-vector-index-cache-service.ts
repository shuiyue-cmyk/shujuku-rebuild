import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { clearVectorIndexTempCache_ACU, deleteVectorIndexCacheByIndex_ACU } from '../../data/storage/vector-index-temp-cache';
import {
    clearSummaryVectorHotCache_ACU,
    deleteSummaryVectorFlushTask_ACU,
    deleteSummaryVectorHotCacheByIndex_ACU,
    listSummaryVectorFlushTasks_ACU,
} from '../../data/storage/vector-index-hot-cache';
import { getLatestSummaryVectorIndexSnapshotState_ACU } from './summary-vector-index-state-service';
import { loadSummaryVectorIndexChunksFromManifest_ACU } from './summary-vector-index-storage-service';
import { clearSummaryVectorIndexLayerFromChat_ACU } from './summary-vector-index-chat-service';
import {
    clearSummaryVectorIndexFlushQueueForCurrentScopeUnlocked_ACU,
    clearSummaryVectorIndexFlushQueueForCurrentScope_ACU,
    resolveCurrentSummaryVectorFlushScope_ACU,
} from './summary-vector-index-flush-queue';
import {
    findSummaryTable_ACU,
    runSummaryVectorIndexArchiveScopeMutationExclusive_ACU,
} from './summary-vector-index-archive-service';

export interface SummaryVectorIndexCachePreloadResult_ACU {
    success: boolean;
    skipped: boolean;
    reason?: string;
    chunkCount: number;
    indexId?: string;
    error?: string;
    cacheCleared?: boolean;
    chatStateCleared?: boolean;
}

/** 返回 false 表示至少一个缓存未清干净（两个 helper 以返回值报失败，不抛错）。 */
export async function clearAllSummaryVectorIndexCaches_ACU(): Promise<boolean> {
    const [tempCacheCleared, hotCacheCleared] = await Promise.all([
        clearVectorIndexTempCache_ACU(),
        clearSummaryVectorHotCache_ACU(),
    ]);
    // 严格取 true：两个 helper 的契约是 Promise<boolean>；若写成 `!== false`，
    // 未来误引入一个 Promise<void> 的 helper（undefined）会被静默当成清理成功（fail-open）。
    return tempCacheCleared === true && hotCacheCleared === true;
}

export interface ClearAllSummaryVectorIndexFlushQueuesResult_ACU {
    /** 严格删除成功的其它 scope 残留任务数（当前 scope 的墓碑不计入）。 */
    clearedCount: number;
    /** 当前 scope 是否已按墓碑协议失效。 */
    currentScopeInvalidated: boolean;
    /** 任一步骤未能确认完成（未清干净）；调用方必须据此提示重试，不得报成功。 */
    failed: boolean;
    /**
     * 未清干净/未处理的原因（供 UI 如实措辞，禁止一律说成"存储不可用"）：
     * - `no_current_scope`：没加载聊天或找不到纪要表 ⇒ 当前 scope 无法解析，
     *   按协议不删任何记录（墓碑都写不出来，删了等于放行在飞 runner 复活数据）；
     *   用户打开聊天后再点即可生效。
     * - `tombstone_failed`：墓碑写入失败 ⇒ 同样放弃删除。
     * - `list_failed` / `delete_failed` / `residual_left`：存储层问题或仍有残留。
     */
    reason?: 'no_current_scope' | 'tombstone_failed' | 'list_failed' | 'delete_failed' | 'residual_left';
}

/**
 * 用户显式「清空临时缓存」时一并处理归档队列（flushTasks object store）。
 *
 * 协议顺序不可交换：
 * 1. 先用既有墓碑协议失效**当前 scope**（带单调 generation），使在飞 runner 在发布前
 *    的代次校验必然失败，无法复活当前 scope 的数据；
 * 2. 再全量列出并逐条**严格删除**其它 scope 的记录（delete 复读校验，false 即未清干净）；
 * 3. 当前 scope 的墓碑记录必须保留——删掉它等于放行在飞 runner 复活数据。
 *
 * 任何一步失败都不抛给 UI 吞掉，一律在返回值里 `failed: true` 如实上报。
 */
export async function clearAllSummaryVectorIndexFlushQueues_ACU(): Promise<ClearAllSummaryVectorIndexFlushQueuesResult_ACU> {
    const sourceTableKey = String(findSummaryTable_ACU()?.summaryKey || '').trim();
    const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
    let currentScopeKey = '';
    try {
        currentScopeKey = resolveCurrentSummaryVectorFlushScope_ACU({ isolationKey, sourceTableKey }).scopeKey;
        await clearSummaryVectorIndexFlushQueueForCurrentScope_ACU({ isolationKey, sourceTableKey });
    } catch (error) {
        // 墓碑没写成就不能删：删了等于放行在飞 runner 复活当前 scope 的数据。
        // 区分"没有当前 scope"与"存储故障"：前者不是存储不可用，重试也不会变好。
        const reason = findSummaryTable_ACU() == null ? 'no_current_scope' : 'tombstone_failed';
        logWarn_ACU(
            `[交火向量索引] 清空归档队列：当前 scope 失效墓碑写入失败（${reason}），已放弃删除残留任务。`,
            error,
        );
        return { clearedCount: 0, currentScopeInvalidated: false, failed: true, reason };
    }

    let tasks: Awaited<ReturnType<typeof listSummaryVectorFlushTasks_ACU>> = [];
    try {
        // 不带 scope 全量列出：scope 过滤对 legacy 空 isolationKey 任务不成立，
        // 过滤后列出会把这类残留永久藏在 IndexedDB 里。
        tasks = await listSummaryVectorFlushTasks_ACU();
    } catch (error) {
        logWarn_ACU('[交火向量索引] 清空归档队列：列出残留任务失败。', error);
        return { clearedCount: 0, currentScopeInvalidated: true, failed: true, reason: 'list_failed' };
    }

    let clearedCount = 0;
    let deleteFailed = false;
    for (const task of tasks) {
        // 当前 scope 的墓碑必须留下：删掉它等于放行在飞 runner 复活当前 scope 的数据。
        if (task.scopeKey === currentScopeKey) continue;
        // 严格取 true：delete 的 false 通道表示任务可能残留（后继 replay 会复活已删数据）。
        if ((await deleteSummaryVectorFlushTask_ACU(task.scopeKey)) === true) {
            clearedCount += 1;
            continue;
        }
        deleteFailed = true;
        logWarn_ACU(`[交火向量索引] 清空归档队列：残留任务删除失败：scope=${task.scopeKey}`);
    }

    // 清扫后再列一次做**复读校验**：list 自身把异常兜成 []（hot-cache 层既有契约），
    // 一次"列出为空"不足以证明真的清干净；这里以"除当前 scope 墓碑外仍有残留"为准，
    // 同时覆盖清扫期间并发重建任务的情况。
    let residual = 0;
    let residualUnknown = false;
    try {
        residual = (await listSummaryVectorFlushTasks_ACU()).filter(task => task.scopeKey !== currentScopeKey).length;
    } catch (error) {
        logWarn_ACU('[交火向量索引] 清空归档队列：复读校验残留任务失败。', error);
        residualUnknown = true;
    }
    if (deleteFailed) return { clearedCount, currentScopeInvalidated: true, failed: true, reason: 'delete_failed' };
    if (residualUnknown) return { clearedCount, currentScopeInvalidated: true, failed: true, reason: 'list_failed' };
    if (residual > 0) return { clearedCount, currentScopeInvalidated: true, failed: true, reason: 'residual_left' };
    return { clearedCount, currentScopeInvalidated: true, failed: false };
}

function normalizeErrorMessage_ACU(error: unknown): string {
    if (error instanceof Error) return error.message || error.name || '未知错误';
    if (typeof error === 'string') return error;
    try {
        const json = JSON.stringify(error);
        return json && json !== '{}' ? json : String(error || '未知错误');
    } catch (_jsonError) {
        return String(error || '未知错误');
    }
}

export function isMissingExternalVectorFileError_ACU(message: string): boolean {
    const text = String(message || '').toLowerCase();
    const isVectorFileReadFailure = text.includes('交火向量索引分片读取失败')
        || text.includes('交火向量索引内容块读取失败')
        || text.includes('交火向量单文件快照读取失败');
    return isVectorFileReadFailure && /读取失败\s+404(?:\s*:|\b)/.test(text);
}

export interface ClearMissingSummaryVectorIndexResult_ACU {
    chatStateCleared: boolean;
    cacheCleared: boolean;
    flushTaskCountCleared: number;
}

export async function clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU(params: {
    messageIndex: number;
    isolationKey: string;
    indexId: string;
    sourceTableKey: string;
}): Promise<ClearMissingSummaryVectorIndexResult_ACU> {
    return clearLatestSummaryVectorIndexStateUnderScopeLock_ACU(params, '外置文件缺失');
}

export async function clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU(params: {
    messageIndex: number;
    isolationKey: string;
    indexId: string;
    sourceTableKey: string;
}): Promise<ClearMissingSummaryVectorIndexResult_ACU> {
    return clearLatestSummaryVectorIndexStateUnderScopeLock_ACU(params, '身份无效');
}

async function clearLatestSummaryVectorIndexStateUnderScopeLock_ACU(
    params: { messageIndex: number; isolationKey: string; indexId: string; sourceTableKey: string },
    reason: string,
): Promise<ClearMissingSummaryVectorIndexResult_ACU> {
    const flushScope = resolveCurrentSummaryVectorFlushScope_ACU({
        isolationKey: params.isolationKey,
        sourceTableKey: params.sourceTableKey,
    });
    return runSummaryVectorIndexArchiveScopeMutationExclusive_ACU(flushScope.scopeKey, async () => {
        // 先持久化失效墓碑，再删除聊天 pointer。该临界区与归档 publish 共用 scope lock，
        // 因此 tombstone 不会在 generation 校验和 durable save 之间插入。
        const flushTaskCountCleared = await clearSummaryVectorIndexFlushQueueForCurrentScopeUnlocked_ACU(flushScope);
        const chatStateCleared = await clearSummaryVectorIndexLayerFromChat_ACU({
            messageIndex: params.messageIndex,
            isolationKey: params.isolationKey,
            indexId: params.indexId,
        });
        // 两个 helper 现已把失败降级为返回值（不再抛错）；同时保留 allSettled 的隔离能力
        // （helper 未来若抛错仍应被隔离成「未清干净」而不是打穿上层）。两种失败形态都要认，
        // 否则光看 rejected 会让告警分支与 cacheCleared 恒为真，等于静默吞掉清理失败。
        const cacheResults = await Promise.allSettled([
            deleteVectorIndexCacheByIndex_ACU(params.indexId),
            deleteSummaryVectorHotCacheByIndex_ACU(params.indexId),
        ]);
        cacheResults.forEach((result, index) => {
            const label = index === 0 ? '临时' : '热';
            if (result.status === 'rejected') {
                logWarn_ACU(`[交火向量索引] ${reason} pointer 已删除，但${label}缓存清理失败，将继续重建:`, result.reason);
            } else if (result.value !== true) {
                logWarn_ACU(`[交火向量索引] ${reason} pointer 已删除，但${label}缓存清理失败，将继续重建。`);
            }
        });
        return {
            chatStateCleared,
            cacheCleared: cacheResults.every((result) => result.status === 'fulfilled' && result.value === true),
            flushTaskCountCleared,
        };
    });
}

export function isInvalidExternalVectorFileError_ACU(message: string): boolean {
    const text = String(message || '').toLowerCase();
    return text.includes('交火向量索引分片身份不匹配')
        || text.includes('交火向量索引分片校验失败')
        || text.includes('交火向量索引内容块身份不匹配')
        || text.includes('交火向量索引内容块校验失败')
        || text.includes('交火向量索引内容包身份不匹配')
        || text.includes('交火向量索引内容包校验失败')
        || text.includes('交火向量单文件快照协议不匹配')
        || text.includes('交火向量单文件快照身份不匹配')
        || text.includes('交火向量单文件快照表标识不匹配')
        || text.includes('交火向量单文件快照 v2 身份元数据不完整')
        || text.includes('交火向量单文件快照 v2 manifest 缺少 snapshot 元数据')
        || text.includes('交火向量单文件快照 v2 内嵌 manifest 缺失');
}

export async function preloadSummaryVectorIndexCacheForCurrentChat_ACU(): Promise<SummaryVectorIndexCachePreloadResult_ACU> {
    const snapshot = getLatestSummaryVectorIndexSnapshotState_ACU();
    const latestLayer = snapshot?.layers?.[0] || null;
    const manifest = snapshot?.summaryVectorIndexState?.manifest || null;
    if (!manifest) {
        return {
            success: true,
            skipped: true,
            reason: 'no_manifest',
            chunkCount: 0,
        };
    }

    if (manifest.status !== 'ready') {
        return {
            success: true,
            skipped: true,
            reason: `manifest_status_${manifest.status || 'unknown'}`,
            chunkCount: 0,
            indexId: manifest.indexId,
        };
    }

    try {
        const chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(manifest, {
            preferExternalFiles: true,
        });
        logDebug_ACU(`[交火向量索引] 当前聊天向量缓存预热完成：operation=prewarm_cache, indexId=${manifest.indexId}, revision=${manifest.storageIdentity?.revision ?? manifest.snapshot?.revision ?? ''}, changed=${chunks.length > 0}，已从外置文件恢复热缓存。`);
        return {
            success: true,
            skipped: false,
            chunkCount: chunks.length,
            indexId: manifest.indexId,
        };
    } catch (error) {
        const message = normalizeErrorMessage_ACU(error);
        if (isMissingExternalVectorFileError_ACU(message)) {
            let chatStateCleared = false;
            let cacheCleared = false;
            try {
                const clearResult = latestLayer && manifest.indexId
                    ? await clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU({
                        messageIndex: latestLayer.messageIndex,
                        isolationKey: latestLayer.isolationKey,
                        indexId: manifest.indexId,
                        sourceTableKey: manifest.sourceTableKey,
                    })
                    : { chatStateCleared: false, cacheCleared: false, flushTaskCountCleared: 0 };
                chatStateCleared = clearResult.chatStateCleared;
                cacheCleared = clearResult.cacheCleared;
            } catch (clearError) {
                logWarn_ACU('[交火向量索引] 当前聊天外置向量文件缺失，但严格删除失效索引指针失败:', clearError);
                return { success: false, skipped: true, reason: 'external_files_missing_state_clear_save_failed', chunkCount: 0, indexId: manifest.indexId, error: normalizeErrorMessage_ACU(clearError), cacheCleared: false, chatStateCleared: false };
            }
            logWarn_ACU(chatStateCleared
                ? '[交火向量索引] 当前聊天外置向量文件缺失，已删除失效索引指针；交由 UI 走“立即构建”普通路径重建:'
                : '[交火向量索引] 当前聊天外置向量文件缺失，但失效索引指针未能安全删除；拒绝盲目重建:', message);
            return {
                success: true,
                skipped: true,
                reason: !chatStateCleared
                    ? 'external_files_missing_state_clear_failed'
                    : 'external_files_missing_state_cleared_rebuild_required',
                chunkCount: 0,
                indexId: manifest.indexId,
                error: message,
                cacheCleared,
                chatStateCleared,
            };
        }
        if (isInvalidExternalVectorFileError_ACU(message)) {
            let clearResult: ClearMissingSummaryVectorIndexResult_ACU = {
                chatStateCleared: false,
                cacheCleared: false,
                flushTaskCountCleared: 0,
            };
            try {
                if (latestLayer) {
                    clearResult = await clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU({
                        messageIndex: latestLayer.messageIndex,
                        isolationKey: latestLayer.isolationKey,
                        indexId: manifest.indexId,
                        sourceTableKey: manifest.sourceTableKey,
                    });
                }
            } catch (clearError) {
                return { success: false, skipped: true, reason: 'external_files_invalid_state_clear_save_failed', chunkCount: 0, indexId: manifest.indexId, error: normalizeErrorMessage_ACU(clearError), cacheCleared: false, chatStateCleared: false };
            }
            logWarn_ACU(clearResult.chatStateCleared
                ? '[交火向量索引] 当前聊天外置向量文件身份校验失败，已删除失效指针；交由 UI 从源表重建:'
                : '[交火向量索引] 当前聊天外置向量文件身份校验失败，但失效指针未能安全删除；拒绝盲目重建:', message);
            return {
                success: clearResult.chatStateCleared,
                skipped: true,
                reason: clearResult.chatStateCleared
                    ? 'external_files_identity_invalid_rebuild_required'
                    : 'external_files_identity_invalid_state_clear_failed',
                chunkCount: 0,
                indexId: manifest.indexId,
                error: message,
                cacheCleared: clearResult.cacheCleared,
                chatStateCleared: clearResult.chatStateCleared,
            };
        }
        logWarn_ACU('[交火向量索引] 当前聊天向量缓存预热失败:', message);
        return {
            success: false,
            skipped: false,
            reason: 'preload_failed',
            chunkCount: 0,
            indexId: manifest.indexId,
            error: message,
        };
    }
}
