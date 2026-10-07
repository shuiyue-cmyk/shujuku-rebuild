/**
 * service/vector/summary-vector-mirror-writer.ts — 纪要向量镜像 flush runner
 *
 * 流程：resolver → rowId 时间线 → 未镜像 entry 集合差分 → 批量 embedding →
 * 一个 pack（prepared）→ vector_mirror 事务内重读 frame、校验 entryId、写同层 delta →
 * 一次 strict save → pack 转 published。失败回滚 frame 快照，pack 保持 prepared。
 */

import { createEmbeddings_ACU, isVectorEmbeddingError_ACU } from '../../data/gateways/vector-embedding-gateway';
import {
    executeEmbeddingBatchPlan_ACU,
    planEmbeddingBatches_ACU,
} from './summary-vector-embedding-batches';
import { EmbeddingBatchExecutionError_ACU } from './summary-vector-embedding-batches';

import { saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
    collectSummarySheetRowIdTimelineV2_ACU,
    tableEntryTouchesSheetV2_ACU,
    type SummarySheetRowIdTimelineEntryV2_ACU,
} from '../table/summary-sheet-rowid-timeline';
import { captureTableRuntimeRevisionForWriteSet_ACU, runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import type {
    SummaryVectorChunkRef_ACU,
    SummaryVectorEmbeddingIdentity_ACU,
    SummaryVectorIndexMirrorFrameV2_ACU,
    SummaryVectorIndexMirrorLogEntryV2_ACU,
    SummaryVectorIndexMirrorOperationV2_ACU,
    SummaryVectorPackRef_ACU,
    TableMutationWriteSetV2_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';
import { hashUserInput_ACU, logDebug_ACU, logWarn_ACU, pickSummarySheetKeyByPriority_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU, toChatIsolationSlotKey_ACU } from '../../shared/summary-vector-index-scope';
import { buildPreparedRows_ACU, buildRowChunkTexts_ACU, findSummaryTable_ACU } from './summary-vector-index-archive-service';
import { getEffectiveSummaryVectorIndexConfig_ACU, validateSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import { SUMMARY_VECTOR_SOURCE_TEXT_VERSION_ACU } from './summary-vector-row-fingerprint';
import { collectSummaryVectorMirrorFrameRefs_ACU, resolveSummaryVectorMirrorHead_ACU, summaryVectorEmbeddingIdentityEquals_ACU } from './summary-vector-mirror-resolver';
import {
    discardSummaryVectorMirrorPreparedFiles_ACU,
    encodeSummaryVectorMirrorVector_ACU,
    finalizeSummaryVectorMirrorFiles_ACU,
    loadSummaryVectorMirrorManifest_ACU,
    loadSummaryVectorMirrorPack_ACU,
    persistSummaryVectorMirrorPackPrepared_ACU,
} from './summary-vector-mirror-storage';
import type { SummaryVectorIndexContentPackChunk_ACU, SummaryVectorIndexExternalFileRef_ACU } from './summary-vector-index-types';
import type { SummaryVectorMirrorHeadResult_ACU } from './summary-vector-index-types';
import { createSummaryVectorMirrorUndoLog_ACU } from './summary-vector-mirror-undo';
import { assertSummaryVectorFlushGenerationCurrent_ACU, SummaryVectorFlushGenerationInvalidatedError_ACU } from '../../data/storage/vector-index-hot-cache';

export interface SummaryVectorMirrorFlushResult_ACU {
    success: boolean;
    skipped: boolean;
    indexedRowCount: number;
    skippedRowCount: number;
    chunkCount: number;
    reason?: string;
    retryability?: 'retryable' | 'terminal';
    credentialFingerprint?: string;
    errors: string[];
    needsRebuild?: boolean;
    writtenDeltaCount?: number;
}

export interface UnmirroredEntryDeltaPlanV2_ACU {
    messageIndex: number;
    entryId: string;
    commitRevision: string | null;
    added: string[];
    removed: string[];
    /** 已存在且 rowId 集合未变的行；对应 table entry 可能改了正文，需重新生成向量。 */
    refreshed?: string[];
}

function emptyResult_ACU(partial: Partial<SummaryVectorMirrorFlushResult_ACU>): SummaryVectorMirrorFlushResult_ACU {
    return {
        success: false,
        skipped: false,
        indexedRowCount: 0,
        skippedRowCount: 0,
        chunkCount: 0,
        errors: [],
        ...partial,
    };
}

export function buildCurrentSummaryVectorEmbeddingIdentity_ACU(): SummaryVectorEmbeddingIdentity_ACU {
    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    return {
        endpointFingerprint: hashUserInput_ACU(String(config.embeddingEndpoint || '').trim()),
        model: String(config.embeddingModel || '').trim(),
        dimension: Math.max(0, Math.floor(Number((config as any).embeddingDimension) || 0)),
        sourceTextVersion: SUMMARY_VECTOR_SOURCE_TEXT_VERSION_ACU,
    };
}

export function findTouchedSummarySheetKey_ACU(options: {
    tableData?: Record<string, any> | null;
    changedSheetKeys?: string[];
    writeSet?: TableMutationWriteSetV2_ACU;
}): string | null {
    const tableData = options.tableData || currentJsonTableData_ACU || {};
    const fromKeys = Array.isArray(options.changedSheetKeys) ? options.changedSheetKeys : [];
    const fromWriteSet = Array.isArray(options.writeSet)
        ? options.writeSet.map((unit) => (unit && unit.kind !== 'all' ? String(unit.sheetKey || '').trim() : ''))
        : [];
    const candidates = [...new Set([...fromKeys, ...fromWriteSet].map((key) => String(key || '').trim()).filter(Boolean))];
    if (options.writeSet?.some((unit) => unit?.kind === 'all')) {
        const picked = pickSummarySheetKeyByPriority_ACU(
            Object.keys(tableData).filter((key) => key.startsWith('sheet_')),
            (key) => tableData[key]?.name,
        );
        if (picked) return picked;
    }
    return pickSummarySheetKeyByPriority_ACU(candidates, (key) => tableData[key]?.name);
}

export function planUnmirroredEntryDeltasV2_ACU(
    timelineEntries: SummarySheetRowIdTimelineEntryV2_ACU[],
    appliedTableEntryIds: string[],
    rowIdsAtCheckpoint: string[],
    alreadyMirroredRowIds: Iterable<string> = [],
): UnmirroredEntryDeltaPlanV2_ACU[] {
    const mirrored = new Set(appliedTableEntryIds);
    const alreadyInHead = new Set(
        [...alreadyMirroredRowIds].map((rowId) => String(rowId || '').trim()).filter(Boolean),
    );
    const plans: UnmirroredEntryDeltaPlanV2_ACU[] = [];
    const refreshed = new Set<string>();
    let before = new Set(rowIdsAtCheckpoint);
    for (const entry of timelineEntries) {
        const after = new Set(entry.rowIdsAfter);
        if (!mirrored.has(entry.entryId)) {
            const added = [...after].filter((rowId) => !before.has(rowId) && !alreadyInHead.has(rowId)).sort();
            const removed = [...before].filter((rowId) => !after.has(rowId)).sort();
            // timeline 观察的是稳定 rowId，无法从 rowId 集合本身区分正文是否变化。
            // 对当前 head 中仍稳定存在的行，在首个未镜像 entry 生成一次 refresh；
            // 后续 entry 复用同一轮最终实时文本生成的向量，避免同 rowId 永久沿用旧 pack。
            const refresh = [...after].filter((rowId) => (
                before.has(rowId)
                && alreadyInHead.has(rowId)
                && !refreshed.has(rowId)
            )).sort();
            refresh.forEach((rowId) => refreshed.add(rowId));
            if (added.length > 0 || removed.length > 0 || refresh.length > 0) {
                plans.push({
                    messageIndex: entry.messageIndex,
                    entryId: entry.entryId,
                    commitRevision: entry.commitRevision,
                    added,
                    removed,
                    ...(refresh.length > 0 ? { refreshed: refresh } : {}),
                });
            }
        }
        before = after;
    }
    return plans;
}

function getStorageFrame_ACU(chat: any[], isolationKey: string, messageIndex: number): TableStorageFrameV2_ACU | null {
    const message = chat[messageIndex];
    const isolated = message?.TavernDB_ACU_IsolatedData;
    const tagData = isolated && typeof isolated === 'object' ? isolated[isolationKey] : null;
    if (!isV2TagData_ACU(tagData)) return null;
    return tagData.storageFrame as TableStorageFrameV2_ACU;
}

function tableEntryStillExists_ACU(frame: TableStorageFrameV2_ACU | null, entryId: string): boolean {
    if (!frame || !entryId) return false;
    return (frame.logEntries || []).some((entry) => entry?.entryId === entryId);
}

function generateVectorDeltaEntryId_ACU(): string {
    return `vdelta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 当前隔离槽全部镜像 frame 的结构签名（checkpoint 修订号 + 各层 delta entryId）。
 * writer 与 rebuild 之间没有互斥，派生写入也不 bump 表格修订号（R5-07）：
 * 提交前比对签名，镜像在 embedding 期间被改写过就放弃本次计划，交回队列按新 head 重放。
 */
function computeSummaryVectorMirrorFramesSignature_ACU(chat: any[], isolationKey: string): string {
    return collectSummaryVectorMirrorFrameRefs_ACU(chat, isolationKey)
        .map((ref) => {
            const mirror = ref.frame.summaryVectorIndexFrame;
            const deltaIds = (mirror?.logEntries || []).map((entry) => String(entry?.entryId || '')).join(',');
            return `${ref.messageIndex}:${mirror?.checkpoint?.vectorRevision || ''}:${deltaIds}`;
        })
        .join('|');
}

async function collectKnownHeadRowHashes_ACU(
    head: SummaryVectorMirrorHeadResult_ACU,
    rowIds: string[],
): Promise<Map<string, string>> {
    const known = new Map<string, string>();
    const unknown: string[] = [];
    for (const rowId of rowIds) {
        const hash = head.rowSourceHashes?.get(rowId);
        if (hash) known.set(rowId, hash);
        else unknown.push(rowId);
    }
    if (unknown.length === 0) return known;
    // 旧 manifest 未记录哈希：回读该行引用的 pack chunk，用写入时的 textHash 判定。读不到按未知处理（照常重嵌）。
    const packRefsByHash = new Map(head.packRefs.map((ref) => [ref.packHash, ref]));
    const packCache = new Map<string, Awaited<ReturnType<typeof loadSummaryVectorMirrorPack_ACU>>>();
    for (const rowId of unknown) {
        const refs = head.head.get(rowId) || [];
        const hashes = new Set<string>();
        for (const ref of refs) {
            if (!packCache.has(ref.packHash)) {
                const packRef = packRefsByHash.get(ref.packHash);
                let pack: Awaited<ReturnType<typeof loadSummaryVectorMirrorPack_ACU>> = null;
                try {
                    pack = packRef ? await loadSummaryVectorMirrorPack_ACU(packRef) : null;
                } catch {
                    pack = null;
                }
                packCache.set(ref.packHash, pack);
            }
            hashes.add(String(packCache.get(ref.packHash)?.chunks?.[ref.chunkIndex]?.textHash || ''));
        }
        const [only] = [...hashes];
        if (hashes.size === 1 && only) known.set(rowId, only);
    }
    return known;
}

async function dropUnchangedRefreshes_ACU(
    plans: UnmirroredEntryDeltaPlanV2_ACU[],
    head: SummaryVectorMirrorHeadResult_ACU,
    rowsById: Map<string, { vectorSourceHash: string }>,
): Promise<UnmirroredEntryDeltaPlanV2_ACU[]> {
    const refreshCandidates = [...new Set(plans.flatMap((plan) => plan.refreshed || []))];
    if (refreshCandidates.length === 0) return plans;
    const known = await collectKnownHeadRowHashes_ACU(head, refreshCandidates);
    const unchanged = new Set(refreshCandidates.filter((rowId) => {
        const liveHash = String(rowsById.get(rowId)?.vectorSourceHash || '');
        return !!liveHash && known.get(rowId) === liveHash;
    }));
    if (unchanged.size === 0) return plans;
    return plans
        .map((plan): UnmirroredEntryDeltaPlanV2_ACU => {
            const refreshed = (plan.refreshed || []).filter((rowId) => !unchanged.has(rowId));
            const { refreshed: _dropped, ...rest } = plan;
            return refreshed.length > 0 ? { ...rest, refreshed } : rest;
        })
        .filter((plan) => plan.added.length > 0 || plan.removed.length > 0 || (plan.refreshed?.length || 0) > 0);
}

export async function flushSummaryVectorMirrorNow_ACU(options: {
    isolationKey?: string;
    sourceTableKey?: string;
    expectedFlushScopeKey?: string;
    expectedFlushGeneration?: number;
} = {}): Promise<SummaryVectorMirrorFlushResult_ACU> {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return emptyResult_ACU({ skipped: true, reason: 'chat_empty', success: true });
    }
    const selected = findSummaryTable_ACU(options.sourceTableKey);
    if (!selected?.summaryKey) {
        return emptyResult_ACU({ reason: 'summary_table_not_found', errors: ['纪要表不可用'], retryability: 'terminal' });
    }
    const isolationKey = toChatIsolationSlotKey_ACU(
        options.isolationKey ?? getCurrentIsolationKey_ACU(),
        getCurrentIsolationKey_ACU(),
    );
    const scope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey,
        sourceTableKey: selected.summaryKey,
    });

    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const configValidation = validateSummaryVectorIndexConfig_ACU(config);
    if (!configValidation.valid) {
        return emptyResult_ACU({
            reason: 'summary_vector_index_config_invalid',
            errors: configValidation.errors,
            retryability: 'terminal',
        });
    }

    const currentEmbedding = buildCurrentSummaryVectorEmbeddingIdentity_ACU();
    let head: SummaryVectorMirrorHeadResult_ACU;
    try {
        head = await resolveSummaryVectorMirrorHead_ACU({
            chat,
            isolationKey,
            sourceTableKey: selected.summaryKey,
            loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref),
        });
    } catch (error: any) {
        return emptyResult_ACU({
            reason: 'resolver_failed',
            errors: [error?.message || String(error || 'resolver 失败')],
            retryability: 'retryable',
        });
    }

    if (head.status === 'unsupported_replay_base') {
        return emptyResult_ACU({
            reason: 'unsupported_replay_base',
            errors: ['表格基底不是 full checkpoint，无法写向量镜像。'],
            retryability: 'terminal',
        });
    }
    if (
        head.status === 'no_mirror'
        || head.status === 'source_table_changed'
        || head.status === 'embedding_identity_changed'
        || head.status === 'checkpoint_mismatch'
        || head.status === 'manifest_unavailable'
    ) {
        return emptyResult_ACU({
            reason: head.status,
            needsRebuild: true,
            errors: [`向量镜像需要重建：${head.status}`],
            retryability: 'terminal',
        });
    }
    if (head.chainConflict) {
        return emptyResult_ACU({
            reason: 'chain_conflict',
            needsRebuild: true,
            errors: ['向量镜像链冲突，需要自动修复重建。'],
            retryability: 'terminal',
        });
    }
    const checkpointEmbedding = head.checkpoint?.embedding;
    if (
        checkpointEmbedding
        && !summaryVectorEmbeddingIdentityEquals_ACU(currentEmbedding, checkpointEmbedding)
    ) {
        return emptyResult_ACU({
            reason: 'embedding_identity_changed',
            needsRebuild: true,
            errors: ['embedding 身份与 checkpoint 不一致，需要重建。'],
            retryability: 'terminal',
        });
    }
    const embedding: SummaryVectorEmbeddingIdentity_ACU = {
        ...currentEmbedding,
        dimension: checkpointEmbedding?.dimension || currentEmbedding.dimension,
    };

    const timeline = await collectSummarySheetRowIdTimelineV2_ACU({
        chat,
        isolationKey,
        sheetKey: selected.summaryKey,
    });
    if (timeline.status === 'unsupported_replay_base') {
        return emptyResult_ACU({
            reason: 'unsupported_replay_base',
            errors: ['rowId 时间线无法从非 full 基底收集。'],
            retryability: 'terminal',
        });
    }
    if (timeline.status !== 'ok') {
        return emptyResult_ACU({
            reason: 'timeline_failed',
            errors: [timeline.error || 'rowId 时间线收集失败'],
            retryability: 'retryable',
        });
    }

    const mirrorSignature = computeSummaryVectorMirrorFramesSignature_ACU(chat, isolationKey);
    let plans = planUnmirroredEntryDeltasV2_ACU(
        timeline.entries,
        head.appliedTableEntryIds,
        timeline.rowIdsAtCheckpoint,
        head.head.keys(),
    );
    if (plans.length === 0) {
        return emptyResult_ACU({
            success: true,
            skipped: true,
            reason: 'no_unmirrored_entries',
        });
    }

    const prepared = buildPreparedRows_ACU(selected.table, selected.summaryKey);
    if (prepared.error) {
        return emptyResult_ACU({
            reason: 'prepared_rows_invalid',
            errors: [prepared.error],
            retryability: 'terminal',
        });
    }
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(
        [{ kind: 'sheet', sheetKey: selected.summaryKey }],
        { isolationKey },
    );
    const rowsById = new Map(prepared.rows.map((row) => [row.rowId, row]));
    // 时间线只看 rowId，看不出正文是否变化：refresh 前比对 head 中该行写入时的源文本哈希，
    // 只重嵌真正变了的行（R5-02），否则每次 flush 都会把整张表重嵌一遍。
    plans = await dropUnchangedRefreshes_ACU(plans, head, rowsById);
    if (plans.length === 0) {
        return emptyResult_ACU({
            success: true,
            skipped: true,
            reason: 'no_changed_rows',
        });
    }
    const addedRowIds = [...new Set(plans.flatMap((plan) => [
        ...plan.added,
        ...(plan.refreshed || []),
    ]))];
    const missingAdded = addedRowIds.filter((rowId) => !rowsById.has(rowId));
    if (missingAdded.length > 0) {
        logWarn_ACU(`[向量镜像] 新增 rowId 在实时纪要表中找不到，本轮跳过这些行：${missingAdded.join(',')}`);
    }

    const chunkSources: Array<{ rowId: string; rowKey: string; text: string; vectorSourceHash: string }> = [];
    for (const rowId of addedRowIds) {
        const row = rowsById.get(rowId);
        if (!row) continue;
        const texts = buildRowChunkTexts_ACU(row.vectorSourceText, {
            sentenceCount: config.summaryChunkSentenceCount,
            chunkBySentence: config.summaryIndexChunkChronicleBySentence === true,
        });
        texts.forEach((text) => {
            chunkSources.push({ rowId, rowKey: rowId, text, vectorSourceHash: row.vectorSourceHash });
        });
    }

    let embeddings: number[][] = [];
    if (chunkSources.length > 0) {
        try {
            const plan = planEmbeddingBatches_ACU(chunkSources, {
                maxRowsPerRequest: config.summaryIndexArchiveMaxConcurrency,
                maxInputCharsPerRequest: Number(config.summaryIndexArchiveMaxInputChars) || 24000,
            });
            const executed = await executeEmbeddingBatchPlan_ACU(plan, {
                maxConcurrentRequests: config.summaryIndexArchiveEmbeddingConcurrency,
                requestEmbeddings: (input) => createEmbeddings_ACU({
                    endpoint: config.embeddingEndpoint,
                    apiKey: config.embeddingApiKey,
                    model: config.embeddingModel,
                    input,
                }),
            });
            embeddings = executed.embeddings;
            if (embeddings.some((vector) => vector.length === 0)) {
                return emptyResult_ACU({
                    reason: 'embedding_incomplete',
                    errors: ['批量 embedding 结果不完整'],
                    retryability: 'retryable',
                });
            }
            const actualDimension = embeddings[0].length;
            if (embedding.dimension > 0 && actualDimension !== embedding.dimension) {
                return emptyResult_ACU({
                    reason: 'embedding_identity_changed',
                    needsRebuild: true,
                    errors: [`embedding 维度从 ${embedding.dimension} 变为 ${actualDimension}，需要重建。`],
                    retryability: 'terminal',
                });
            }
            embedding.dimension = actualDimension;
        } catch (error: any) {
            const embeddingError = error instanceof EmbeddingBatchExecutionError_ACU ? (error as any).cause : error;
            const message = error?.message || String(error || 'embedding 失败');
            // 失败分类与归档路径对齐（archive-service）：凭据/请求/协议契约三类错误重试无意义，
            // 一律 terminal，避免把必然失败的请求烧满重试额度；其余（网络/限流/5xx）保持可重试。
            const kind = isVectorEmbeddingError_ACU(embeddingError) ? String((embeddingError as any).kind || '') : '';
            const credential = kind === 'credential'
                || Number((embeddingError as any).httpStatus) === 401 || Number((embeddingError as any).httpStatus) === 403;
            const terminal = credential || kind === 'request' || kind === 'provider-contract';
            return emptyResult_ACU({
                reason: credential ? 'embedding_unauthorized' : 'embedding_failed',
                errors: [message],
                retryability: terminal ? 'terminal' : 'retryable',
                ...(credential ? {
                    credentialFingerprint: hashUserInput_ACU([
                        String(config.embeddingEndpoint || '').trim(),
                        String(config.embeddingModel || '').trim(),
                        String(config.embeddingApiKey || '').trim(),
                    ].join('|')),
                } : {}),
            });
        }
    }

    let packPersist: { ref: SummaryVectorPackRef_ACU; file: SummaryVectorIndexExternalFileRef_ACU; createdNew?: boolean } | null = null;
    const chunkRefsByRowId = new Map<string, SummaryVectorChunkRef_ACU[]>();
    if (chunkSources.length > 0) {
        const packChunks: SummaryVectorIndexContentPackChunk_ACU[] = chunkSources.map((source, index) => ({
            chunkKey: `${source.rowId}:${index}`,
            chunkId: `${source.rowId}:${index}`,
            rowKey: source.rowId,
            text: source.text,
            vector: encodeSummaryVectorMirrorVector_ACU(embeddings[index]),
            vectorEncoding: 'f32b64',
            textHash: source.vectorSourceHash,
        }));
        packPersist = await persistSummaryVectorMirrorPackPrepared_ACU({
            chatKey: scope.chatKey,
            isolationKey: scope.isolationKey,
            sourceTableKey: scope.sourceTableKey,
            embeddingModel: embedding.model,
            dimension: embeddings[0]?.length || embedding.dimension,
            chunks: packChunks,
        });
        chunkSources.forEach((source, index) => {
            const list = chunkRefsByRowId.get(source.rowId) || [];
            list.push({ packHash: packPersist!.ref.packHash, chunkIndex: index });
            chunkRefsByRowId.set(source.rowId, list);
        });
    }

    // 只撤销本次亲手写入的镜像字段（在锁内登记），不能整块覆盖楼层数据：
    // 等锁期间别的写入方可能已向同一楼层提交了表格 entry。
    const undo = createSummaryVectorMirrorUndoLog_ACU();
    let writtenDeltaCount = 0;
    try {
        await runTableWriteTransaction_ACU({
            source: 'vector_mirror',
            reason: 'summary_vector_mirror_flush',
            revisionImpact: 'derived_metadata',
            isolationKey,
            writeSet: [{ kind: 'sheet', sheetKey: selected.summaryKey }],
            baseRevision,
            workingDataMode: 'none',
        }, async (ctx) => {
            ctx.assertFresh?.('vector_mirror:before_delta_write');
            // 队列墓碑协议（R5-10）：删除索引 / 清空队列后，在飞的 flush 不得再提交。
            if (options.expectedFlushScopeKey && options.expectedFlushGeneration != null) {
                await assertSummaryVectorFlushGenerationCurrent_ACU(options.expectedFlushScopeKey, options.expectedFlushGeneration);
            }
            if (computeSummaryVectorMirrorFramesSignature_ACU(chat, isolationKey) !== mirrorSignature) {
                throw new Error('summary_vector_mirror_stale_head：embedding 期间镜像已被改写（重建或其他 flush），放弃本次计划。');
            }
            await ctx.runCommit(async () => {
                for (const plan of plans) {
                    const frame = getStorageFrame_ACU(chat, isolationKey, plan.messageIndex);
                    if (!tableEntryStillExists_ACU(frame, plan.entryId) || !frame) {
                        logDebug_ACU(`[向量镜像] 丢弃已失效来源 entry 的 delta：entryId=${plan.entryId}, messageIndex=${plan.messageIndex}`);
                        continue;
                    }
                    // 浅拷贝后再改，旧镜像对象保持原样以便回滚。
                    const existingMirror = frame.summaryVectorIndexFrame && typeof frame.summaryVectorIndexFrame === 'object'
                        ? frame.summaryVectorIndexFrame
                        : null;
                    const mirror: SummaryVectorIndexMirrorFrameV2_ACU = existingMirror
                        ? { ...existingMirror, logEntries: [...(existingMirror.logEntries || [])] }
                        : { version: 3, sourceTableKey: selected.summaryKey, logEntries: [] };
                    let nextSeq = Math.max(0, ...(mirror.logEntries || []).map((entry) => Number(entry.seq) || 0));
                    const appendDelta = (
                        operations: SummaryVectorIndexMirrorOperationV2_ACU[],
                        deltaPack: typeof packPersist = null,
                        skippedRowCount?: number,
                    ) => {
                        if (operations.length === 0) return;
                        nextSeq += 1;
                        const delta: SummaryVectorIndexMirrorLogEntryV2_ACU = {
                            seq: nextSeq,
                            entryId: generateVectorDeltaEntryId_ACU(),
                            createdAt: Date.now(),
                            sourceTableEntry: {
                                entryId: plan.entryId,
                                commitRevision: plan.commitRevision,
                                messageIndex: plan.messageIndex,
                            },
                            embedding,
                            packRefs: deltaPack ? [deltaPack.ref] : [],
                            operations,
                            ...(skippedRowCount ? { skippedRowCount } : {}),
                        };
                        mirror.logEntries = [...(mirror.logEntries || []), delta];
                        writtenDeltaCount += 1;
                    };

                    // refresh 必须拆成同一来源 entry 的 remove/add 两条 delta：
                    // 既有链校验禁止同一 delta 内重复操作同一 rowId，而两条 delta
                    // 保持 rowId 身份不变并原子替换其 pack 引用。
                    const refreshesWithChunks = (plan.refreshed || []).filter((rowId) => (
                        (chunkRefsByRowId.get(rowId)?.length || 0) > 0
                    ));
                    appendDelta([
                        ...plan.removed.map((rowId): SummaryVectorIndexMirrorOperationV2_ACU => ({ kind: 'row_remove', rowId })),
                        ...refreshesWithChunks.map((rowId): SummaryVectorIndexMirrorOperationV2_ACU => ({ kind: 'row_remove', rowId })),
                    ]);

                    const additions = [...plan.added, ...refreshesWithChunks];
                    appendDelta(additions.flatMap((rowId) => {
                        const chunks = chunkRefsByRowId.get(rowId);
                        if (!chunks || chunks.length === 0) return [];
                        const row = rowsById.get(rowId);
                        return [{
                            kind: 'row_add' as const,
                            rowId,
                            chunks,
                            vectorSourceHash: row?.vectorSourceHash || '',
                        }];
                    }), packPersist, additions.filter((rowId) => !chunkRefsByRowId.has(rowId)).length || undefined);

                    undo.set(frame as any, 'summaryVectorIndexFrame', {
                        ...mirror,
                        sourceTableKey: selected.summaryKey,
                        logEntries: [...(mirror.logEntries || [])],
                    });
                }
                if (writtenDeltaCount === 0) return;
                await saveChatToHostStrict_ACU();
            });
        });
    } catch (error: any) {
        undo.rollback();
        // 提交失败 → 本次不会再 finalize，prepared pack 永远不会被引用（GC 出于保护 finalize 窗口
        // 而保留所有 prepared pack），不主动回收就会永久累积。走统一回收（含 ok 检查与 registry 注销）。
        if (packPersist?.file && packPersist.createdNew !== false) {
            await discardSummaryVectorMirrorPreparedFiles_ACU([packPersist.file], 'delta 提交失败');
        }
        if (error instanceof SummaryVectorFlushGenerationInvalidatedError_ACU) {
            // 与队列墓碑协议一致：任务已被作废，按跳过处理，不记失败、不重试。
            return emptyResult_ACU({ success: true, skipped: true, reason: 'flush_scope_invalidated' });
        }
        return emptyResult_ACU({
            reason: 'vector_mirror_commit_failed',
            errors: [error?.message || String(error || '镜像 delta 落盘失败')],
            retryability: 'retryable',
        });
    }

    if (packPersist && packPersist.createdNew !== false) {
        try {
            await finalizeSummaryVectorMirrorFiles_ACU([packPersist.file]);
        } catch (error: any) {
            logWarn_ACU('[向量镜像] pack 已写入聊天引用，但 registry 转 published 失败，保留 prepared 供 GC 观察:', error?.message || error);
        }
    }

    return {
        success: true,
        skipped: writtenDeltaCount === 0,
        indexedRowCount: addedRowIds.filter((rowId) => chunkRefsByRowId.has(rowId)).length,
        skippedRowCount: prepared.skippedRowCount + missingAdded.length,
        chunkCount: chunkSources.length,
        reason: writtenDeltaCount === 0 ? 'source_entries_gone' : undefined,
        errors: [],
        writtenDeltaCount,
    };
}

export function tablePersistTouchesSummarySheet_ACU(
    changedSheetKeys: string[] | undefined,
    writeSet: TableMutationWriteSetV2_ACU | undefined,
): boolean {
    const probe = { changedSheetKeys, writeSet, filledSheetKeys: [] as string[] };
    const sourceTableKey = findTouchedSummarySheetKey_ACU({ changedSheetKeys, writeSet });
    if (!sourceTableKey) return false;
    return tableEntryTouchesSheetV2_ACU(probe as any, sourceTableKey) || Boolean(sourceTableKey);
}
