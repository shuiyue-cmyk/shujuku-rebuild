/**
 * useFormFillWorldbookConfig — 附加世界书条目来源多选配置
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createWorldbookConfig() {
  return {
    source: 'character',
    manualSelection: [],
    enabledEntries: {},
  } as any;
}

let worldbookConfig: ReturnType<typeof createWorldbookConfig>;
const mockSaveSettings = vi.fn();
const mockGetCharLorebooks = vi.fn();

async function getComposable() {
  vi.resetModules();
  worldbookConfig = createWorldbookConfig();

  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentWorldbookConfig_ACU: () => worldbookConfig,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: mockSaveSettings,
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCharLorebooks_ACU: mockGetCharLorebooks,
  }));

  const mod = await import('../../../src/presentation-v2/composables/useFormFillWorldbookConfig');
  return mod.useFormFillWorldbookConfig();
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockSaveSettings.mockClear();
  mockGetCharLorebooks.mockReset();
});

describe('useFormFillWorldbookConfig', () => {
  it('手动选择支持多本世界书并去重保存', async () => {
    const c = await getComposable();
    c.refreshFromSettings();

    c.setManualSelection(['Book-A', 'Book-B', 'Book-A', '']);

    expect(worldbookConfig.source).toBe('manual');
    expect(worldbookConfig.manualSelection).toEqual(['Book-A', 'Book-B']);
    expect(c.manualSelection.value).toEqual(['Book-A', 'Book-B']);
    expect(await c.resolveBookNames()).toEqual(['Book-A', 'Book-B']);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('切回角色卡来源时保留手动选择数组', async () => {
    const c = await getComposable();
    c.setManualSelection(['Book-A', 'Book-B']);
    mockSaveSettings.mockClear();

    c.setSource('character');

    expect(worldbookConfig.source).toBe('character');
    expect(worldbookConfig.manualSelection).toEqual(['Book-A', 'Book-B']);
    expect(c.manualSelection.value).toEqual(['Book-A', 'Book-B']);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('toggleManualBook 按勾选状态增删书名', async () => {
    const c = await getComposable();
    c.refreshFromSettings();

    c.toggleManualBook('Book-A', true);
    c.toggleManualBook('Book-B', true);
    c.toggleManualBook('Book-A', false);

    expect(worldbookConfig.manualSelection).toEqual(['Book-B']);
    expect(c.manualSelection.value).toEqual(['Book-B']);
  });
});
