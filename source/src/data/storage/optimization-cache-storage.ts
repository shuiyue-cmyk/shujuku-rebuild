/**
 * data/storage/optimization-cache-storage.ts — 正文优化浏览器侧缓存适配器
 *
 * 封装正文优化在浏览器侧的两份缓存（window 对象 + localStorage 两层）：
 *   1. 最近一次优化的基础正文（baseContent）——供「重新优化」找回原文；
 *   2. 自动正文替换「已处理集合」（messageId + 写回后内容指纹）——供自动链判重，
 *      避免宿主多派发一条 GENERATION_ENDED 时同一楼再烧一次 API。容量按 updatedAt 裁剪。
 *   3. 自动填表「已处理集合」（仅 messageId，不比对内容）——与 2 分键分集合，
 *      避免同一条回声 ENDED 再拉一次自动填表；两条链完成时机与基准不同，不得互相污染。
 * 这是运行时缓存，不是持久化数据，丢失不影响功能正确性（最坏退化成少一次跳过）。
 *
 * 写入顺序：window 对象 → localStorage
 * 读取优先级：window 对象 → localStorage（与原 service 层逻辑一致）
 */

import { topLevelWindow_ACU } from '../../shared/env';
import { logDebug_ACU } from '../../shared/utils';

const WINDOW_CACHE_KEY = '__ACU_LAST_OPTIMIZATION_BASE__';
const LOCAL_STORAGE_KEY = 'ACU_LAST_OPTIMIZATION_BASE';
const PROCESSED_WINDOW_KEY = '__ACU_CONTENT_OPTIMIZATION_PROCESSED__';
const PROCESSED_LOCAL_STORAGE_KEY = 'ACU_CONTENT_OPTIMIZATION_PROCESSED';
const AUTO_TABLE_FILL_WINDOW_KEY = '__ACU_AUTO_TABLE_FILL_PROCESSED__';
const AUTO_TABLE_FILL_LOCAL_STORAGE_KEY = 'ACU_AUTO_TABLE_FILL_PROCESSED';

/** 自动正文替换「已处理集合」容量上限（按 updatedAt 裁剪，防无界增长）。 */
export const AUTO_OPTIMIZATION_PROCESSED_LIMIT_ACU = 20;
/** 自动填表「已处理集合」容量上限（与正文替换链分集合，互不污染）。 */
export const AUTO_TABLE_FILL_PROCESSED_LIMIT_ACU = 20;

/**
 * 兼容旧命名：正文自动替换链的已处理条目。
 * 实际类型（含 chain 字段）见文件底部「自动链回声防重」一节。
 */
export type AutoOptimizationProcessedEntry_ACU = AutoChainProcessedEntry_ACU;

/**
 * 将正文优化基础缓存写入浏览器侧存储（window + localStorage）
 * @param cache 要缓存的数据对象
 */
export function saveOptimizationBaseToCache_ACU(cache: unknown): void {
    // 第一层：写入 window 对象（跨 iframe 可访问）
    try {
        const targetWindow = topLevelWindow_ACU || window;
        (targetWindow as any)[WINDOW_CACHE_KEY] = cache;
    } catch (error) {
        logDebug_ACU('[正文优化] 写入浏览器侧正文优化基础缓存失败（window）:', error);
    }

    // 第二层：写入 localStorage（持久化到浏览器）
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cache));
    } catch (error) {
        logDebug_ACU('[正文优化] 写入浏览器侧正文优化基础缓存失败（localStorage）:', error);
    }
}

/**
 * 从浏览器侧存储读取正文优化基础缓存
 * 优先级：window 对象 → localStorage
 * @returns 缓存数据对象，不存在或解析失败返回 null
 */
export function loadOptimizationBaseFromCache_ACU(): any | null {
    // 第一层：尝试从 window 对象读取
    try {
        const targetWindow = topLevelWindow_ACU || window;
        const windowCache = (targetWindow as any)[WINDOW_CACHE_KEY];
        if (windowCache?.baseContent) {
            return windowCache;
        }
    } catch (error) {
        logDebug_ACU('[正文优化] 读取浏览器侧正文优化基础缓存失败（window）:', error);
    }

    // 第二层：尝试从 localStorage 读取
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.baseContent) {
                return parsed;
            }
        }
    } catch (error) {
        logDebug_ACU('[正文优化] 读取浏览器侧正文优化基础缓存失败（localStorage）:', error);
    }

    return null;
}

