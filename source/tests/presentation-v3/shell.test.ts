/**
 * 新版界面外壳：挂载、逐页渲染无异常、切换经典界面往返。
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
  it('注册新版后默认挂载新版界面，所有可见页面渲染无异常', { timeout: 90000 }, async () => {
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

  it('切回经典界面再切回新版，路由状态保留', async () => {
    const { mount, router } = await mountV3();
    cleanup = () => mount.__resetAcuV2MountForTests();
    router.setActivePage('api');
    await flush();

    mount.switchAcuUiGeneration('classic');
    await flush();
    expect(document.querySelector('.acu-v2-app')).not.toBeNull();
    expect(document.querySelector('.ub-app')).toBeNull();
    expect(document.querySelector('.acu-v2-app__page-title')?.textContent).toContain('API');

    const back = document.querySelector<HTMLButtonElement>('button[title="切换到新版界面"]');
    expect(back).not.toBeNull();
    back!.click();
    await flush();
    expect(document.querySelector('.ub-app')).not.toBeNull();
    expect(document.querySelector('.ub-top__title')?.textContent).toContain('API');
  });
});
