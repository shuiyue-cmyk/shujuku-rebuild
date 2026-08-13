/**
 * useFormFillInjectionTarget — 写入目标世界书切换迁移
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createWorldbookConfig(target = 'character') {
  return {
    injectionTarget: target,
  } as any;
}

let worldbookConfig: ReturnType<typeof createWorldbookConfig>;
let runtimeState: { currentChatFileIdentifier_ACU: string; currentJsonTableData_ACU: any };

const mockSaveSettings = vi.fn();
const mockGetCurrentCharPrimaryLorebook = vi.fn();
const mockDeleteAllGeneratedEntries = vi.fn();
const mockUpdateReadableLorebookEntry = vi.fn();
const mockToast = {
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
};

async function getComposable(options: {
  target?: string;
  tableData?: any;
  charPrimary?: string | null;
} = {}) {
  vi.resetModules();
  worldbookConfig = createWorldbookConfig(options.target ?? 'character');
  runtimeState = {
    currentChatFileIdentifier_ACU: 'Chat-A',
    currentJsonTableData_ACU: options.tableData === undefined ? { sheet_1: { content: [['A'], ['B']] } } : options.tableData,
  };
  mockGetCurrentCharPrimaryLorebook.mockResolvedValue(options.charPrimary === undefined ? 'CharBook-A' : options.charPrimary);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    get currentChatFileIdentifier_ACU() {
      return runtimeState.currentChatFileIdentifier_ACU;
    },
    get currentJsonTableData_ACU() {
      return runtimeState.currentJsonTableData_ACU;
    },
  }));
  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentWorldbookConfig_ACU: () => worldbookConfig,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: mockSaveSettings,
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCharLorebooks_ACU: vi.fn(async () => ({ primary: 'CharBook-A', additional: [] })),
    getCurrentCharPrimaryLorebook_ACU: mockGetCurrentCharPrimaryLorebook,
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    deleteAllGeneratedEntries_ACU: mockDeleteAllGeneratedEntries,
    updateReadableLorebookEntry_ACU: mockUpdateReadableLorebookEntry,
  }));
  vi.doMock('../../../src/shared/utils', () => ({
    logDebug_ACU: vi.fn(),
    logError_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/presentation-v2/stores/toast-store', () => ({
    useToastStore: () => mockToast,
  }));

  const mod = await import('../../../src/presentation-v2/composables/useFormFillInjectionTarget');
  return mod.useFormFillInjectionTarget();
}

async function flushTargetSwitch(promise: Promise<void>): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(300);
  await promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  mockSaveSettings.mockReset();
  mockGetCurrentCharPrimaryLorebook.mockReset();
  mockDeleteAllGeneratedEntries.mockReset();
  mockUpdateReadableLorebookEntry.mockReset();
  mockDeleteAllGeneratedEntries.mockResolvedValue(undefined);
  mockUpdateReadableLorebookEntry.mockResolvedValue(undefined);
  mockToast.info.mockReset();
  mockToast.success.mockReset();
  mockToast.warning.mockReset();
  mockToast.error.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFormFillInjectionTarget', () => {
  it('从角色卡目标切到指定世界书时先清旧目标，再保存并重建新目标条目', async () => {
    const c = await getComposable({ target: 'character' });
    c.refreshFromSettings();

    const switching = c.onSelectorChange('Book-B');
    await flushTargetSwitch(switching);

    expect(mockGetCurrentCharPrimaryLorebook).toHaveBeenCalledTimes(1);
    expect(mockDeleteAllGeneratedEntries).toHaveBeenCalledWith('CharBook-A');
    expect(worldbookConfig.injectionTarget).toBe('Book-B');
    expect(c.target.value).toBe('Book-B');
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockUpdateReadableLorebookEntry).toHaveBeenCalledWith(true);
    expect(mockDeleteAllGeneratedEntries.mock.invocationCallOrder[0]).toBeLessThan(mockSaveSettings.mock.invocationCallOrder[0]);
    expect(mockSaveSettings.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateReadableLorebookEntry.mock.invocationCallOrder[0]);
    expect(mockToast.info).toHaveBeenCalledWith('正在从旧目标 [CharBook-A] 中清除条目...', { muteable: false });
    expect(mockToast.info).toHaveBeenCalledWith('正在向新目标注入条目...', { muteable: false });
    expect(mockToast.success).toHaveBeenCalledWith('数据注入目标已成功切换！', { muteable: false });
  });

  it('旧目标为指定世界书且当前无表格数据时只保存新目标并提示无数据', async () => {
    const c = await getComposable({ target: 'Book-A', tableData: null });

    const switching = c.onSelectorChange('Book-B');
    await flushTargetSwitch(switching);

    expect(mockGetCurrentCharPrimaryLorebook).not.toHaveBeenCalled();
    expect(mockDeleteAllGeneratedEntries).toHaveBeenCalledWith('Book-A');
    expect(worldbookConfig.injectionTarget).toBe('Book-B');
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockUpdateReadableLorebookEntry).not.toHaveBeenCalled();
    expect(mockToast.warning).toHaveBeenCalledWith('数据注入目标已更新，但当前无数据可注入。', { muteable: false });
  });

  it('选择相同目标时不清理、不保存、不注入', async () => {
    const c = await getComposable({ target: 'character' });

    await c.onSelectorChange('character');

    expect(mockDeleteAllGeneratedEntries).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockUpdateReadableLorebookEntry).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalled();
  });
});
