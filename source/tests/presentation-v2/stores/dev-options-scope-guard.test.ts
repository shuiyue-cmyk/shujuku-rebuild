/**
 * dev-options-store — 提示词额外要求的总开关、「附加的提示词」与「附加到」勾选：归一化、落盘、refresh 同步到服务层。
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

describe('dev-options-store：提示词额外要求总开关与附加到', () => {
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

describe('dev-options-store：附加的提示词（执行边界 / 安全审查）', () => {
  it('归一化：没保存按默认（只勾执行边界），非布尔值同样按默认', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { extraPrompts: { safetyReview: true, scopeGuard: 'yes' } } }));
    const { useStore } = await freshImport();
    const store = useStore();
    expect(store.extraPrompts).toEqual({ scopeGuard: true, safetyReview: true });
  });

  it('setExtraPromptKind：勾选立即同步到服务层并落盘，未知 kind 不生效', async () => {
    const { useStore, guard } = await freshImport();
    const store = useStore();
    store.setExtraPromptKind('safetyReview', true);
    expect(guard.isExtraPromptSelected_ACU('safetyReview')).toBe(true);
    expect(guard.isExtraPromptSelected_ACU('scopeGuard'), '未动的项按默认（勾执行边界）').toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').devOptions.extraPrompts).toEqual({ scopeGuard: true, safetyReview: true });

    store.setExtraPromptKind('nonsense' as any, true);
    expect(store.extraPrompts, '未知 kind 不改状态').toEqual({ scopeGuard: true, safetyReview: true });
  });

  it('refresh 后存储里的新勾选同步到服务层', async () => {
    const { useStore, guard } = await freshImport();
    const store = useStore();
    expect(guard.isExtraPromptSelected_ACU('safetyReview')).toBe(false);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { extraPrompts: { scopeGuard: false, safetyReview: true } } }));
    store.refresh();

    expect(store.extraPrompts).toEqual({ scopeGuard: false, safetyReview: true });
    expect(guard.isExtraPromptSelected_ACU('scopeGuard')).toBe(false);
    expect(guard.isExtraPromptSelected_ACU('safetyReview')).toBe(true);
  });
});
