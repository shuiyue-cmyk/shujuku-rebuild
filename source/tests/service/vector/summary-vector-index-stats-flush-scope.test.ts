/**
 * getSummaryVectorIndexStats_ACU 的「归档队列」统计口径。
 *
 * 用户实测（v9.8.3）：不加载任何聊天、刚启动酒馆，向量索引页就长期显示
 * `0 等待 / 1 失败`，且清空缓存/删除索引都无效。根因是 manifest 为 null 时
 * estimateSummaryVectorFlushTasks_ACU 收到 undefined scope，而 list 在无 scope 时
 * 匹配全部记录 ⇒ 别的 scope 的残留失败任务被算成当前索引的失败。
 *
 * 本文件用最小 IndexedDB stub 驱动**真实** hot-cache 的 list/estimate（不 mock 其自身），
 * 只 mock 无关的重量级依赖，确保复现的是用户实测路径而不是 mock 行为。
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (() => void) | null;

class FakeRequest {
    result: any = undefined;
    error: any = null;
    onsuccess: Listener = null;
    onerror: Listener = null;

    constructor() {
        // success 事件延后到 microtask，确保调用方同步挂好 handler 后才触发。
        Promise.resolve().then(() => this.onsuccess?.());
    }
}

class FakeObjectStore {
    constructor(private data: Map<string, any>, private keyPath: string) {}

    createIndex(): void {}

    index(): FakeObjectStore {
        return this;
    }

    get(key: string): FakeRequest {
        const request = new FakeRequest();
        request.result = this.data.get(key);
        return request;
    }

    put(value: any): FakeRequest {
        const request = new FakeRequest();
        this.data.set(String(value[this.keyPath]), JSON.parse(JSON.stringify(value)));
        return request;
    }

    delete(key: string): FakeRequest {
        const request = new FakeRequest();
        this.data.delete(key);
        return request;
    }

    openCursor(): FakeRequest {
        const request = new FakeRequest();
        const entries = Array.from(this.data.entries());
        let index = 0;
        const advance = (): void => {
            if (index >= entries.length) {
                request.result = null;
                return;
            }
            const [key, value] = entries[index];
            index += 1;
            request.result = {
                key,
                value: JSON.parse(JSON.stringify(value)),
                continue: () => {
                    advance();
                    Promise.resolve().then(() => request.onsuccess?.());
                },
            };
        };
        advance();
        return request;
    }
}

class FakeTransaction {
    oncomplete: Listener = null;
    onerror: Listener = null;
    onabort: Listener = null;

    constructor(private store: FakeObjectStore) {
        // oncomplete 走 macrotask：晚于本轮所有 request microtask。
        setTimeout(() => this.oncomplete?.(), 0);
    }

    objectStore(): FakeObjectStore {
        return this.store;
    }
}

const flushTaskStoreData = new Map<string, any>();
const chunkStoreData = new Map<string, any>();

(globalThis as any).indexedDB = {
    open: () => {
        const request: any = {
            result: null,
            error: null,
            onupgradeneeded: null,
            onblocked: null,
            onsuccess: null,
            onerror: null,
        };
        setTimeout(() => {
            const stores: Record<string, FakeObjectStore> = {
                chunks: new FakeObjectStore(chunkStoreData, 'key'),
                flushTasks: new FakeObjectStore(flushTaskStoreData, 'scopeKey'),
            };
            request.result = {
                objectStoreNames: { contains: (name: string) => Object.prototype.hasOwnProperty.call(stores, name) },
                createObjectStore: () => {
                    throw new Error('测试 stub 预建 store，不应触发 createObjectStore');
                },
                transaction: (storeName: string) => new FakeTransaction(stores[storeName]),
                close: (): void => {},
            };
            request.onupgradeneeded?.();
            request.onsuccess?.();
        }, 0);
        return request;
    },
};

const h = vi.hoisted(() => ({
    chatKey: 'chat-a',
    isolationKey: 'iso-a',
    tables: null as any,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
    get currentChatFileIdentifier_ACU() { return h.chatKey; },
    get currentJsonTableData_ACU() { return h.tables; },
    getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => [] }));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../src/service/vector/summary-vector-index-state-service')>()),
    getAllSummaryVectorIndexSnapshotLayers_ACU: () => [],
}));
// 字节统计与本用例无关，mock 掉以免依赖 fake store 的 index 协议。
vi.mock('../../../src/data/storage/vector-index-temp-cache', () => ({
    estimateVectorIndexTempCache_ACU: vi.fn(async () => ({ bytes: 0, count: 0 })),
    deleteVectorIndexCacheByIndex_ACU: vi.fn(async () => true),
    getVectorIndexCachedShard_ACU: vi.fn(async () => null),
    putVectorIndexCachedShard_ACU: vi.fn(async () => undefined),
}));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', () => ({
    readVectorIndexJsonFile_ACU: vi.fn(),
    uploadVectorIndexJsonFile_ACU: vi.fn(),
    registerVectorIndexFiles_ACU: vi.fn(),
    deleteVectorIndexFile_ACU: vi.fn(),
    unregisterVectorIndexFiles_ACU: vi.fn(),
    loadVectorIndexRegistry_ACU: vi.fn(async () => ({ files: [] })),
    sha256Text_ACU: vi.fn(async (value: string) => `sha:${value.length}`),
    buildVectorIndexSingleSnapshotV2ScopeToken_ACU: () => 'scope-token',
    buildLegacyVectorIndexLosslessScopeTokenV2_ACU: () => 'legacy-token',
    buildVectorIndexSingleSnapshotV2FilePath_ACU: () => 'v2-path',
    buildLegacyVectorIndexSingleSnapshotFilePath_ACU: () => 'legacy-path',
    decodeVectorIndexScopeFromPath_ACU: () => null,
    isVectorIndexContentPackPathV2_ACU: () => false,
    isVectorIndexMirrorManifestPathV2_ACU: () => false,
    isFallbackVectorIndexChecksum_ACU: () => false,
    VECTOR_INDEX_MIRROR_MANIFEST_PATH_V2_PREFIX_ACU: 'TavernDB_ACU_vector_v2vcp_',
    VECTOR_INDEX_SNAPSHOT_PATH_V2_PREFIX_ACU: 'TavernDB_ACU_vector_v2_',
    buildVectorIndexFileName_ACU: () => '',
    buildVectorIndexSnapshotFilePath_ACU: () => '',
    buildVectorIndexStableDirectory_ACU: () => '',
    buildVectorIndexStableFilePath_ACU: () => '',
    deleteRegisteredVectorIndexFilesWhere_ACU: vi.fn(async () => []),
    buildVectorIndexContentPackPathV2_ACU: () => '',
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
    getEffectiveSummaryVectorIndexConfig_ACU: () => ({}),
}));

import {
    estimateSummaryVectorFlushTasks_ACU,
    upsertSummaryVectorFlushTask_ACU,
} from '../../../src/data/storage/vector-index-hot-cache';
import { getSummaryVectorIndexStats_ACU } from '../../../src/service/vector/summary-vector-index-storage-service';

const CURRENT_SCOPE = { chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'sheet_summary' };
const OTHER_SCOPE = { chatKey: 'chat-other', isolationKey: 'iso-other', sourceTableKey: 'sheet_summary' };

function manifestFor(scope: { chatKey: string; isolationKey: string; sourceTableKey: string }): any {
    return {
        version: 1,
        backend: 'st-files',
        status: 'ready',
        indexId: `snap-${scope.chatKey}`,
        chatKey: scope.chatKey,
        isolationKey: scope.isolationKey,
        sourceTableKey: scope.sourceTableKey,
        sourceTableName: '纪要表',
        snapshotMessageId: 'message-a',
        indexedAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        rowCount: 1,
        chunkCount: 1,
        embeddingModel: 'model-a',
        dimension: 2,
        files: [],
        storageIdentity: { layoutVersion: 2, scopeFingerprint: `scope:${scope.chatKey}`, writeGeneration: 'write-a', revision: 1 },
    };
}

async function seedTerminalFailure_ACU(scope: { chatKey: string; isolationKey: string; sourceTableKey: string }): Promise<void> {
    await upsertSummaryVectorFlushTask_ACU({
        scopeKey: `${scope.chatKey}|${scope.isolationKey}|${scope.sourceTableKey}`,
        ...scope,
        mode: 'sync',
        status: 'failed_terminal',
        lastError: 'archive failed',
    });
}

beforeEach(() => {
    flushTaskStoreData.clear();
    chunkStoreData.clear();
    h.chatKey = 'chat-a';
    h.isolationKey = 'iso-a';
    h.tables = { sheet_summary: { name: '纪要表', content: [['id'], ['r1']] } };
});

describe('getSummaryVectorIndexStats_ACU 归档队列统计口径', () => {
    it('manifest 为 null 时只统计当前 scope：别的 scope 的 failed_terminal 不计入', async () => {
        await seedTerminalFailure_ACU(OTHER_SCOPE);

        // 未修复时这里得到 flushTaskFailedCount=1（无 scope 的 list 匹配全部记录）。
        await expect(getSummaryVectorIndexStats_ACU(null)).resolves.toMatchObject({
            status: 'none',
            flushTaskTotalCount: 0,
            flushTaskFailedCount: 0,
        });
    });

    it('同 scope 的 failed_terminal 仍计为 1，且不与别的 scope 混淆', async () => {
        await seedTerminalFailure_ACU(CURRENT_SCOPE);
        await seedTerminalFailure_ACU(OTHER_SCOPE);

        const stats = await getSummaryVectorIndexStats_ACU(null);
        expect(stats.flushTaskTotalCount).toBe(1);
        expect(stats.flushTaskFailedCount).toBe(1);
    });

    it('当前 scope 解析不出来时按 0 报，不回退成全库计数', async () => {
        await seedTerminalFailure_ACU(OTHER_SCOPE);
        h.tables = null;

        await expect(getSummaryVectorIndexStats_ACU(null)).resolves.toMatchObject({
            flushTaskTotalCount: 0,
            flushTaskFailedCount: 0,
        });
        // 真实 list 的无 scope 口径仍是全库（健康报告等既有调用方依赖它），此处只约束统计层。
        await expect(estimateSummaryVectorFlushTasks_ACU()).resolves.toMatchObject({ total: 1, failedTerminal: 1 });
    });

    it('当前 scope 解析不出来时，别人的 canonical default 隔离任务也不许被算进来', async () => {
        // 回归锚点：曾经用 `{ chatKey:'', isolationKey:'', sourceTableKey:'' }` 兜底，
        // 而 list 会把空 isolationKey 归一成 'default'，于是"按 0 报"变成
        // "匹配所有 default 隔离的记录"（任意聊天、任意纪要表）——用户不加载聊天、
        // 未开数据隔离时落库的正是 canonical default，于是启动就显示 1 失败。
        // 这里刻意种一条 isolationKey='default' 的**别的**会话任务：
        // 用 'iso-other' 那种非 default 的值会被正常过滤掉，绿得不是因为口径正确。
        await seedTerminalFailure_ACU({ chatKey: 'chat-other', isolationKey: 'default', sourceTableKey: 'sheet_other' });
        h.tables = null;

        await expect(getSummaryVectorIndexStats_ACU(null)).resolves.toMatchObject({
            flushTaskTotalCount: 0,
            flushTaskFailedCount: 0,
        });
    });

    it('manifest 存在时仍按 manifest 的 scope 过滤（逐字行为不变）', async () => {
        await seedTerminalFailure_ACU(CURRENT_SCOPE);
        await seedTerminalFailure_ACU(OTHER_SCOPE);

        const stats = await getSummaryVectorIndexStats_ACU(manifestFor(OTHER_SCOPE));
        expect(stats.status).toBe('ready');
        expect(stats.flushTaskTotalCount).toBe(1);
        expect(stats.flushTaskFailedCount).toBe(1);
    });
});
