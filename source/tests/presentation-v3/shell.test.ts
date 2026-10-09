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
      'data-mgmt', 'developer', 'form-fill', 'plot', 'table', 'vector-index',
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
});

