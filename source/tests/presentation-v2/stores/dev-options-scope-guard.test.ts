/**
 * dev-options-store — 执行边界提示词的开关与「附加到」勾选：归一化、落盘、refresh 同步到服务层。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

async function freshImport() {
  vi.resetModules();
  const [store, guard, pinia] = await Promise.all([
    import('../../../src/presentation-v2/stores/dev-options-store'),
    import('../../../src/service/ai/scope-guard-prompt'),
    import('pinia'),
  ]);
  pinia.setActivePinia(pinia.createPinia());
  return { useStore: store.useDevOptionsStore, guard };
}

beforeEach(() => {
  localStorage.clear();
});

describe('dev-options-store：执行边界提示词', () => {
  it('勾选项归一化：每个功能都有布尔值，没保存或非布尔的按默认（只勾填表）', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { scopeGuardTargets: { plot: true, agent: 'yes' } } }));
    const { useStore, guard } = await freshImport();
    const store = useStore();
    expect(store.scopeGuardTargets).toEqual({ ...guard.SCOPE_GUARD_DEFAULT_TARGETS_ACU, plot: true });
  });

  it('refresh 后存储里的新值同步到服务层（仪表盘刷新时走这条）', async () => {
    const { useStore, guard } = await freshImport();
    const store = useStore();
    expect(guard.isScopeGuardPromptEnabled_ACU()).toBe(false);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { scopeGuardPrompt: true, scopeGuardTargets: { fill: false, plot: true } } }));
    store.refresh();

    expect(store.scopeGuardPrompt).toBe(true);
    expect(guard.isScopeGuardPromptEnabled_ACU()).toBe(true);
    expect(guard.isScopeGuardTargetEnabled_ACU('fill')).toBe(false);
    expect(guard.isScopeGuardTargetEnabled_ACU('plot')).toBe(true);
  });
});