// ═══ [自动链回声防重] 已处理集合（chain + messageId 判重）═══
// 两条自动链各用一个独立集合（独立 window/localStorage 键），完成时机与判定基准都不同，绝不互相污染：
//   · content_replacement：正文自动替换，比对「写回后内容指纹」——写回会改楼层内容，指纹即完成凭证；
//   · auto_table_fill：自动填表，只比对 messageId——填表成功后楼层内容仍可能被别的链改动
//     （例如正文替换写回），拿内容当基准会被自家改动骗发第二次填表。
// 丢失该缓存只会退化成「少一次跳过」，不影响正确性；切聊天/删楼层后旧记录自然失配，无需主动清理。

/** 自动链标识。 */
export type AutoChainProcessedKind_ACU = 'content_replacement' | 'auto_table_fill';

/**
 * 已处理条目：与 setLastOptimizationBase_ACU 的既有形状一致（messageIndex / messageId / updatedAt），
 * 正文替换链把 baseContent 换成 contentHash（写回后消息内容指纹）避免整段正文进 localStorage；
 * 填表链不比对内容，contentHash 允许为空。
 */
export interface AutoChainProcessedEntry_ACU {
    chain: AutoChainProcessedKind_ACU;
    messageIndex: number;
    messageId: string;
    contentHash: string;
    chatKey: string;
    updatedAt: number;
}

interface ProcessedStore_ACU {
    chain: AutoChainProcessedKind_ACU;
    windowKey: string;
    localStorageKey: string;
    label: string;
    /** true = 该链以内容指纹为完成凭证，缺指纹的记录一律视为非法。 */
    requireContentHash: boolean;
    limit: number;
}

const PROCESSED_STORES: Record<AutoChainProcessedKind_ACU, ProcessedStore_ACU> = {
    content_replacement: {
        chain: 'content_replacement',
        windowKey: PROCESSED_WINDOW_KEY,
        localStorageKey: PROCESSED_LOCAL_STORAGE_KEY,
        label: '正文自动替换',
        requireContentHash: true,
        limit: AUTO_OPTIMIZATION_PROCESSED_LIMIT_ACU,
    },
    auto_table_fill: {
        chain: 'auto_table_fill',
        windowKey: AUTO_TABLE_FILL_WINDOW_KEY,
        localStorageKey: AUTO_TABLE_FILL_LOCAL_STORAGE_KEY,
        label: '自动填表',
        requireContentHash: false,
        limit: AUTO_TABLE_FILL_PROCESSED_LIMIT_ACU,
    },
};

function resolveProcessedStore_ACU(chain?: any): ProcessedStore_ACU {
    return PROCESSED_STORES[chain as AutoChainProcessedKind_ACU] || PROCESSED_STORES.content_replacement;
}

/** 校验并归一化单条已处理记录；非法记录返回 null。chain 一律按所属集合覆写，避免跨链污染。 */
function normalizeChainProcessedEntry_ACU(
    store: ProcessedStore_ACU,
    raw: any,
): AutoChainProcessedEntry_ACU | null {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.messageId === null || raw.messageId === undefined || raw.messageId === '') return null;
    const contentHash = typeof raw.contentHash === 'string' ? raw.contentHash : '';
    if (store.requireContentHash && !contentHash) return null;
    return {
        chain: store.chain,
        messageIndex: Number.isInteger(raw.messageIndex) ? raw.messageIndex : -1,
        messageId: String(raw.messageId),
        contentHash,
        chatKey: typeof raw.chatKey === 'string' ? raw.chatKey : '',
        updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
    };
}

/**
 * 裁剪已处理集合：同一 messageId 只保留最新一条，整体按 updatedAt 降序，最多保留 limit 条。
 * 默认上限取所属链的容量（均为 20），保证 localStorage 占用有界。
 */
export function trimChainProcessedEntries_ACU(
    chain: AutoChainProcessedKind_ACU,
    entries: any,
    limit?: number,
): AutoChainProcessedEntry_ACU[] {
    const store = resolveProcessedStore_ACU(chain);
    const list = Array.isArray(entries) ? entries : [];
    const byMessageId = new Map<string, AutoChainProcessedEntry_ACU>();

    list.forEach((raw) => {
        const entry = normalizeChainProcessedEntry_ACU(store, raw);
        if (!entry) return;
        const existing = byMessageId.get(entry.messageId);
        if (!existing || entry.updatedAt >= existing.updatedAt) {
            byMessageId.set(entry.messageId, entry);
        }
    });

    const configuredLimit = Number.isInteger(limit) && Number(limit) > 0 ? Number(limit) : store.limit;
    return Array.from(byMessageId.values())
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, configuredLimit);
}

