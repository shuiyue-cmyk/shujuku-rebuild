/**
 * 新版界面外壳：挂载、逐页渲染无异常、关闭重开保留路由。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
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

  it('基础模式只显示基础配置页，且四个分节齐全', async () => {
    const { mount, errors, router } = await mountV3({ uiState: { uiMode: { mode: 'basic' }, router: { activePageId: 'basic-config' } } });
    cleanup = () => mount.__resetAcuV2MountForTests();
    await flush(6);
    expect(router.visiblePages.map(p => p.id)).toEqual(['basic-config']);
    for (const id of ['basic-api-preset', 'basic-update', 'basic-table', 'basic-plot']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
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

  it('顶栏右侧只留关闭按钮；外观入口在侧栏左下与手机「全部页面」面板底部', async () => {
    const { mount } = await mountV3();
    cleanup = () => mount.__resetAcuV2MountForTests();

    const topButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-top > button'))
      .filter(button => !button.classList.contains('ub-top__menu'))
      .map(button => button.getAttribute('title'));
    expect(topButtons).toEqual(['关闭 UnbirthDB']);
    expect(document.querySelector('.ub-top button[title="外观与界面"]')).toBeNull();

    document.querySelector<HTMLButtonElement>('.ub-top__menu')!.click();
    await flush();
    const launcherAppearance = Array.from(document.querySelectorAll<HTMLButtonElement>('.ub-launcher__foot button'))
      .find(button => button.textContent?.includes('外观与界面'));
    expect(launcherAppearance).toBeDefined();
    launcherAppearance!.click();
    await flush();
    expect(document.querySelector('.ub-launcher')).toBeNull();
    expect(document.querySelector('#ub-portal .ub-sheet-layer')?.textContent).toContain('界面缩放');
  });
});
