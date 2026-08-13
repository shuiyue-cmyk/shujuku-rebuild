/**
 * usePlotWorldbookConfig — 手动世界书多选配置
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSettings() {
  return {
    plotSettings: {
      plotWorldbookConfig: {
        source: 'character',
        manualSelection: [],
        enabledEntries: {},
      },
    },
  } as any;
}

let settings: ReturnType<typeof createSettings>;
const mockSaveSettings = vi.fn();
const mockGetCurrentCharacterWorldbookBinding = vi.fn();

async function getComposable() {
  vi.resetModules();
  settings = createSettings();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: mockSaveSettings,
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharacterWorldbookBinding_ACU: mockGetCurrentCharacterWorldbookBinding,
  }));

  const mod = await import('../../../src/presentation-v2/composables/usePlotWorldbookConfig');
  return mod.usePlotWorldbookConfig();
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockSaveSettings.mockClear();
  mockGetCurrentCharacterWorldbookBinding.mockReset();
});

describe('usePlotWorldbookConfig', () => {
  it('手动选择支持多本世界书并去重保存', async () => {
    const c = await getComposable();
    c.refreshFromSettings();

    c.setManualSelection(['Book-A', 'Book-B', 'Book-A', '']);

    expect(settings.plotSettings.plotWorldbookConfig.source).toBe('manual');
    expect(settings.plotSettings.plotWorldbookConfig.manualSelection).toEqual(['Book-A', 'Book-B']);
    expect(c.manualSelection.value).toEqual(['Book-A', 'Book-B']);
    expect(await c.resolveBookNames()).toEqual(['Book-A', 'Book-B']);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('角色卡来源直接使用统一 binding resolver 的 orderedNames', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主书',
      additional: ['副书'],
      orderedNames: ['主书', '副书'],
      apiSource: 'getCharWorldbookNames',
    });
    const c = await getComposable();

    await expect(c.resolveBookNames()).resolves.toEqual(['主书', '副书']);
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledWith();
  });

  it('角色绑定 resolver 失败时向调用方传播异常，不伪装为空绑定', async () => {
    const error = new Error('CharacterWorldbookApiUnavailableError_ACU');
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(error);
    const c = await getComposable();

    await expect(c.resolveBookNames()).rejects.toBe(error);
  });

  it('切回角色卡来源时保留手动选择数组', async () => {
    const c = await getComposable();
    c.setManualSelection(['Book-A', 'Book-B']);
    mockSaveSettings.mockClear();

    c.setSource('character');

    expect(settings.plotSettings.plotWorldbookConfig.source).toBe('character');
    expect(settings.plotSettings.plotWorldbookConfig.manualSelection).toEqual(['Book-A', 'Book-B']);
    expect(c.manualSelection.value).toEqual(['Book-A', 'Book-B']);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('toggleManualBook 按勾选状态增删书名', async () => {
    const c = await getComposable();
    c.refreshFromSettings();

    c.toggleManualBook('Book-A', true);
    c.toggleManualBook('Book-B', true);
    c.toggleManualBook('Book-A', false);

    expect(settings.plotSettings.plotWorldbookConfig.manualSelection).toEqual(['Book-B']);
    expect(c.manualSelection.value).toEqual(['Book-B']);
  });
});
