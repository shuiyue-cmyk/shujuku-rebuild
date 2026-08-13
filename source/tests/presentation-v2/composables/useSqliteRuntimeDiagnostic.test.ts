/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function mockDeps(options: {
  sqlite?: boolean;
  result?: { ok: boolean; degraded: boolean };
  error?: Error;
}) {
  const health = {
    status: 'ready',
    expectedMode: 'sqlite',
    activeMode: 'sqlite',
    source: 'merged',
    loadToken: 1,
    error: 'token=secret; ddl=private',
  } as any;
  const getHealth = vi.fn(() => ({ ...health }));
  const reload = vi.fn(async () => {
    if (options.error) throw options.error;
    health.loadToken += 1;
    return { source: 'merged', ...(options.result ?? { ok: true, degraded: false }) };
  });
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    isSqliteMode: () => options.sqlite !== false,
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    getStorageRuntimeHealth_ACU: getHealth,
    reloadStorageProvider: reload,
  }));
  return { health, getHealth, reload };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

describe('useSqliteRuntimeDiagnostic', () => {
  async function mountFlow() {
    const [{ createApp, h, nextTick }, { createPinia, setActivePinia }, { useSqliteRuntimeDiagnostic }, { useToastStore }] = await Promise.all([
      import('vue'),
      import('pinia'),
      import('../../../src/presentation-v2/composables/useSqliteRuntimeDiagnostic'),
      import('../../../src/presentation-v2/stores/toast-store'),
    ]);
    setActivePinia(createPinia());
    let flow: ReturnType<typeof useSqliteRuntimeDiagnostic> | undefined;
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({ setup: () => { flow = useSqliteRuntimeDiagnostic(); return () => h('div'); } });
    app.mount(host);
    await nextTick();
    return { flow: flow!, toast: useToastStore(), unmount: () => { app.unmount(); host.remove(); } };
  }

  it('轮询 loadToken 并刷新脱敏健康快照', async () => {
    const deps = mockDeps({});
    const { flow, unmount } = await mountFlow();
    deps.health.loadToken = 2;
    await vi.advanceTimersByTimeAsync(1000);

    expect(flow.health.value.loadToken).toBe(2);
    expect(flow.health.value).not.toHaveProperty('error');
    expect(JSON.stringify(flow.health.value)).not.toContain('token=secret');
    unmount();
  });

  it.each([
    [{ ok: true, degraded: false }, 'success'],
    [{ ok: false, degraded: true }, 'warning'],
    [{ ok: false, degraded: false }, 'error'],
  ] as const)('按 reload 结果反馈 %s', async (result, kind) => {
    const deps = mockDeps({ result });
    const { flow, toast, unmount } = await mountFlow();
    await flow.reload();

    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(flow.busy.value).toBe(false);
    expect(flow.health.value.loadToken).toBe(2);
    expect(toast.items.at(-1)).toMatchObject({ kind });
    unmount();
  });

  it('reload 抛错时清除 busy 并只反馈失败状态', async () => {
    mockDeps({ error: new Error('sensitive provider error') });
    const { flow, toast, unmount } = await mountFlow();
    await flow.reload();

    expect(flow.busy.value).toBe(false);
    expect(toast.items.at(-1)).toMatchObject({ kind: 'error' });
    expect(toast.items.at(-1)?.text).not.toContain('sensitive provider error');
    unmount();
  });

  it('非 SQLite 模式只保留状态卡，不触发 reload', async () => {
    const deps = mockDeps({ sqlite: false });
    const { flow, unmount } = await mountFlow();
    await flow.reload();

    expect(flow.isVisible.value).toBe(false);
    expect(deps.reload).not.toHaveBeenCalled();
    unmount();
  });
});