/** 把某条链的已处理集合写入浏览器侧存储（window + localStorage 双层）。 */
export function saveChainProcessedEntries_ACU(
    chain: AutoChainProcessedKind_ACU,
    entries: any,
): AutoChainProcessedEntry_ACU[] {
    const store = resolveProcessedStore_ACU(chain);
    const normalized = trimChainProcessedEntries_ACU(store.chain, entries);
    const payload = { entries: normalized, updatedAt: Date.now() };

    // 第一层：写入 window 对象（跨 iframe 可访问）
    try {
        const targetWindow = topLevelWindow_ACU || window;
        (targetWindow as any)[store.windowKey] = payload;
    } catch (error) {
        logDebug_ACU('[' + store.label + '] 写入浏览器侧自动链已处理集合失败（window）:', error);
    }

    // 第二层：写入 localStorage（持久化到浏览器）
    try {
        localStorage.setItem(store.localStorageKey, JSON.stringify(payload));
    } catch (error) {
        logDebug_ACU('[' + store.label + '] 写入浏览器侧自动链已处理集合失败（localStorage）:', error);
    }

    return normalized;
}

/** 读取某条链的已处理集合；优先级 window 对象 → localStorage，两层都拿不到时返回空数组。 */
export function loadChainProcessedEntries_ACU(
    chain: AutoChainProcessedKind_ACU,
): AutoChainProcessedEntry_ACU[] {
    const store = resolveProcessedStore_ACU(chain);

    // 第一层：window 对象
    try {
        const targetWindow = topLevelWindow_ACU || window;
        const windowCache = (targetWindow as any)[store.windowKey];
        if (Array.isArray(windowCache?.entries) && windowCache.entries.length > 0) {
            return trimChainProcessedEntries_ACU(store.chain, windowCache.entries);
        }
    } catch (error) {
        logDebug_ACU('[' + store.label + '] 读取浏览器侧自动链已处理集合失败（window）:', error);
    }

    // 第二层：localStorage
    try {
        const raw = localStorage.getItem(store.localStorageKey);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.entries) && parsed.entries.length > 0) {
                return trimChainProcessedEntries_ACU(store.chain, parsed.entries);
            }
        }
    } catch (error) {
        logDebug_ACU('[' + store.label + '] 读取浏览器侧自动链已处理集合失败（localStorage）:', error);
    }

    return [];
}

/**
 * 查找某楼在某条链上的已处理记录。
 * chatKey 用于兜底跨聊天 message_id 重号：两侧都有值且不同 → 视为不命中（宁放行不误拦）。
 */
export function findChainProcessedEntry_ACU(
    chain: AutoChainProcessedKind_ACU,
    messageId: any,
    chatKey = '',
): AutoChainProcessedEntry_ACU | null {
    if (messageId === null || messageId === undefined || messageId === '') return null;
    const store = resolveProcessedStore_ACU(chain);
    const target = String(messageId);
    const currentChatKey = typeof chatKey === 'string' ? chatKey : '';

    const entries = loadChainProcessedEntries_ACU(store.chain);
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.messageId !== target) continue;
        if (currentChatKey && entry.chatKey && currentChatKey !== entry.chatKey) continue;
        return entry;
    }
    return null;
}

/**
 * 登记一条「该楼在这条链上已成功完成过一次」（写入即裁剪，容量有界）。
 * @returns 归一化后的条目；messageId 缺失（正文替换链还要求 contentHash）时返回 null 且不写入。
 */
export function recordChainProcessed_ACU(
    chain: AutoChainProcessedKind_ACU,
    payload: any,
): AutoChainProcessedEntry_ACU | null {
    const store = resolveProcessedStore_ACU(chain);
    const entry = normalizeChainProcessedEntry_ACU(store, Object.assign({ updatedAt: Date.now() }, payload));
    if (!entry) return null;

    const next = trimChainProcessedEntries_ACU(store.chain, [
        entry,
        ...loadChainProcessedEntries_ACU(store.chain),
    ]);
    saveChainProcessedEntries_ACU(store.chain, next);
    return entry;
}

/** 清空某条链的已处理集合（调试/测试用；生产链不调用）。 */
export function clearChainProcessed_ACU(chain: AutoChainProcessedKind_ACU): void {
    const store = resolveProcessedStore_ACU(chain);
    try {
        const targetWindow = topLevelWindow_ACU || window;
        delete (targetWindow as any)[store.windowKey];
    } catch (error) {
        logDebug_ACU('[' + store.label + '] 清空浏览器侧自动链已处理集合失败（window）:', error);
    }

    try {
        localStorage.removeItem(store.localStorageKey);
    } catch (error) {
        logDebug_ACU('[' + store.label + '] 清空浏览器侧自动链已处理集合失败（localStorage）:', error);
    }
}

