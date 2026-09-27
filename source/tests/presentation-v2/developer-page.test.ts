/**
 * DeveloperPage 集成 — 开发者字段与运行参数
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 2,
    updateBatchSize: 2,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoUpdateTokenThreshold: 500,
    tableMaxRetries: 3,
    tableEditLastPairOnly: true,
    tableContextExtractTags: '',
    tableContextExtractRules: [],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [],
    storageMode: 'native',
    tableApiPreset: '',
    charCardPrompt: [
      { role: 'USER', content: '主任务', mainSlot: 'A', isMain: true, deletable: false },
      { role: 'USER', content: '数据段', mainSlot: 'B', isMain2: true, deletable: false },
    ],
    apiPresets: [],
    defaultApiPresetName: '',
    apiPresetBindingsByChat: {},
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

async function mountDeveloperPage(extraDevOptions: Record<string, unknown> = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      router: { activePageId: 'developer' },
      devOptions: { developerOptionsEnabled: true, ...extraDevOptions },
    }),
  );

  const settings = createSettings();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));

  vi.doMock('../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-dev',
    currentJsonTableData_ACU: {},
    coreApisAreReady_ACU: true,
    getCurrentIsolationKey_ACU: () => '',
  }));
  vi.doMock('../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
    setGlobalPlotEnabled_ACU: vi.fn(),
    setSummaryVectorIndexMode_ACU: vi.fn(),
  }));
  vi.doMock('../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => settings.storageMode,
    isSqliteMode: () => false,
  }));
  vi.doMock('../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: () => [],
  }));
  vi.doMock('../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: () => [],
    getCurrentChatPlotScopeState_ACU: () => null,
    setCurrentChatPlotScopeState_ACU: vi.fn(),
  }));
  vi.doMock('../../src/service/template/template-preset-service', () => ({
    getActiveTemplatePresetMeta_ACU: () => ({ displayName: '默认预设', scopeLabel: '全局' }),
  }));
  vi.doMock('../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));

  const mount = await import('../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return { mount, settings, saveSettings };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DeveloperPage', () => {
  it('渲染开发者开关和填表执行参数', async () => {
    const { mount } = await mountDeveloperPage();

    const page = document.querySelector('.acu-v2-developer-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(text).toContain('开发者 gated 字段');
    expect(text).toContain('填表执行参数');
    expect(text).toContain('最大并发更新组数');

    mount.__resetAcuV2MountForTests();
  });

  it('最大并发更新组数输入会保存到 settings', async () => {
    const { mount, settings, saveSettings } = await mountDeveloperPage();

    const panel = Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-developer-page .acu-panel'))
      .find(el => el.querySelector('.acu-panel__title')?.textContent?.includes('填表执行参数'))!;
    const input = panel.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '4';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.maxConcurrentGroups).toBe(4);
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  /**
   * 「WARN 日志」开关。
   *
   * 它此前只有存储层与 log-buffer 的常驻来源，UI 上没有任何入口：
   * 旧版本遗留的 `devOptions.warnLogEnabled=true` 会让用户"启动就看到 warn"，
   * 却既看不到也关不掉。本组用例把"看得见 + 关得掉"钉住。
   */
  describe('WARN 日志开关（常驻采集来源）', () => {
    function findWarnToggle(): HTMLButtonElement | undefined {
      return document.querySelector<HTMLButtonElement>('button[data-acu-toggle-key="warnLogEnabled"]');
    }

    it('无遗留设置时开关可见且为关：warn 不入缓冲区（只有 error）', async () => {
      const { mount } = await mountDeveloperPage();
      const { isWarnLogEnabled } = await import('../../src/shared/log-buffer');

      const toggle = findWarnToggle();
      expect(toggle, '开发者页必须有 WARN 日志开关，否则遗留状态无从关闭').not.toBeUndefined();
      expect(toggle!.getAttribute('aria-checked')).toBe('false');
      expect(isWarnLogEnabled()).toBe(false);

      mount.__resetAcuV2MountForTests();
    });

    it('遗留 devOptions.warnLogEnabled=true 时开关显示为开，点一下即可真正关掉采集并写回存储', async () => {
      const { mount } = await mountDeveloperPage({ warnLogEnabled: true });
      const { isWarnLogEnabled } = await import('../../src/shared/log-buffer');

      const toggle = findWarnToggle();
      expect(toggle).not.toBeUndefined();
      expect(toggle!.getAttribute('aria-checked'), '持久化的开必须回显到 UI').toBe('true');
      expect(isWarnLogEnabled()).toBe(true);

      toggle!.click();
      await new Promise(r => setTimeout(r, 0));

      expect(isWarnLogEnabled(), '关闭后 warn 必须停止采集').toBe(false);
      expect(findWarnToggle()!.getAttribute('aria-checked')).toBe('false');
      const persisted = JSON.parse(localStorage.getItem('acu_v2_ui_state') || '{}');
      expect(persisted.devOptions.warnLogEnabled, '关闭必须落盘，否则下次启动又复活').toBe(false);

      mount.__resetAcuV2MountForTests();
    });
  });
});
