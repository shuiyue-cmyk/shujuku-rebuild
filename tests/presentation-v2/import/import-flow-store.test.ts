/**
 * import-flow-store — 阶段 2 外部导入页 store 语义
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSettings() {
  return {
    importWorldbookTarget: 'world-A',
    importSplitSize: 8000,
    importSelectedTables: ['sheetA'],
    hasImportTableSelection: true,
    importPromptExcludeImportedWorldbookEntries: true,
  } as any;
}

async function importStore(settings: any, sheetData: any = null) {
  vi.resetModules();
  const saveSettings = vi.fn(() => ({ saved: true }));
  const importTempGet = vi.fn(async () => null);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentJsonTableData_ACU: sheetData,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../../src/shared/idb-import-temp', () => ({
    importTempGet_ACU: importTempGet,
    importTempRemove_ACU: vi.fn(async () => undefined),
    importTempSet_ACU: vi.fn(async () => undefined),
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (data: any) => (data ? Object.keys(data) : []),
  }));
  vi.doMock('../../../src/shared/utils', () => ({
    parseTableTemplateJson_ACU: () => ({ sheetA: { name: 'A 表' }, sheetB: { name: 'B 表' } }),
    logError_ACU: vi.fn(),
    logDebug_ACU: vi.fn(),
  }));

  const [{ setActivePinia, createPinia }, { useImportFlowStore }] = await Promise.all([
    import('pinia'),
    import('../../../src/presentation-v2/stores/import-flow-store'),
  ]);
  setActivePinia(createPinia());
  return { store: useImportFlowStore(), saveSettings, importTempGet };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useImportFlowStore', () => {
  it('从 settings 读取目标 / 拆分尺寸 / 选中表，并从模板加载可选表清单', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.worldbookTarget).toBe('world-A');
    expect(store.splitSize).toBe(8000);
    expect(store.selectedSheetKeys).toEqual(['sheetA']);
    expect(store.hasTableSelection).toBe(true);
    expect(store.availableSheetKeys).toEqual(['sheetA', 'sheetB']);
    expect(store.sheetNames).toEqual({ sheetA: 'A 表', sheetB: 'B 表' });
  });

  it('setWorldbookTarget 写回 settings 并触发保存', async () => {
    const settings = createSettings();
    const { store, saveSettings } = await importStore(settings);
    store.refreshFromSettings();

    store.setWorldbookTarget('world-B');

    expect(store.worldbookTarget).toBe('world-B');
    expect(settings.importWorldbookTarget).toBe('world-B');
    expect(saveSettings).toHaveBeenCalled();
  });

  it('未明确选择过表格时默认选中全部可用表', async () => {
    const settings = createSettings();
    settings.importSelectedTables = [];
    settings.hasImportTableSelection = false;
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.selectedSheetKeys).toEqual(['sheetA', 'sheetB']);
    expect(store.hasTableSelection).toBe(false);
  });

  it('setSplitSize 兜底非法值并保留下限 100', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    store.setSplitSize(-1);
    expect(store.splitSize).toBe(10000);

    store.setSplitSize(50);
    expect(store.splitSize).toBe(100);

    store.setSplitSize(2500);
    expect(store.splitSize).toBe(2500);
  });

  it('selectAll / selectNone 切换选中表并标记 hasTableSelection', async () => {
    const settings = createSettings();
    const { store, saveSettings } = await importStore(settings);
    store.refreshFromSettings();

    store.selectNoneSheets();
    expect(store.selectedSheetKeys).toEqual([]);
    expect(store.hasTableSelection).toBe(true);
    expect(settings.importSelectedTables).toEqual([]);

    store.selectAllSheets();
    expect(store.selectedSheetKeys).toEqual(['sheetA', 'sheetB']);
    expect(saveSettings).toHaveBeenCalled();
  });

  it('canInject 在缺少缓存 / 目标 / 必选表时返回 false', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.canInject).toBe(false); // no staging chunks

    store.staging = { hasChunks: true, chunkCount: 3, totalChars: 300, processedIndex: null, selectionSig: null };
    expect(store.canInject).toBe(true);

    store.setWorldbookTarget('');
    expect(store.canInject).toBe(false);

    store.setWorldbookTarget('world-A');
    store.selectNoneSheets();
    expect(store.canInject).toBe(false);
  });

  it('refreshStaging 反映 IndexedDB 实时状态（D21.5）', async () => {
    const settings = createSettings();
    const { store, importTempGet } = await importStore(settings);
    store.refreshFromSettings();

    importTempGet.mockImplementation(async (key: string) => {
      if (key.endsWith('importedTxtEntries')) return JSON.stringify([{ content: 'aaa' }, { content: 'bbbb' }]);
      if (key.endsWith('importedTxtStatus')) return JSON.stringify({ currentIndex: 1, total: 2, selectionSig: '[]' });
      return null;
    });

    await store.refreshStaging();

    expect(store.staging.hasChunks).toBe(true);
    expect(store.staging.chunkCount).toBe(2);
    expect(store.staging.totalChars).toBe(7);
    expect(store.staging.processedIndex).toBe(1);
  });

  it('statusText 在不同 staging 状态下给出对应文案', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.statusText).toMatch(/尚未加载文件/);

    store.staging = { hasChunks: true, chunkCount: 5, totalChars: 100, processedIndex: 0, selectionSig: null };
    expect(store.statusText).toMatch(/已暂停/);
    expect(store.statusText).toMatch(/0\/5/);

    store.staging = { hasChunks: true, chunkCount: 5, totalChars: 100, processedIndex: 2, selectionSig: null };
    expect(store.statusText).toMatch(/已暂停/);

    store.staging = { hasChunks: true, chunkCount: 5, totalChars: 100, processedIndex: null, selectionSig: null };
    expect(store.statusText).toMatch(/已准备好 5/);

    store.selectNoneSheets();
    expect(store.statusText).toMatch(/未选择任何表格/);
  });
});
