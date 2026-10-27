/**
 * 新版界面外壳：挂载、逐页渲染无异常、关闭重开保留路由。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createV3Settings, flush, mountV3 } from './v3-harness';

function allFeaturesSettings(): any {
  const settings = createV3Settings();
  settings.summaryVectorIndexModeDefault = true;
  settings.contentOptimizationSettings = { apiPreset: '', enabled: true };
  // 决策召回页只在总开关开着时出现在侧栏
  settings.decisionRecallSettings = { ...(settings.decisionRecallSettings || {}), enabled: true };
  return settings;
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('v3 外壳', () => {
  it('挂载新版界面，所有可见页面渲染无异常', { timeout: 90000 }, async () => {
    const { mount, errors, router } = await mountV3({
      settings: allFeaturesSettings(),
      uiState: { devOptions: { developerOptionsEnabled: true } },
    });
    cleanup = () => mount.__resetAcuV2MountForTests();

    expect(document.querySelector('.ub-app')).not.toBeNull();
    expect(document.querySelector('.acu-v2-app')).toBeNull();

    const visited: string[] = [];
    for (const page of router.visiblePages) {
      router.setActivePage(page.id);
      await flush(6);
      visited.push(page.id);
      expect(document.querySelector('.ub-top__title')?.textContent).toContain(page.title);
      expect(document.querySelector('.ub-scroll')?.textContent?.trim().length).toBeGreaterThan(0);
    }
    expect(visited.sort()).toEqual([
      'advanced-tools', 'agent', 'api', 'content-replace', 'continuation', 'dashboard',
      'data-mgmt', 'decision-recall', 'developer', 'form-fill', 'plot', 'table', 'vector-index',
    ]);
    expect(errors).toEqual([]);
  });

  it('关闭再打开回到原页；外观面板里不再有切换旧界面的入口', async () => {
    const { mount, router } = await mountV3();
    cleanup = () => mount.__resetAcuV2MountForTests();
    router.setActivePage('api');
    await flush();

    mount.closeAcuV2App();
    await flush();
    await mount.openAcuV2App();
    await flush();
    expect(document.querySelector('.ub-top__title')?.textContent).toContain('API');

    const railAppearance = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-rail button'))
      .find(button => button.textContent?.includes('外观与界面'))!;
    railAppearance.click();
    await flush();
    expect(document.body.textContent).toContain('界面缩放');
    expect(document.body.textContent).not.toContain('经典');
  });

  it('R10B-06：页内有未保存修改时，切页与切模式先过关闭守卫，拒绝则留在原页', async () => {
    const { mount, router } = await mountV3();
    cleanup = () => mount.__resetAcuV2MountForTests();
    router.setActivePage('api');
    await flush();
    const { registerUiCloseGuard } = await import('../../src/presentation-v2/composables/useUiCloseGuard');
    let allow = false;
    const guard = vi.fn(() => allow);
    const unregister = registerUiCloseGuard(guard);

    document.querySelector<HTMLButtonElement>('.ub-rail [data-page-id="dashboard"]')!.click();
    await flush();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(router.activePageId).toBe('api');

    const modeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-rail button'))
      .find(button => button.textContent?.includes('返回基础模式'))!;
    modeButton.click();
    await flush();
    expect(guard).toHaveBeenCalledTimes(2);
    expect(router.activePageId).toBe('api');
    expect(document.querySelector('.ub-brand__tag')?.textContent).toContain('高手模式');

    allow = true;
    document.querySelector<HTMLButtonElement>('.ub-rail [data-page-id="dashboard"]')!.click();
    await flush();
    expect(router.activePageId).toBe('dashboard');
    unregister();
  });

  it('默认风格下选 Claude 主题：提示有 Claude 整体风格，只问一次；同意则切到 Claude 风格并按主题定明暗', async () => {
    const { mount } = await mountV3({ uiState: { theme: { activeId: 'jirai-kei' } } });
    cleanup = () => mount.__resetAcuV2MountForTests();
    const app = document.querySelector<HTMLElement>('.ub-app')!;
    const { useDialogStore } = await import('../../src/presentation-v2/stores/dialog-store');
    const { useAppearanceStore } = await import('../../src/presentation-v2/stores/appearance-store');
    const dialog = useDialogStore();
    Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-rail button'))
      .find(button => button.textContent?.includes('外观与界面'))!.click();
    await flush();
    const pickTheme = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-theme__pick'))
      .find(button => button.textContent?.trim() === name)!.click();

    pickTheme('Claude 夜');
    await flush();
    expect(dialog.active?.kind).toBe('confirm');
    expect(dialog.active?.message).toContain('Claude 界面风格');
    dialog.cancelActive();
    await flush();
    expect(app.dataset.ubStyle).toBe('default');
    expect(useAppearanceStore().claudeStyleSuggested).toBe(true);

    // 已经问过：再选 Claude 主题不再弹
    pickTheme('Claude');
    await flush();
    expect(dialog.active).toBeNull();

    // 同意分支：重置「问过」后选 Claude 夜并确认 → 切 Claude 风格、深色
    useAppearanceStore().$patch({ claudeStyleSuggested: false });
    pickTheme('Claude 夜');
    await flush();
    dialog.submitActive();
    await flush();
    expect(app.dataset.ubStyle).toBe('claude');
    expect(useAppearanceStore().claudeColorMode).toBe('dark');
    expect(app.dataset.ubColorScheme).toBe('dark');
  });

  it('默认风格下选非 Claude 主题不提示', async () => {
    const { mount } = await mountV3({ uiState: { theme: { activeId: 'jirai-kei' } } });
    cleanup = () => mount.__resetAcuV2MountForTests();
    const { useDialogStore } = await import('../../src/presentation-v2/stores/dialog-store');
    Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-rail button'))
      .find(button => button.textContent?.includes('外观与界面'))!.click();
    await flush();
    const other = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-theme__pick'))
      .find(button => !/Claude/.test(button.textContent || ''))!;
    other.click();
    await flush();
    expect(useDialogStore().active).toBeNull();
  });

  it('更新前就在默认风格下用着 Claude 主题：打开面板时也问一次，同意后按主题定明暗', async () => {
    const { mount } = await mountV3({ uiState: { theme: { activeId: 'claude-night' } } });
    cleanup = () => mount.__resetAcuV2MountForTests();
    await flush();
    const { useDialogStore } = await import('../../src/presentation-v2/stores/dialog-store');
    const { useAppearanceStore } = await import('../../src/presentation-v2/stores/appearance-store');
    const dialog = useDialogStore();
    expect(dialog.active?.kind).toBe('confirm');
    expect(dialog.active?.message).toContain('Claude 界面风格');
    expect(useAppearanceStore().claudeStyleSuggested).toBe(true);
    dialog.submitActive();
    await flush();
    const app = document.querySelector<HTMLElement>('.ub-app')!;
    expect(app.dataset.ubStyle).toBe('claude');
    expect(app.dataset.ubColorScheme).toBe('dark');
  });

  it('已经问过、或已是 Claude 风格时，打开面板不再问', async () => {
    for (const appearance of [{ claudeStyleSuggested: true }, { uiStyle: 'claude' }]) {
      const { mount } = await mountV3({ uiState: { theme: { activeId: 'claude' }, appearance } });
      await flush();
      const { useDialogStore } = await import('../../src/presentation-v2/stores/dialog-store');
      expect(useDialogStore().active).toBeNull();
      mount.__resetAcuV2MountForTests();
    }
  });

  it('界面风格：切到 Claude 后用自带配色，明暗按颜色模式走、不改所选主题；仪表盘页首出现问候语；侧栏可收起', async () => {
    const { mount, router } = await mountV3({ uiState: { theme: { activeId: 'jirai-kei' } } });
    cleanup = () => mount.__resetAcuV2MountForTests();
    const app = document.querySelector<HTMLElement>('.ub-app')!;
    expect(app.dataset.ubStyle).toBe('default');
    expect(document.querySelector('.ub-rail__collapse')).toBeNull();
    expect(document.querySelector('.ub-heading')).toBeNull();

    Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-rail button'))
      .find(button => button.textContent?.includes('外观与界面'))!.click();
    await flush();
    const pick = (group: string, label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`))
      .find(button => button.textContent?.trim() === label)!;
    expect(document.querySelector('[aria-label="颜色模式"]')).toBeNull();
    pick('界面风格', 'Claude').click();
    await flush();

    expect(app.dataset.ubStyle).toBe('claude');
    const { useThemeStore } = await import('../../src/presentation-v2/stores/theme-store');
    expect(useThemeStore().activeId).toBe('jirai-kei');
    // 主题网格让位给颜色模式；jsdom 无系统深色 → 跟随系统取浅色
    expect(document.querySelector('[aria-label="颜色模式"]')).not.toBeNull();
    expect(app.dataset.ubColorScheme).toBe('light');
    const themeStyle = document.getElementById('acu-v2-theme')!.textContent!;
    expect(themeStyle.toLowerCase()).toContain('--acu-accent: #d97757');
    // 面板外的插件弹窗同步换成 Claude 外观
    expect(document.getElementById('acu-v2-host-claude-skin')?.textContent).toContain('.acu-hd-dialog');
    pick('颜色模式', '深色').click();
    await flush();
    expect(app.dataset.ubColorScheme).toBe('dark');
    expect(document.getElementById('acu-v2-theme')!.textContent).toContain('color-scheme: dark');

    expect(document.querySelector('.ub-heading__greeting')?.textContent).toMatch(/好|夜深了/);
    router.setActivePage('api');
    await flush();
    // 页名只在标题栏出现一次，不在页首重复
    expect(document.querySelector('.ub-heading')).toBeNull();
    expect(document.querySelector('.ub-top__title')?.textContent).toContain('API');
    expect(document.querySelector('.ub-top__crumb')?.textContent).toBe('配置');

    const collapse = document.querySelector<HTMLButtonElement>('.ub-rail__collapse')!;
    collapse.click();
    await flush();
    expect(document.querySelector('.ub-shell')?.classList.contains('is-rail-collapsed')).toBe(true);
    expect(document.querySelector('.ub-rail [data-page-id="dashboard"]')?.getAttribute('title')).toBeTruthy();
    // 分组标题留在 DOM 里只标记收起（Claude 风格据此做高度收起动画）
    const groupTitles = Array.from(document.querySelectorAll('.ub-rail .ub-nav__group-title'));
    expect(groupTitles.length).toBeGreaterThan(0);
    expect(groupTitles.every(title => title.classList.contains('is-collapsed'))).toBe(true);

    // 切回默认风格：所选主题重新生效，侧栏照常展开，页首标题消失
    pick('界面风格', '默认').click();
    await flush();
    expect(app.dataset.ubStyle).toBe('default');
    expect(app.dataset.ubColorScheme).toBe('dark');
    expect(document.querySelector('.ub-shell')?.classList.contains('is-rail-collapsed')).toBe(false);
    expect(document.querySelector('.ub-heading')).toBeNull();
    expect(document.querySelector('.ub-top__crumb')).toBeNull();
    expect(document.getElementById('acu-v2-host-claude-skin')?.textContent).toBe('');
    expect(document.getElementById('acu-v2-theme')!.textContent!.toLowerCase()).not.toContain('--acu-accent: #d97757');
  });
});
