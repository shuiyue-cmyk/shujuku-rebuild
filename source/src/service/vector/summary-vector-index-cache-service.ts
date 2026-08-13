import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { clearVectorIndexTempCache_ACU, deleteVectorIndexCacheByIndex_ACU } from '../../data/storage/vector-index-temp-cache';
import { clearSummaryVectorHotCache_ACU, deleteSummaryVectorHotCacheByIndex_ACU } from '../../data/storage/vector-index-hot-cache';
import { getLatestSummaryVectorIndexSnapshotState_ACU } from './summary-vector-index-state-service';
import { loadSummaryVectorIndexChunksFromManifest_ACU } from './summary-vector-index-storage-service';
import { clearSummaryVectorIndexLayerFromChat_ACU } from './summary-vector-index-chat-service';
import {
    clearSummaryVectorIndexFlushQueueForCurrentScopeUnlocked_ACU,
    resolveCurrentSummaryVectorFlushScope_ACU,
} from './summary-vector-index-flush-queue';
import {
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

export async function clearAllSummaryVectorIndexCaches_ACU(): Promise<void> {
    await Promise.all([
        clearVectorIndexTempCache_ACU(),
        clearSummaryVectorHotCache_ACU(),
    ]);
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
        const cacheResults = await Promise.allSettled([
            deleteVectorIndexCacheByIndex_ACU(params.indexId),
            deleteSummaryVectorHotCacheByIndex_ACU(params.indexId),
        ]);
        cacheResults.forEach((result, index) => {
            if (result.status === 'rejected') {
                logWarn_ACU(`[交火向量索引] ${reason} pointer 已删除，但${index === 0 ? '临时' : '热'}缓存清理失败，将继续重建:`, result.reason);
            }
        });
        return {
            chatStateCleared,
            cacheCleared: cacheResults.every((result) => result.status === 'fulfilled'),
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
