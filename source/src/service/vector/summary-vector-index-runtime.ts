import { createEmbeddings_ACU } from '../../data/gateways/vector-embedding-gateway';
import { createRerankScores_ACU } from '../../data/gateways/vector-rerank-gateway';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { callAIWithPreset_ACU } from '../ai/api-call';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { globalMeta_ACU } from '../../data/repositories/profile-repo';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU } from '../worldbook/injection-engine';
import {
    createLorebookEntries_ACU,
    getLorebookEntries_ACU,
    isWorldbookApiAvailable_ACU,
    setLorebookEntries_ACU,
} from '../worldbook/worldbook-service';
import { getEffectiveSummaryVectorIndexConfig_ACU, validateSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import { enqueueSummaryVectorIndexFlush_ACU } from './summary-vector-index-flush-queue';
import {
    chatHasLegacySummaryVectorFields_ACU,
    rebuildSummaryVectorMirror_ACU,
} from './summary-vector-mirror-rebuild';
import { resolveSummaryVectorMirrorHead_ACU } from './summary-vector-mirror-resolver';
import {
    decodeSummaryVectorMirrorVector_ACU,
    loadSummaryVectorMirrorManifest_ACU,
    loadSummaryVectorMirrorPack_ACU,
} from './summary-vector-mirror-storage';
import { buildCurrentSummaryVectorEmbeddingIdentity_ACU } from './summary-vector-mirror-writer';
import type {
    ChatSummaryVectorIndexChunk_ACU,
    ChatSummaryVectorIndexRow_ACU,
    SummaryVectorMirrorHeadResult_ACU,
} from './summary-vector-index-types';
import {
    reciprocalRankFusion_ACU,
    sparseSearchBm25_ACU,
    type SummaryHybridCandidate_ACU,
} from './summary-vector-hybrid-retrieval';
import {
    buildPreparedRows_ACU,
    findSummaryTable_ACU,
    type SummaryVectorArchivePreparedRow_ACU,
} from './summary-vector-index-archive-service';

export interface SummaryVectorIndexRuntimeOptions_ACU {
    userInput?: string;
    source?: string;
    /**
     * 跳过 8s 去重窗口。仅供"索引自愈重建后在同一次发送里补跑召回"使用：
     * 第一次调用已登记签名，不绕过的话补跑会被当作重复钩子触发直接去重掉。
     */
    bypassDedupe?: boolean;
    /**
     * 发送租约：这次发送是否仍有效（未停止生成、未切走聊天）。返回 false 后迟到的召回结果不再写世界书，
     * 否则会把上一次发送、甚至另一个聊天的召回结果写进当前世界书。
     */
    isActive?: () => boolean;
}

export interface SummaryVectorIndexRuntimeResult_ACU {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    keywordCount?: number;
    candidateCount?: number;
    injectedCount?: number;
    denseCandidateCount?: number;
    sparseCandidateCount?: number;
    fusionCandidateCount?: number;
    /** rerank 阶段的实际结果：applied 才代表重排序真正参与了本轮选取。 */
    rerankStatus?: SummaryRerankStatus_ACU;
    rerankError?: string;
    /** 本轮送去 rerank 的 documents 条数（按行去重后）。 */
    rerankDocumentCount?: number;
    /** 关键词 AI 是否参与了本轮 query 构造。 */
    keywordGenerationEnabled?: boolean;
}

interface RankedSummaryCandidate_ACU extends SummaryHybridCandidate_ACU {
    chunk: ChatSummaryVectorIndexChunk_ACU;
    row: ChatSummaryVectorIndexRow_ACU;
    score: number;
    rerankScore?: number;
}

// T12：recent-fixed 注入项与排序候选的判别联合。recent_fixed 项不携带 chunk（无向量，
// 不参与 rerank / 排序），只提供 row 用于覆盖内容输出；ranked 项来自 dense/sparse/fusion。
type SummaryIndexSelectedCandidate_ACU =
    | { kind: 'recent_fixed'; row: ChatSummaryVectorIndexRow_ACU }
    | { kind: 'ranked'; chunk: ChatSummaryVectorIndexChunk_ACU; row: ChatSummaryVectorIndexRow_ACU; score: number; rerankScore?: number };

let lastRuntimeSignature_ACU = '';
let lastRuntimeAt_ACU = 0;
const SUMMARY_VECTOR_INDEX_RUNTIME_DEDUPE_MS_ACU = 8000;

/** 重置去重窗口状态（测试隔离用；生产路径依赖签名中的 chatKey 自然区分聊天）。 */
export function resetSummaryVectorIndexRuntimeDedupeState_ACU(): void {
    lastRuntimeSignature_ACU = '';
    lastRuntimeAt_ACU = 0;
}

function normalizeText_ACU(value: any): string {
    return String(value ?? '').trim();
}

function buildRecentContext_ACU(pairCount: number): string {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) return '';
    const limit = Math.max(2, Math.min(chat.length, Math.max(1, pairCount) * 2 + 2));
    return chat.slice(Math.max(0, chat.length - limit))
        .map((message: any) => {
            const role = message?.is_user ? '用户' : 'AI';
            const text = normalizeText_ACU(message?.mes).replace(/<[^>]+>/g, '').trim();
            return text ? `${role}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n');
}

function renderKeywordPromptMessages_ACU(segments: any[], variables: { recentContext: string; userInput: string }): any[] {
    return (Array.isArray(segments) ? segments : [])
        .map((segment) => ({
            role: ['system', 'assistant', 'user'].includes(String(segment?.role || '').toLowerCase())
                ? String(segment.role).toLowerCase()
                : 'user',
            content: normalizeText_ACU(segment?.content)
                .replace(/\$RECENT_CONTEXT/g, variables.recentContext)
                .replace(/\$USER_INPUT/g, variables.userInput),
        }))
        .filter((segment) => segment.content);
}

function extractTaggedContent_ACU(text: string, tagName: string): string {
    const source = String(text || '');
    const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = source.match(pattern);
    return match ? String(match[1] || '').trim() : '';
}

function stripThinkingBlocks_ACU(text: string): string {
    return String(text || '')
        .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<thought[^>]*>[\s\S]*?<\/thought>/gi, '')
        .replace(/<think(?![a-z])[^>]*>[\s\S]*?<\/think(?![a-z])>/gi, '')
        .replace(/<\/?(?:thinking|thought|think(?![a-z]))[^>]*>/gi, '')
        .trim();
}

function parseKeywords_ACU(text: string): string[] {
    const normalized = normalizeText_ACU(text);
    // 优先：从 <keywords> 标签提取
    let keywordContent = extractTaggedContent_ACU(normalized, 'keywords');
    // 回退：从 "关键词：" 前缀提取（兼容不遵循 XML 标签的 AI 输出）
    if (!keywordContent) {
        const stripped = stripThinkingBlocks_ACU(normalized);
        const fallbackMatch = stripped.match(/关键词[：:]\s*([\s\S]+?)$/i);
        if (fallbackMatch) {
            keywordContent = fallbackMatch[1].trim();
            logDebug_ACU('[交火模式纪要索引] AI 未使用 <keywords> 标签，已从"关键词："前缀回退提取。');
        }
    }
    if (!keywordContent) {
        logWarn_ACU('[交火模式纪要索引] AI 回复中未找到 <keywords> 标签或"关键词："前缀，跳过关键词提取。');
        return [];
    }
    return Array.from(new Set(keywordContent
        .replace(/<[^>]+>/g, '')
        .split(/[，,、\n;；|]/g)
        .map((item) => item.replace(/^[-*\d.、\s]+/, '').trim())
        .filter((item) => item.length > 0)
        .slice(0, 24)));
}

async function generateKeywords_ACU(config: any, userInput: string): Promise<string[]> {
    // 关键词 AI 默认关闭（TT 保守默认）：query 只用输入本身，省一次 LLM 往返；向量页开关可开。
    if (config.keywordGenerationEnabled !== true) return [];
    const recentContext = buildRecentContext_ACU(config.keywordContextPairCount || 1);
    const messages = renderKeywordPromptMessages_ACU(config.keywordPromptGroup || [], { recentContext, userInput });
    if (messages.length === 0) return [];
    const attempts = Math.max(1, Number(config.keywordGenerationMaxAttempts) || 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await callAIWithPreset_ACU(messages, config.keywordApiPreset || '', undefined, undefined, { sessionNamespace: 'summary' });
            const keywords = parseKeywords_ACU(response || '');
            if (keywords.length > 0) return keywords;
        } catch (error) {
            logWarn_ACU(`[交火模式纪要索引] 关键词生成失败 ${attempt}/${attempts}:`, error);
        }
    }
    return [];
}

// T10：query 向量模长预计算。与 cosineSimilarity_ACU 内部的 leftNorm 算法逐位一致，
// 外提后循环内不再重复累加 query 的平方和。
function computeVectorNorm_ACU(vector: number[] | Float32Array): number {
    if ((!Array.isArray(vector) && !(vector instanceof Float32Array)) || vector.length <= 0) return 0;
    let norm = 0;
    for (const value of vector) {
        const num = Number(value) || 0;
        norm += num * num;
    }
    return Math.sqrt(norm);
}

// T10：cosine 相似度，query 模长由调用方预计算传入（循环内只算点积与候选模长）。
// T2：维度不一致直接返回 0，不再截断后照常打分——截断会把混维向量静默当成相似，
// 产生错误召回且难以察觉。维度一致的路径与改动前逐项等价。
function cosineSimilarity_ACU(left: number[] | Float32Array, right: number[] | Float32Array, leftNorm: number): number {
    if ((!Array.isArray(left) && !(left instanceof Float32Array))
        || (!Array.isArray(right) && !(right instanceof Float32Array))
        || left.length !== right.length || left.length <= 0) return 0;
    const length = left.length;
    let dot = 0;
    let rightNorm = 0;
    for (let index = 0; index < length; index += 1) {
        const a = Number(left[index]) || 0;
        const b = Number(right[index]) || 0;
        dot += a * b;
        rightNorm += b * b;
    }
    if (leftNorm <= 0 || rightNorm <= 0) return 0;
    return dot / (leftNorm * Math.sqrt(rightNorm));
}

export type SummaryRerankStatus_ACU = 'applied' | 'not_configured' | 'no_candidates' | 'skipped_within_topk' | 'empty_response' | 'failed';

/** Rerank 阶段的结果：candidates 始终可用；未应用时 status 说明原因，供结果对象与日志透出。 */
interface SummaryRerankOutcome_ACU {
    candidates: RankedSummaryCandidate_ACU[];
    status: SummaryRerankStatus_ACU;
    error?: string;
    /** 实际送去 rerank 的 documents 条数（按行去重后）。 */
    documentCount?: number;
}

/**
 * 融合候选按行去重：一行可能有多个 chunk 命中，选取与注入都以行为单位，
 * rerank 也只需要给每行打一次分。保留每行融合分最高（首次出现）的候选。
 */
function dedupeCandidatesByRow_ACU(candidates: RankedSummaryCandidate_ACU[]): RankedSummaryCandidate_ACU[] {
    const seen = new Set<string>();
    const result: RankedSummaryCandidate_ACU[] = [];
    for (const candidate of candidates) {
        const rowKey = candidate.row.rowKey;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);
        result.push(candidate);
    }
    return result;
}

/**
 * Rerank 的 document 用实时纪要表的正文（概览 + 纪要）而不是 chunk 文本：
 * 交叉编码器的优势在长文本细粒度匹配，喂它 30 字概览等于把它当 embedding 用。
 * 读不到实时正文（模板无纪要列 / 表未加载）时回退到 chunk 文本。
 */
function buildRerankDocument_ACU(candidate: RankedSummaryCandidate_ACU, live: LiveSummaryVectorRows_ACU | null): string {
    const liveRow = live?.byRowId.get(candidate.row.rowId);
    const summary = normalizeText_ACU(liveRow?.summary || candidate.row.summary);
    const chronicle = normalizeText_ACU(liveRow?.chronicleText);
    const combined = [summary, chronicle].filter(Boolean).join('\n');
    return combined || normalizeText_ACU(candidate.chunk.text);
}

// P4：统一走 vector-rerank-gateway 网关（超时可中断、安全 JSON 解析），消除此前内联 fetch 与网关的双实现漂移。
// 失败时保留既有语义：回退 embedding 排序——但用户明确配置了 rerank 却每次都失败，必须以 error 级别透出，
// warn 级别默认关闭时会让「rerank 从未生效」完全不可见。
async function rerankCandidates_ACU(
    config: any,
    query: string,
    candidates: RankedSummaryCandidate_ACU[],
    live: LiveSummaryVectorRows_ACU | null,
): Promise<SummaryRerankOutcome_ACU> {
    const endpoint = normalizeText_ACU(config.rerankEndpoint);
    const model = normalizeText_ACU(config.rerankModel);
    if (!endpoint || !model) return { candidates, status: 'not_configured' };
    if (candidates.length === 0) return { candidates, status: 'no_candidates' };
    const rowCandidates = dedupeCandidatesByRow_ACU(candidates);
    const topK = Math.max(1, Math.floor(Number(config.topK) || 1));
    // 池子不比 topK 大，rerank 改变不了"谁进目录"，只是白花一次请求。
    if (rowCandidates.length <= topK) {
        logDebug_ACU(`[交火模式纪要索引] 候选行 ${rowCandidates.length} ≤ topK ${topK}，跳过 rerank。`);
        return { candidates: rowCandidates, status: 'skipped_within_topk', documentCount: 0 };
    }
    try {
        const documents = rowCandidates.map((candidate) => buildRerankDocument_ACU(candidate, live));
        const results = await createRerankScores_ACU({
            endpoint,
            model,
            apiKey: normalizeText_ACU(config.rerankApiKey) || undefined,
            query,
            documents,
            instruction: normalizeText_ACU(config.rerankInstruction) || undefined,
            batchSize: config.rerankBatchSize,
        });
        const byIndex = new Map<number, number>();
        results.forEach((item) => {
            if (item.index >= 0 && item.index < rowCandidates.length) byIndex.set(item.index, item.relevanceScore);
        });
        if (byIndex.size === 0) {
            logWarn_ACU(`[交火模式纪要索引] Rerank 响应没有任何可用的评分（endpoint=${endpoint}, model=${model}），本轮回退到 Embedding 排序。请检查服务商返回格式是否为 results[].index / relevance_score。`);
            return { candidates: rowCandidates, status: 'empty_response', error: 'rerank 响应中没有可用评分', documentCount: documents.length };
        }
        return {
            status: 'applied',
            documentCount: documents.length,
            candidates: rowCandidates
                .map((candidate, index) => ({ ...candidate, rerankScore: byIndex.get(index) ?? candidate.score }))
                .sort((left, right) => (right.rerankScore ?? right.score) - (left.rerankScore ?? left.score)),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError_ACU(`[交火模式纪要索引] Rerank 调用失败（endpoint=${endpoint}, model=${model}），本轮回退到 Embedding 排序：${message}`);
        return { candidates: rowCandidates, status: 'failed', error: message };
    }
}

function escapeMarkdownTableCell_ACU(value: any): string {
    return normalizeText_ACU(value)
        .replace(/\r?\n+/g, '<br>')
        .replace(/\|/g, '\\|');
}

function buildSummaryIndexOverwriteContent_ACU(candidates: SummaryIndexSelectedCandidate_ACU[]): string {
    const selectedRows = (Array.isArray(candidates) ? candidates : [])
        .map((candidate) => candidate.row)
        .filter((row): row is ChatSummaryVectorIndexRow_ACU => !!row)
        .sort((left, right) => (Number(left.rowOrder) || 0) - (Number(right.rowOrder) || 0));

    const lines = [
        '# 纪要索引',
        '',
        '| 时间 | 地点 | 概要 | 编码索引 |',
        '|---|---|---|---|',
    ];

    selectedRows.forEach((row) => {
        lines.push(`| ${escapeMarkdownTableCell_ACU(row.timeSpan)} | ${escapeMarkdownTableCell_ACU(row.location)} | ${escapeMarkdownTableCell_ACU(row.summary)} | ${escapeMarkdownTableCell_ACU(row.indexCode)} |`);
    });

    if (selectedRows.length === 0) {
        lines.push('|  |  | （无命中纪要） |  |');
    }

    return lines.join('\n');
}

/** 返回 false 表示这次发送已失效、未写入。 */
async function upsertOriginalSummaryIndexEntry_ACU(content: string, isActive: () => boolean): Promise<boolean> {
    if (!isWorldbookApiAvailable_ACU()) return true;
    const targetLorebook = await getInjectionTargetLorebook_ACU();
    if (!targetLorebook) return true;

    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const comment = `${getIsolationPrefix_ACU()}TavernDB-ACU-CustomExport-纪要索引`;
    const entries = await getLorebookEntries_ACU(targetLorebook);
    const existing = entries.find((entry: any) => entry?.comment === comment);
    const enabled = existing?.enabled ?? (worldbookConfig?.zeroTkOccupyMode !== true);
    const nextEntry = {
        ...(existing || {}),
        comment,
        content,
        keys: Array.isArray(existing?.keys) ? existing.keys : [],
        enabled,
        type: 'constant',
        order: Number.isFinite(Number(existing?.order)) ? Number(existing.order) : 10000,
        prevent_recursion: true,
    };

    // 读世界书也要等待：写入前最后再核对一次这次发送仍有效
    if (!isActive()) return false;
    if (existing?.uid != null) {
        await setLorebookEntries_ACU(targetLorebook, [{ ...nextEntry, uid: existing.uid }]);
    } else {
        await createLorebookEntries_ACU(targetLorebook, [nextEntry]);
    }
    return true;
}

const SEND_CANCELLED_RESULT_ACU: SummaryVectorIndexRuntimeResult_ACU = { success: false, skipped: true, reason: 'send_cancelled' };

interface LiveSummaryVectorRows_ACU {
    summaryKey: string;
    rows: SummaryVectorArchivePreparedRow_ACU[];
    byRowKey: Map<string, SummaryVectorArchivePreparedRow_ACU>;
    byRowId: Map<string, SummaryVectorArchivePreparedRow_ACU>;
}

function buildLiveSummaryVectorRows_ACU(): LiveSummaryVectorRows_ACU | null {
    const selected = findSummaryTable_ACU();
    if (!selected?.summaryKey || !selected.table) return null;
    const prepared = buildPreparedRows_ACU(selected.table, selected.summaryKey);
    if (prepared.error) {
        logWarn_ACU('[交火模式纪要索引] 实时纪要表解析失败，跳过发送前对账:', prepared.error);
        return null;
    }
    const rows = Array.isArray(prepared.rows) ? prepared.rows : [];
    return {
        summaryKey: selected.summaryKey,
        rows,
        byRowKey: new Map(rows.map((row) => [row.rowKey, row])),
        byRowId: new Map(rows.map((row) => [row.rowId, row])),
    };
}

function filterRowsByLiveSummaryTable_ACU(
    rows: ChatSummaryVectorIndexRow_ACU[],
    live: LiveSummaryVectorRows_ACU | null,
): { rows: ChatSummaryVectorIndexRow_ACU[]; changed: boolean } {
    if (!live) return { rows, changed: false };
    const indexedRowIds = new Set(rows.map((row) => row.rowId).filter(Boolean));
    const filtered = rows.filter((row) => {
        const liveRow = live.byRowId.get(row.rowId);
        if (!liveRow) return false;
        return true;
    }).map((row) => {
        const liveRow = live.byRowId.get(row.rowId)!;
        return {
            ...row,
            rowOrder: liveRow.rowOrder,
            timeSpan: liveRow.timeSpan,
            location: liveRow.location,
            summary: liveRow.summary,
            indexCode: liveRow.indexCode,
        };
    });
    const liveHasUnindexedRows = live.rows.some((row) => !indexedRowIds.has(row.rowId));
    return {
        rows: filtered,
        changed: filtered.length !== rows.length || liveHasUnindexedRows,
    };
}

function filterChunksByLiveSummaryTable_ACU(
    chunks: ChatSummaryVectorIndexChunk_ACU[],
    rows: ChatSummaryVectorIndexRow_ACU[],
): { chunks: ChatSummaryVectorIndexChunk_ACU[]; changed: boolean } {
    const activeRowKeys = new Set(rows.map((row) => row.rowKey));
    const filtered = chunks.filter((chunk) => {
        return activeRowKeys.has(chunk.rowKey);
    });
    return { chunks: filtered, changed: filtered.length !== chunks.length };
}

async function materializeSummaryVectorMirrorHead_ACU(
    head: SummaryVectorMirrorHeadResult_ACU,
    live: LiveSummaryVectorRows_ACU | null,
): Promise<{
    rows: ChatSummaryVectorIndexRow_ACU[];
    chunks: ChatSummaryVectorIndexChunk_ACU[];
    incompleteRowIds: Set<string>;
    contentMismatchedRowIds: Set<string>;
}> {
    const packByHash = new Map<string, Awaited<ReturnType<typeof loadSummaryVectorMirrorPack_ACU>>>();
    for (const packRef of head.packRefs) {
        const pack = await loadSummaryVectorMirrorPack_ACU(packRef);
        if (pack) packByHash.set(packRef.packHash, pack);
    }
    const rows: ChatSummaryVectorIndexRow_ACU[] = [];
    const chunks: ChatSummaryVectorIndexChunk_ACU[] = [];
    const incompleteRowIds = new Set<string>();
    const contentMismatchedRowIds = new Set<string>();
    let fallbackOrder = 0;
    for (const [rowId, refs] of head.head) {
        const liveRow = live?.byRowId.get(rowId);
        const chunkIds: string[] = [];
        const rowChunks: ChatSummaryVectorIndexChunk_ACU[] = [];
        const liveSourceHash = normalizeText_ACU(liveRow?.vectorSourceHash);
        let contentMismatch = false;
        refs.forEach((ref, sequence) => {
            const packed = packByHash.get(ref.packHash)?.chunks?.[ref.chunkIndex];
            if (!packed) return;
            if (liveSourceHash && normalizeText_ACU(packed.textHash) !== liveSourceHash) {
                contentMismatch = true;
            }
            const chunkId = `${rowId}:${sequence}`;
            chunkIds.push(chunkId);
            rowChunks.push({
                chunkId,
                rowKey: liveRow?.rowKey || rowId,
                rowOrder: liveRow?.rowOrder ?? fallbackOrder,
                text: String(packed.text || ''),
                vector: decodeSummaryVectorMirrorVector_ACU(String(packed.vector || '')),
                sequence,
                textHash: packed.textHash,
            });
        });
        if (refs.length === 0 || chunkIds.length !== refs.length) incompleteRowIds.add(rowId);
        if (chunkIds.length === 0) continue;
        if (contentMismatch) {
            contentMismatchedRowIds.add(rowId);
            continue;
        }
        chunks.push(...rowChunks);
        rows.push({
            rowKey: liveRow?.rowKey || rowId,
            rowId,
            rowOrder: liveRow?.rowOrder ?? fallbackOrder,
            timeSpan: liveRow?.timeSpan || '',
            location: liveRow?.location || '',
            summary: liveRow?.summary || '',
            indexCode: liveRow?.indexCode || '',
            vectorSourceText: liveRow?.vectorSourceText || '',
            ...(liveRow?.vectorSourceHash ? { vectorSourceHash: liveRow.vectorSourceHash } : {}),
            chunkIds,
        });
        fallbackOrder += 1;
    }
    return { rows, chunks, incompleteRowIds, contentMismatchedRowIds };
}

// 向量模型上下文较小（如 512 token）时，长消息整段送去会被拒；截短后重试一次。
const EMBEDDING_QUERY_RETRY_MAX_CHARS_ACU = 300;

export async function processSummaryVectorIndexBeforeGeneration_ACU(
    options: SummaryVectorIndexRuntimeOptions_ACU = {},
): Promise<SummaryVectorIndexRuntimeResult_ACU> {
    try {
        const result = await runSummaryVectorRecall_ACU(options);
        // 失败或这次发送已作废：放掉 8 秒去重签名，否则马上重发同一句会被当成「已召回过」直接放行
        if ((result.success !== true && result.skipped !== true) || result.reason === 'send_cancelled') {
            resetSummaryVectorIndexRuntimeDedupeState_ACU();
        }
        return result;
    } catch (error) {
        resetSummaryVectorIndexRuntimeDedupeState_ACU();
        throw error;
    }
}

async function runSummaryVectorRecall_ACU(
    options: SummaryVectorIndexRuntimeOptions_ACU,
): Promise<SummaryVectorIndexRuntimeResult_ACU> {
    const isActive = (): boolean => options.isActive?.() !== false;
    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const globalEnabled = globalMeta_ACU?.summaryVectorIndexModeGlobal === true;
    if (!globalEnabled) {
        logDebug_ACU(`[交火模式纪要索引] 全局开关未启用，跳过发送前处理。worldbookProjection=${worldbookConfig.summaryVectorIndexModeEnabled === true}`);
        return { success: false, skipped: true, reason: 'summary_vector_index_disabled' };
    }
    if (worldbookConfig.summaryVectorMirrorEnabled === false) {
        logDebug_ACU('[交火模式纪要索引] 向量镜像开关已关闭，跳过发送前召回。');
        return { success: false, skipped: true, reason: 'summary_vector_mirror_disabled' };
    }
    const userInput = normalizeText_ACU(options.userInput);
    if (!userInput) return { success: false, skipped: true, reason: 'empty_user_input' };
    // P3：去重签名不含 source——同一次发送会经由 TavernHelper 包装与
    // GENERATION_AFTER_COMMANDS 两个钩子各触发一次，source 不同导致签名不同、
    // 完整链路（关键词 AI + embedding + rerank + 世界书写回）跑两遍。
    // 加入 chatKey 防止切换聊天后相同文本被跨聊天误去重。
    const signature = `${String(currentChatFileIdentifier_ACU || '')}:${userInput}`;
    if (!options.bypassDedupe && signature === lastRuntimeSignature_ACU && Date.now() - lastRuntimeAt_ACU <= SUMMARY_VECTOR_INDEX_RUNTIME_DEDUPE_MS_ACU) {
        logDebug_ACU(`[交火模式纪要索引] 8s 窗口内重复触发已去重：source=${options.source || 'unknown'}`);
        return { success: true, skipped: true, reason: 'deduped' };
    }
    lastRuntimeSignature_ACU = signature;
    lastRuntimeAt_ACU = Date.now();

    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const validation = validateSummaryVectorIndexConfig_ACU(config);
    if (!validation.valid) {
        logWarn_ACU('[交火模式纪要索引] 配置无效，跳过发送前注入:', validation.errors.join('; '));
        return { success: false, skipped: true, reason: 'invalid_config' };
    }

    const chat = getChatArray_ACU();
    const isolationKey = getCurrentIsolationKey_ACU();
    const selectedSummary = findSummaryTable_ACU();
    if (!selectedSummary?.summaryKey) {
        return { success: false, skipped: true, reason: 'summary_table_not_found' };
    }
    const liveRows = buildLiveSummaryVectorRows_ACU();
    const resolveHead = () => resolveSummaryVectorMirrorHead_ACU({
        chat,
        isolationKey,
        sourceTableKey: selectedSummary.summaryKey,
        embedding: buildCurrentSummaryVectorEmbeddingIdentity_ACU(),
        loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref),
    });
    let head = await resolveHead();
    const shouldAutoRepair = head.chainConflict
        || head.status === 'checkpoint_mismatch'
        || head.status === 'manifest_unavailable';
    if (shouldAutoRepair) {
        const repaired = await rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_repair' });
        if (repaired.success && !repaired.skipped) {
            head = await resolveHead();
        }
    }
    if (head.status === 'no_mirror') {
        if (chatHasLegacySummaryVectorFields_ACU(chat)) {
            return { success: false, skipped: true, reason: 'legacy_vector_scheme_rebuild_required' };
        }
        return { success: false, skipped: true, reason: 'no_mirror' };
    }
    if (head.status === 'embedding_identity_changed') {
        return { success: false, skipped: true, reason: 'embedding_identity_changed_rebuild_required' };
    }
    if (head.status !== 'ok') {
        return { success: false, skipped: true, reason: `mirror_${head.status}` };
    }
    const materialized = await materializeSummaryVectorMirrorHead_ACU(head, liveRows);
    if (
        head.head.size > 0
        && (
            materialized.rows.length === 0
            || materialized.incompleteRowIds.size > 0
            || materialized.contentMismatchedRowIds.size > 0
        )
    ) {
        const repaired = await rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_repair' });
        if (repaired.success && !repaired.skipped) {
            head = await resolveHead();
            if (head.status === 'ok') {
                const retried = await materializeSummaryVectorMirrorHead_ACU(head, liveRows);
                materialized.rows = retried.rows;
                materialized.chunks = retried.chunks;
                materialized.incompleteRowIds = retried.incompleteRowIds;
                materialized.contentMismatchedRowIds = retried.contentMismatchedRowIds;
            }
        }
    }
    if (materialized.incompleteRowIds.size > 0) {
        logWarn_ACU('[交火模式纪要索引] pack/chunk 引用仍不完整，拒绝使用残缺索引:', {
            rowIds: [...materialized.incompleteRowIds],
        });
        return { success: false, skipped: true, reason: 'mirror_pack_incomplete' };
    }
    if (materialized.contentMismatchedRowIds.size > 0) {
        return { success: false, skipped: true, reason: 'mirror_content_hash_mismatch' };
    }
    let rows: ChatSummaryVectorIndexRow_ACU[] = materialized.rows;
    let chunks: ChatSummaryVectorIndexChunk_ACU[] = materialized.chunks;
    const state = {
        manifest: {
            indexId: head.vectorRevision,
            storageIdentity: { writeGeneration: head.vectorRevision },
        },
    };
    const reconciledRows = filterRowsByLiveSummaryTable_ACU(rows, liveRows);
    rows = reconciledRows.rows;
    const reconciledChunks = filterChunksByLiveSummaryTable_ACU(chunks, rows);
    chunks = reconciledChunks.chunks;
    const stale = head.stale || reconciledRows.changed || reconciledChunks.changed;
    if (stale) {
        logWarn_ACU('[交火模式纪要索引] head 与实时纪要表不一致，按交集召回并入队 flush，不中断发送。');
        void enqueueSummaryVectorIndexFlush_ACU({
            sourceTableKey: selectedSummary.summaryKey,
            reason: 'runtime_stale_intersection',
        }).catch((error: any) => {
            logWarn_ACU('[交火模式纪要索引] stale 入队失败:', error?.message || error);
        });
    }
    if (rows.length < config.summaryIndexKeywordMinRows) {
        return { success: false, skipped: true, reason: 'below_min_rows' };
    }
    if (chunks.length === 0) {
        return { success: false, skipped: true, reason: 'no_chunks' };
    }

    const rowByKey = new Map(rows.map((row) => [row.rowKey, row]));

    // ── 最近 X 条固定注入：按 rowOrder 降序取最近 X 行 ──
    const recentFixedCount = Math.max(0, Math.min(
        config.summaryIndexRecentFixedInjectCount || 0,
        rows.length,
    ));
    const rowsSortedByOrderDesc = [...rows].sort(
        (left, right) => (Number(right.rowOrder) || 0) - (Number(left.rowOrder) || 0),
    );
    const recentFixedRows = rowsSortedByOrderDesc.slice(0, recentFixedCount);
    const recentFixedRowKeys = new Set(recentFixedRows.map((row) => row.rowKey));
    // 较早的行（不参与排序的候选池）
    const olderRows = rows.filter((row) => !recentFixedRowKeys.has(row.rowKey));

    // query embedding（含关键词 AI）失败即本次召回失败，由发送层停止这次生成（移植上游 2adf068b）：
    // 宁可不发，也不带着残缺的记忆发。不再降级为只注入最近固定行。
    let keywords: string[] = [];
    let queryText = '';
    let queryVector: number[] | Float32Array = [];
    try {
        keywords = await generateKeywords_ACU(config, userInput);
        queryText = [userInput, keywords.join('，')].filter(Boolean).join('\n关键词：');
        const embedQuery = async (input: string) => (await createEmbeddings_ACU({
            endpoint: config.embeddingEndpoint,
            apiKey: config.embeddingApiKey,
            model: config.embeddingModel,
            input: [input],
        }))[0]?.embedding || [];
        try {
            queryVector = await embedQuery(queryText);
        } catch (error) {
            // 输入本身过长被向量模型拒绝时，同一条长消息每次都会失败、永远发不出去：截短重试一次
            if (queryText.length <= EMBEDDING_QUERY_RETRY_MAX_CHARS_ACU || !isActive()) throw error;
            logWarn_ACU('[交火模式纪要索引] query embedding 失败，截短查询后重试一次:', error);
            const shortQuery = [userInput.slice(0, EMBEDDING_QUERY_RETRY_MAX_CHARS_ACU), keywords.join('，')].filter(Boolean).join('\n关键词：');
            queryVector = await embedQuery(shortQuery);
        }
        if (queryVector.length === 0) {
            logWarn_ACU('[交火模式纪要索引] query embedding 返回空向量，本次召回失败:', userInput);
            return { success: false, reason: 'empty_query_embedding' };
        }
    } catch (error) {
        if (!isActive()) return SEND_CANCELLED_RESULT_ACU;
        logWarn_ACU('[交火模式纪要索引] query embedding 失败，本次召回失败:', error);
        return { success: false, reason: 'query_embedding_failed' };
    }

    // 只对较早行的 chunks 做向量匹配
    const olderRowKeys = new Set(olderRows.map((row) => row.rowKey));
    const olderChunks = chunks.filter((chunk) => olderRowKeys.has(chunk.rowKey));

    const searchableCandidates: SummaryHybridCandidate_ACU[] = olderChunks
        .map((chunk): RankedSummaryCandidate_ACU | null => {
            const row = rowByKey.get(chunk.rowKey);
            if (!row) return null;
            return { chunk, row, score: 0 };
        })
        .filter((candidate): candidate is RankedSummaryCandidate_ACU => !!candidate);

    // T10：query 模长只算一次，循环内只做点积与候选模长（与原实现逐位等价）。
    const queryNorm = computeVectorNorm_ACU(queryVector);
    const denseCandidates = searchableCandidates
        .map((candidate): RankedSummaryCandidate_ACU | null => {
            const chunk = candidate.chunk;
            if ((!Array.isArray(chunk.vector) && !((chunk.vector as any) instanceof Float32Array)) || chunk.vector.length === 0) return null;
            const score = cosineSimilarity_ACU(queryVector, chunk.vector, queryNorm);
            if (score < config.summaryIndexMinScore) return null;
            return { ...candidate, score, denseScore: score };
        })
        .filter((candidate): candidate is RankedSummaryCandidate_ACU => !!candidate)
        .sort((left, right) => right.score - left.score)
        .slice(0, config.summaryIndexCandidateLimit);

    // T10：BM25 语料缓存键。候选集（searchableCandidates）的 chunk 集合指纹保证
    // recentFixedCount / config 变化导致候选集变化时缓存自然失效；V2 快照的
    // writeGeneration 唯一标识一次归档内容（不可变身份），作为前缀避免跨快照误用。
    const bm25CacheKey = `${head.vectorRevision || 'legacy'}::${state.manifest?.indexId || ''}::${searchableCandidates
        .map((candidate) => candidate.chunk.textHash || candidate.chunk.chunkId || candidate.chunk.text)
        .join('|')}`;
    const sparseCandidates = config.summaryIndexHybridRetrievalEnabled
        ? sparseSearchBm25_ACU(queryText, searchableCandidates, config.summaryIndexBm25CandidateLimit, bm25CacheKey)
        : [];

    const fusionLimit = Math.max(config.summaryIndexCandidateLimit, config.topK);
    const candidates = config.summaryIndexHybridRetrievalEnabled
        ? reciprocalRankFusion_ACU([denseCandidates, sparseCandidates], config.summaryIndexRrfK, fusionLimit) as RankedSummaryCandidate_ACU[]
        : denseCandidates;

    logDebug_ACU(
        `[交火模式纪要索引] 混合召回候选：dense=${denseCandidates.length}, bm25=${sparseCandidates.length}, fusion=${candidates.length}, hybrid=${config.summaryIndexHybridRetrievalEnabled === true}`,
    );

    if (candidates.length === 0 && recentFixedRows.length === 0) {
        return { success: false, skipped: true, reason: 'no_candidates', keywordCount: keywords.length, denseCandidateCount: denseCandidates.length, sparseCandidateCount: sparseCandidates.length, fusionCandidateCount: candidates.length };
    }

    // Rerank 只处理较早行的候选；document 取实时纪要正文，候选行不多于 topK 时跳过。
    const rerank = await rerankCandidates_ACU(config, queryText, candidates, liveRows);
    const selectedByRow = new Map<string, SummaryIndexSelectedCandidate_ACU>();
    for (const candidate of rerank.candidates) {
        if (!selectedByRow.has(candidate.row.rowKey)) selectedByRow.set(candidate.row.rowKey, { kind: 'ranked', chunk: candidate.chunk, row: candidate.row, score: candidate.score, rerankScore: candidate.rerankScore });
        if (selectedByRow.size >= config.topK) break;
    }

    // 合并：最近固定行 + TopK 排序行（去重，固定行优先）
    for (const row of recentFixedRows) {
        if (!selectedByRow.has(row.rowKey)) {
            selectedByRow.set(row.rowKey, { kind: 'recent_fixed', row });
        }
    }
    const selected = Array.from(selectedByRow.values())
        .sort((left, right) => (Number(left.row.rowOrder) || 0) - (Number(right.row.rowOrder) || 0));
    const keywordGenerationEnabled = config.keywordGenerationEnabled === true;
    if (selected.length === 0) {
        return { success: false, skipped: true, reason: 'no_selected_rows', keywordCount: keywords.length, candidateCount: candidates.length, denseCandidateCount: denseCandidates.length, sparseCandidateCount: sparseCandidates.length, fusionCandidateCount: candidates.length, rerankStatus: rerank.status, rerankError: rerank.error, rerankDocumentCount: rerank.documentCount, keywordGenerationEnabled };
    }

    const content = buildSummaryIndexOverwriteContent_ACU(selected);
    if (!isActive() || !(await upsertOriginalSummaryIndexEntry_ACU(content, isActive))) return SEND_CANCELLED_RESULT_ACU;
    logDebug_ACU(
        `[交火模式纪要索引] 已覆盖原概要索引条目：${selected.length} 条（其中固定注入 ${recentFixedRows.length} 条，排序选取 ${selected.length - recentFixedRows.length} 条），关键词 ${keywords.length} 个（关键词 AI ${keywordGenerationEnabled ? '开' : '关'}），rerank=${rerank.status}${rerank.documentCount ? `（${rerank.documentCount} 条 documents）` : ''}，输出顺序按纪要表原 rowOrder。`,
    );
    return { success: true, keywordCount: keywords.length, candidateCount: candidates.length, injectedCount: selected.length, denseCandidateCount: denseCandidates.length, sparseCandidateCount: sparseCandidates.length, fusionCandidateCount: candidates.length, rerankStatus: rerank.status, rerankError: rerank.error, rerankDocumentCount: rerank.documentCount, keywordGenerationEnabled };
}
