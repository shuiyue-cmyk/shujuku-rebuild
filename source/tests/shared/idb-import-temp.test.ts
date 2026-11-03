import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ window: {} as any }));
vi.mock('../../src/shared/env', () => ({ topLevelWindow_ACU: h.window }));
vi.mock('../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));

type Behavior = { openFails: number; abortTx: boolean; failRequest?: boolean };

function installFakeIndexedDb(behavior: Behavior) {
  const store = new Map<string, unknown>();
  const opens = { count: 0 };
  h.window.indexedDB = {
    open: () => {
      opens.count += 1;
      const req: any = {};
      setTimeout(() => {
        if (behavior.openFails > 0) {
          behavior.openFails -= 1;
          req.error = new Error('open failed');
          req.onerror?.();
          return;
        }
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const tx: any = {};
            const request = (apply: () => unknown) => {
              const r: any = {};
              setTimeout(() => {
                if (behavior.failRequest) {
                  // request 自身失败（配额满 / 隐私模式 / 被其它页签升级抢占）：
                  // onerror 先触发 → 调用方 await 抛出；随后事务 abort，done 被拒。
                  tx.error = new Error('IndexedDB transaction aborted');
                  r.error = new Error('IndexedDB request failed');
                  r.onerror?.();
                  setTimeout(() => (behavior.abortTx ? tx.onabort?.() : tx.oncomplete?.()), 0);
                  return;
                }
                r.result = apply();
                r.onsuccess?.();
                setTimeout(() => (behavior.abortTx ? tx.onabort?.() : tx.oncomplete?.()), 0);
              }, 0);
              return r;
            };
            tx.objectStore = () => ({
              put: (value: unknown, key: string) => request(() => { if (!behavior.abortTx) store.set(key, value); }),
              get: (key: string) => request(() => store.get(key)),
              delete: (key: string) => request(() => store.delete(key)),
            });
            return tx;
          },
        };
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  return { store, opens };
}

describe('R7-11：导入暂存 IndexedDB', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('写请求成功但事务中止时不报成功，回退到内存暂存', async () => {
    const fake = installFakeIndexedDb({ openFails: 0, abortTx: true });
    const mod = await import('../../src/shared/idb-import-temp');
    await mod.importTempSet_ACU('k', { v: 1 });
    expect(fake.store.has('k')).toBe(false);
    expect(mod.importTempMem_ACU.get('k')).toEqual({ v: 1 });
  });

  it('打开失败后下次调用会重新尝试打开', async () => {
    const fake = installFakeIndexedDb({ openFails: 1, abortTx: false });
    const mod = await import('../../src/shared/idb-import-temp');
    await mod.importTempSet_ACU('a', 1);
    expect(mod.importTempMem_ACU.get('a')).toBe(1);
    await mod.importTempSet_ACU('b', 2);
    expect(fake.opens.count).toBe(2);
    expect(fake.store.get('b')).toBe(2);
  });

  it('G11-01：写请求自身失败时回退内存暂存，且悬空的 done 不产生未处理拒绝', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => { rejections.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      installFakeIndexedDb({ openFails: 0, abortTx: true, failRequest: true });
      const mod = await import('../../src/shared/idb-import-temp');
      // request 先 onerror → idbSet 抛出 → importTempSet 捕获并回退内存暂存（语义不变）
      await mod.importTempSet_ACU('k', { v: 1 });
      expect(mod.importTempMem_ACU.get('k')).toEqual({ v: 1 });
      // 等事务随后 abort：修复前 done 无人挂 handler，会在这里冒出未处理拒绝
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('G11-01：删请求自身失败时同样不产生未处理拒绝', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => { rejections.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      installFakeIndexedDb({ openFails: 0, abortTx: true, failRequest: true });
      const mod = await import('../../src/shared/idb-import-temp');
      await mod.importTempRemove_ACU('k');
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });
});
