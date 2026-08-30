/**
 * tests/data/storage/vector-index-flush-task-attempt-count.test.ts
 * V1-a：flush task attemptCount 生命周期验收。
 * claim（status→flushing）逐次自增；markReady 成功写 ready 时必须归零，
 * 否则跨代累计会在 5 次上限处被 flush queue 误判为 failed_terminal。
 *
 * 用最小 IndexedDB stub 驱动真实 hot-cache 代码（不 mock 模块自身），
 * 仅覆盖 flush task 链路用到的行为：open/onupgradeneeded、
 * transaction(store).objectStore().get/put/delete、microtask request → macrotask oncomplete 事件序。
 */
import { beforeEach, describe, expect, it } from 'vitest';

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
}

class FakeTransaction {
    oncomplete: Listener = null;
    onerror: Listener = null;
    onabort: Listener = null;

    constructor(private store: FakeObjectStore) {
        // oncomplete 走 macrotask：晚于本轮所有 request microtask（含 handler 内的 put）。
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

import {
    getSummaryVectorFlushTaskStrict_ACU,
    markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU,
    upsertSummaryVectorFlushTask_ACU,
} from '../../../src/data/storage/vector-index-hot-cache';

const scope = {
    scopeKey: 'scope-1',
    chatKey: 'chat-1',
    isolationKey: 'iso-1',
    sourceTableKey: 'table-1',
};

beforeEach(() => {
    flushTaskStoreData.clear();
    chunkStoreData.clear();
});

describe('V1-a flush task attemptCount 生命周期', () => {
    it('claim 逐次自增，flush 成功后 attemptCount 归零且状态为 ready', async () => {
        for (let attempt = 1; attempt <= 5; attempt += 1) {
            const task = await upsertSummaryVectorFlushTask_ACU({
                ...scope, mode: 'sync', status: 'flushing', generation: 1,
            });
            expect(task?.attemptCount).toBe(attempt);
        }
        const marked = await markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU('scope-1', 1);
        expect(marked).toBe(true);
        const ready = await getSummaryVectorFlushTaskStrict_ACU('scope-1');
        expect(ready?.status).toBe('ready');
        expect(ready?.attemptCount).toBe(0);
    });

    it('成功后的新代次 claim 从 1 重新计数，而非跨代累计', async () => {
        await upsertSummaryVectorFlushTask_ACU({ ...scope, mode: 'sync', status: 'flushing', generation: 1 });
        await upsertSummaryVectorFlushTask_ACU({ ...scope, mode: 'sync', status: 'flushing', generation: 1 });
        await markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU('scope-1', 1);
        const nextClaim = await upsertSummaryVectorFlushTask_ACU({
            ...scope, mode: 'sync', status: 'flushing', generation: 2,
        });
        // 未修复时这里会得到 3（旧 attemptCount 被 ready 记录保留并被下一次 claim 累加）。
        expect(nextClaim?.attemptCount).toBe(1);
    });
});
