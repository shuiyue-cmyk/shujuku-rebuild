import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ window: {} as any }));
vi.mock('../../src/shared/env', () => ({ topLevelWindow_ACU: h.window }));
vi.mock('../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));

type Behavior = { openFails: number; abortTx: boolean };

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
});
