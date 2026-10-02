/**
 * put 前按 scope 清理旧 chunk 的行为断言（真实实现 + 最小 IndexedDB stub）。
 *
 * 背景：indexId 每次更新都不同，历史版本的 chunk 会被 isRecordCompatible 判否
 * （已不可用）却一直占着 64MB 预算，触发 LRU 才被淘汰。修复是 put 前按
 * chatKey/isolationKey/sourceTableKey 先删同 scope 旧缓存。
 *
 * 本文件必须自建 stub：v2-skip.test.ts 的 indexedDB.open 一律抛错，只能量到
 * 「触碰过 IDB」，量不到「删除了同 scope 的旧记录」。
 */
import { beforeEach, describe, expect, it } from 'vitest';

type Listener = (() => void) | null;

class FakeRequest {
    result: any = undefined;
    error: any = null;
    onsuccess: Listener = null;
    onerror: Listener = null;

    constructor() {
        Promise.resolve().then(() => this.onsuccess?.());
    }
}

class FakeCursorIndex {
    constructor(private rows: Array<[string, any]>) {}
    openCursor(): FakeRequest {
        const request = new FakeRequest();
        let index = 0;
        const advance = (): void => {
            if (index >= this.rows.length) {
                request.result = null;
                return;
            }
            const [key, value] = this.rows[index];
            index += 1;
            request.result = {
                key,
                value: JSON.parse(JSON.stringify(value)),
                delete: () => {
                    chunkStoreData.delete(key);
                    return new FakeRequest();
                },
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

class FakeObjectStore {
    createIndex(): void {}

    put(value: any): FakeRequest {
        const request = new FakeRequest();
        chunkStoreData.set(String(value.key), JSON.parse(JSON.stringify(value)));
        return request;
    }

    get(): FakeRequest {
        return new FakeRequest();
    }

    openCursor(): FakeRequest {
        const request = new FakeRequest();
        const entries = Array.from(chunkStoreData.entries());
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
                delete: () => {
                    chunkStoreData.delete(key);
                    return new FakeRequest();
                },
                continue: () => {
                    advance();
                    Promise.resolve().then(() => request.onsuccess?.());
                },
            };
        };
        advance();
        return request;
    }

    /** lastAccessAt 索引：stub 里退化为全表顺序遍历（真实实现只按访问时间排序淘汰）。 */
    index(_name: string): FakeCursorIndex {
        return new FakeCursorIndex(Array.from(chunkStoreData.entries()));
    }
}

class FakeTransaction {
    oncomplete: Listener = null;
    onerror: Listener = null;
    onabort: Listener = null;

    constructor(private store: FakeObjectStore) {
        setTimeout(() => this.oncomplete?.(), 0);
    }

    objectStore(): FakeObjectStore {
        return this.store;
    }
}

const chunkStoreData = new Map<string, any>();
const flushTaskStoreData = new Map<string, any>();

(globalThis as any).indexedDB = {
    open: () => {
        const request: any = {
            result: null, error: null,
            onupgradeneeded: null, onblocked: null, onsuccess: null, onerror: null,
        };
        setTimeout(() => {
            const stores: Record<string, FakeObjectStore> = {
                chunks: new FakeObjectStore(),
                flushTasks: new FakeObjectStore(),
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

import {
  putSummaryVectorHotCacheChunks_ACU,
} from '../../../src/data/storage/vector-index-hot-cache';

/** legacy single_file_snapshot 写入才会触碰 chunks store（V2 identity 早退）。 */
function legacyManifest(indexId: string): any {
    return {
        version: 1, backend: 'st-files', status: 'ready', indexId,
        chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary',
        snapshotMessageId: 'message-a', indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
        rowCount: 1, chunkCount: 1, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
        rowsFile: 'r', tombstoneFile: 't', manifestFile: 'm', files: [],
        baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
        snapshot: {
            revision: 3, mode: 'single_file_snapshot', parentIndexIds: [],
            activeRowKeys: ['row-a'], activeChunkIds: ['chunk-a'],
            removedRowKeys: [], replacedRowKeys: [], batchIds: [],
        },
    };
}

function chunk() {
    return { chunkId: 'chunk-a', rowKey: 'row-a', sequence: 0, text: 'summary', vector: [1, 2] };
}

/** 预置一条旧 indexId 的同 scope 记录（模拟上一轮更新的残留缓存）。 */
function seedStaleChunk(indexId: string): void {
    chunkStoreData.set(`stale:${indexId}`, {
        key: `stale:${indexId}`,
        chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary',
        indexId, chunkKey: 'chunk-a', chunkId: 'chunk-a', rowKey: 'row-a',
        embeddingModel: 'model-a', dimension: 2, checksum: '',
        chunk: { chunkId: 'chunk-a', rowKey: 'row-a', text: 'old', vector: [1, 2] },
        byteSize: 64, createdAt: 1, updatedAt: 1, lastAccessAt: 1,
    });
}

beforeEach(() => {
    chunkStoreData.clear();
    flushTaskStoreData.clear();
});

describe('put 前按 scope 清理旧 chunk', () => {
    it('新 indexId 写入后，同 scope 的旧 indexId 记录不再残留', async () => {
        seedStaleChunk('idx-old');

        await putSummaryVectorHotCacheChunks_ACU({ manifest: legacyManifest('idx-new'), chunks: [chunk()] });

        const remainingIndexIds = Array.from(chunkStoreData.values()).map(record => record.indexId);
        expect(remainingIndexIds).not.toContain('idx-old');
        expect(remainingIndexIds).toContain('idx-new');
    });

    it('isolationKey 为空槽时按 default 精确清理，不误删同聊天的其它隔离槽', async () => {
        // 落库口径：'' 归一为 'default'；删除侧若直接传 ''，normalizeKeyPart_ACU 会
        // 把它当通配，从而擦掉同 chatKey 下全部隔离槽的缓存。
        chunkStoreData.set('stale:default-slot', {
            key: 'stale:default-slot',
            chatKey: 'chat-a', isolationKey: 'default', sourceTableKey: 'summary',
            indexId: 'idx-old-default', chunkKey: 'chunk-a', chunkId: 'chunk-a', rowKey: 'row-a',
            embeddingModel: 'model-a', dimension: 2, checksum: '',
            chunk: { chunkId: 'chunk-a', rowKey: 'row-a', text: 'old', vector: [1, 2] },
            byteSize: 64, createdAt: 1, updatedAt: 1, lastAccessAt: 1,
        });
        chunkStoreData.set('stale:other-iso', {
            key: 'stale:other-iso',
            chatKey: 'chat-a', isolationKey: 'iso-b', sourceTableKey: 'summary',
            indexId: 'idx-other-iso', chunkKey: 'chunk-a', chunkId: 'chunk-a', rowKey: 'row-a',
            embeddingModel: 'model-a', dimension: 2, checksum: '',
            chunk: { chunkId: 'chunk-a', rowKey: 'row-a', text: 'other', vector: [1, 2] },
            byteSize: 64, createdAt: 1, updatedAt: 1, lastAccessAt: 1,
        });

        await putSummaryVectorHotCacheChunks_ACU({
            manifest: { ...legacyManifest('idx-new-default'), isolationKey: '' },
            chunks: [chunk()],
        });

        expect(chunkStoreData.has('stale:default-slot'), '同槽旧版本应被清掉').toBe(false);
        expect(chunkStoreData.has('stale:other-iso'), '其它隔离槽不得被误删').toBe(true);
    });

    it('其他 scope 的记录不被误删（清理只按 chatKey/isolationKey/sourceTableKey 三元组）', async () => {
        chunkStoreData.set('stale:other-scope', {
            key: 'stale:other-scope',
            chatKey: 'chat-b', isolationKey: 'iso-b', sourceTableKey: 'summary',
            indexId: 'idx-other', chunkKey: 'chunk-a', chunkId: 'chunk-a', rowKey: 'row-a',
            embeddingModel: 'model-a', dimension: 2, checksum: '',
            chunk: { chunkId: 'chunk-a', rowKey: 'row-a', text: 'other', vector: [1, 2] },
            byteSize: 64, createdAt: 1, updatedAt: 1, lastAccessAt: 1,
        });

        await putSummaryVectorHotCacheChunks_ACU({ manifest: legacyManifest('idx-new'), chunks: [chunk()] });

        expect(chunkStoreData.has('stale:other-scope')).toBe(true);
    });

    it('无旧残留时写入不受影响（清理是幂等前置动作）', async () => {
        await putSummaryVectorHotCacheChunks_ACU({ manifest: legacyManifest('idx-new'), chunks: [chunk()] });

        expect(Array.from(chunkStoreData.values()).filter(r => r.indexId === 'idx-new').length).toBe(1);
    });
});