/**
 * 按 messageId 删除某条链的已处理记录（[W5] MVU 手动重试 / 解析完成联动重跑用）。
 * 只删记录，不改判重语义：命中规则、容量裁剪、window+localStorage 双层写入全部复用既有实现，
 * 删除后该楼在这条链上回到「没跑过」状态，允许自动链再跑一轮。
 * chatKey 兜底规则与 findChainProcessedEntry_ACU 一致：两侧都有值且不同 → 不删（跨聊天重号保护）。
 * @returns 实际删除的条数（0 = 未命中，不写存储）
 */
export function removeChainProcessedByMessageId_ACU(
    chain: AutoChainProcessedKind_ACU,
    messageId: any,
    chatKey = '',
): number {
    if (messageId === null || messageId === undefined || messageId === '') return 0;
    const store = resolveProcessedStore_ACU(chain);
    const target = String(messageId);
    const currentChatKey = typeof chatKey === 'string' ? chatKey : '';

    const entries = loadChainProcessedEntries_ACU(store.chain);
    const kept = entries.filter((entry) => {
        if (entry.messageId !== target) return true;
        if (currentChatKey && entry.chatKey && currentChatKey !== entry.chatKey) return true;
        return false;
    });
    const removed = entries.length - kept.length;
    if (removed > 0) saveChainProcessedEntries_ACU(store.chain, kept);
    return removed;
}

/**
 * [W5] 一次清掉某楼在两条自动链（正文替换 + 自动填表）上的已处理记录，各删各的集合。
 * 两链分键分集合，这里只是并列调用，不做跨链合并；返回各链实际删除条数供调用方记日志。
 */
export function removeAutoChainProcessedForMessage_ACU(
    messageId: any,
    chatKey = '',
): { content_replacement: number; auto_table_fill: number } {
    return {
        content_replacement: removeChainProcessedByMessageId_ACU('content_replacement', messageId, chatKey),
        auto_table_fill: removeChainProcessedByMessageId_ACU('auto_table_fill', messageId, chatKey),
    };
}

// ─── 正文自动替换链（content_replacement）───

export function trimAutoOptimizationProcessedEntries_ACU(
    entries: any,
    limit: number = AUTO_OPTIMIZATION_PROCESSED_LIMIT_ACU,
): AutoChainProcessedEntry_ACU[] {
    return trimChainProcessedEntries_ACU('content_replacement', entries, limit);
}

export function saveAutoOptimizationProcessedEntries_ACU(entries: any): AutoChainProcessedEntry_ACU[] {
    return saveChainProcessedEntries_ACU('content_replacement', entries);
}

export function loadAutoOptimizationProcessedEntries_ACU(): AutoChainProcessedEntry_ACU[] {
    return loadChainProcessedEntries_ACU('content_replacement');
}

export function findAutoOptimizationProcessedEntry_ACU(
    messageId: any,
    chatKey = '',
): AutoChainProcessedEntry_ACU | null {
    return findChainProcessedEntry_ACU('content_replacement', messageId, chatKey);
}

export function recordAutoOptimizationProcessed_ACU(payload: any): AutoChainProcessedEntry_ACU | null {
    return recordChainProcessed_ACU('content_replacement', payload);
}

export function clearAutoOptimizationProcessed_ACU(): void {
    clearChainProcessed_ACU('content_replacement');
}

// ─── 自动填表链（auto_table_fill）───

export function trimAutoTableFillProcessedEntries_ACU(
    entries: any,
    limit: number = AUTO_TABLE_FILL_PROCESSED_LIMIT_ACU,
): AutoChainProcessedEntry_ACU[] {
    return trimChainProcessedEntries_ACU('auto_table_fill', entries, limit);
}

export function saveAutoTableFillProcessedEntries_ACU(entries: any): AutoChainProcessedEntry_ACU[] {
    return saveChainProcessedEntries_ACU('auto_table_fill', entries);
}

export function loadAutoTableFillProcessedEntries_ACU(): AutoChainProcessedEntry_ACU[] {
    return loadChainProcessedEntries_ACU('auto_table_fill');
}

export function findAutoTableFillProcessedEntry_ACU(
    messageId: any,
    chatKey = '',
): AutoChainProcessedEntry_ACU | null {
    return findChainProcessedEntry_ACU('auto_table_fill', messageId, chatKey);
}

export function recordAutoTableFillProcessed_ACU(payload: any): AutoChainProcessedEntry_ACU | null {
    return recordChainProcessed_ACU('auto_table_fill', payload);
}

export function clearAutoTableFillProcessed_ACU(): void {
    clearChainProcessed_ACU('auto_table_fill');
}
