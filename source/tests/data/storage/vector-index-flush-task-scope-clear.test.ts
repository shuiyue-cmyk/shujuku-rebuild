/**
 * 真实 hot-cache 的「按 scope 清理 flush task」实现（clearSummaryVectorFlushTasksByScope_ACU）。
 * 该函数在其余测试里一律被 mock，故其失败通道此前零真实覆盖：本文件用最小 IndexedDB stub
 * （含 openCursor 游标协议）驱动真实代码，锚定「任一 task 未被确认删除即整体返回 false」。
 *
 * 说明：其依赖 deleteSummaryVectorFlushTask_ACU 的契约是 Promise<boolean>（catch 后返 false），
 * 不存在返回 undefined 的出口，故本用例主要防住「判据被反写成 === true（变成成功才算失败）」；
 * fail-closed 与 === false 在此依赖下等价，无法用真实模块区分（那正是 mock 侧用例的职责）。
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
        // deleteSticks=false 模拟「删除未落盘」：strict 版删除后的复读校验会失败，
        // 从而走真实代码里的失败通道。
        if (deleteSticks.value) this.data.delete(key);
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
const deleteSticks = { value: true };

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
    clearSummaryVectorFlushTasksByScope_ACU,
    listSummaryVectorFlushTasks_ACU,
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
    deleteSticks.value = true;
});

describe('clearSummaryVectorFlushTasksByScope_ACU 失败通道', () => {
    it('全部任务确认删除后返回 true，且 store 内不再残留', async () => {
        await upsertSummaryVectorFlushTask_ACU({ ...scope, mode: 'sync', status: 'dirty' });
        expect(await listSummaryVectorFlushTasks_ACU(scope)).toHaveLength(1);

        await expect(clearSummaryVectorFlushTasksByScope_ACU(scope)).resolves.toBe(true);

        expect(flushTaskStoreData.has('scope-1')).toBe(false);
        expect(await listSummaryVectorFlushTasks_ACU(scope)).toEqual([]);
    });

    it('任务删除未被确认（复读校验仍能读到）时返回 false，不把残留当已清空', async () => {
        await upsertSummaryVectorFlushTask_ACU({ ...scope, mode: 'sync', status: 'dirty' });
        deleteSticks.value = false;

        await expect(clearSummaryVectorFlushTasksByScope_ACU(scope)).resolves.toBe(false);

        expect(flushTaskStoreData.has('scope-1')).toBe(true);
    });

    it('无残留任务时返回 true', async () => {
        await expect(clearSummaryVectorFlushTasksByScope_ACU(scope)).resolves.toBe(true);
    });
});
