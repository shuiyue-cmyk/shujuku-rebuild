/**
 * appearance-store — 验证界面缩放偏好的归一化与持久化。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

type AppearanceStoreModule = typeof import('../../../src/presentation-v2/stores/appearance-store');
type PiniaModule = typeof import('pinia');

async function freshImport(): Promise<{
  appearanceStore: AppearanceStoreModule;
  pinia: PiniaModule;
}> {
  vi.resetModules();
  const [appearanceStore, pinia] = await Promise.all([
    import('../../../src/presentation-v2/stores/appearance-store'),
    import('pinia'),
  ]);
  return { appearanceStore, pinia };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
});

describe('appearance-store', () => {
  it('未持久化时使用默认缩放 100%', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.appearanceStore.useAppearanceStore();

    expect(store.uiScale).toBe('100');
    expect(store.uiScaleLabel).toBe('100%');
    expect(store.uiScaleCssValue).toBe('1');
  });

  it('localStorage 中已有合法缩放时按持久化值初始化', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance: { uiScale: '125' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.appearanceStore.useAppearanceStore();

    expect(store.uiScale).toBe('125');
    expect(store.uiScaleLabel).toBe('125%');
    expect(store.uiScaleCssValue).toBe('1.25');
  });

  it('setUiScale 写入 appearance section 且保留已有 section', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { activeId: 'default-light' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.appearanceStore.useAppearanceStore();

    store.setUiScale('110');

    expect(store.uiScale).toBe('110');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { activeId: 'default-light' },
      appearance: { uiScale: '110', uiStyle: 'default', railCollapsed: false, claudeColorMode: 'system' },
    });
  });

  it('setUiScale 拒绝非法值', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.appearanceStore.useAppearanceStore();

    (store.setUiScale as any)('150');

    expect(store.uiScale).toBe('100');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('界面风格默认是「默认」，侧栏默认展开', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.appearanceStore.useAppearanceStore();

    expect(store.uiStyle).toBe('default');
    expect(store.isClaudeStyle).toBe(false);
    expect(store.railCollapsed).toBe(false);
  });

  it('setUiStyle 切到 Claude 风格并持久化；非法值不写', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.appearanceStore.useAppearanceStore();

    (store.setUiStyle as any)('material');
    expect(store.uiStyle).toBe('default');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    store.setUiStyle('claude');
    expect(store.isClaudeStyle).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).appearance).toEqual({
      uiScale: '100', uiStyle: 'claude', railCollapsed: false, claudeColorMode: 'system',
    });
  });

  it('按持久化值恢复界面风格与侧栏收起；坏值回落默认', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance: { uiScale: '110', uiStyle: 'claude', railCollapsed: true } }));
    let m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    let store = m.appearanceStore.useAppearanceStore();
    expect(store.uiStyle).toBe('claude');
    expect(store.railCollapsed).toBe(true);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance: { uiStyle: 'neon', railCollapsed: 'yes' } }));
    m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    store = m.appearanceStore.useAppearanceStore();
    expect(store.uiStyle).toBe('default');
    expect(store.railCollapsed).toBe(false);
  });

  it('toggleRailCollapsed 翻转并持久化', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.appearanceStore.useAppearanceStore();

    store.toggleRailCollapsed();
    expect(store.railCollapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).appearance.railCollapsed).toBe(true);
    store.toggleRailCollapsed();
    expect(store.railCollapsed).toBe(false);
  });

  it('Claude 风格的颜色模式默认跟随系统，可设为浅色 / 深色并持久化；坏值回落跟随系统', async () => {
    let m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    let store = m.appearanceStore.useAppearanceStore();
    expect(store.claudeColorMode).toBe('system');

    (store.setClaudeColorMode as any)('sepia');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    store.setClaudeColorMode('dark');
    expect(store.claudeColorMode).toBe('dark');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).appearance.claudeColorMode).toBe('dark');

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance: { claudeColorMode: 'sepia' } }));
    m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    store = m.appearanceStore.useAppearanceStore();
    expect(store.claudeColorMode).toBe('system');
  });
});
