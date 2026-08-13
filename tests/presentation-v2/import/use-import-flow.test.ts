/**
 * useImportFlow — 阶段 2 外部导入页业务流编排
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup({
  charPrimary = 'CharBook',
  clearedCount = 0,
  deletedCount = 0,
}: {
  charPrimary?: string | null;
  clearedCount?: number;
  deletedCount?: number;
} = {}) {
  vi.resetModules();
  const importTempRemove = vi.fn(async () => undefined);
  const importTempSet = vi.fn(async () => undefined);
  const importTempGet = vi.fn(async () => null);
  const clearImportedEntriesCore = vi.fn(async () => ({ deletedCount: clearedCount, localCleared: true }));
  const deleteImportedEntriesCore = vi.fn(async () => deletedCount);
  const initImportDatabase = vi.fn(async (_target: string, _keys: string[], chunks: any[], selectionSig: string) => ({
    success: true,
    status: { total: chunks.length, currentIndex: 0, selectionSig },
    modeSuffix: '-Selected',
  }));
  const saveChunkProgress = vi.fn(async (_target: string, _suffix: string, status: any, index: number) => {
    status.currentIndex = index + 1;
    return true;
  });
  const finalizeImportAndCleanup = vi.fn(async () => ({ success: true, cleanedCount: 0 }));
  const executeCardUpdateCore = vi.fn(async () => ({ success: true, modifiedKeys: ['sheetA'] }));
  const getCharPrimary = vi.fn(async () => charPrimary);
  const abortAllActiveRequests = vi.fn();
  const setWasStoppedByUser = vi.fn();
  const settings: any = {
    importWorldbookTarget: 'world-A',
    importSplitSize: 100,
    importSelectedTables: ['sheetA'],
    hasImportTableSelection: true,
    importPromptExcludeImportedWorldbookEntries: true,
  };

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentJsonTableData_ACU: { sheetA: { name: 'A' } },
    abortAllActiveRequests_ACU: abortAllActiveRequests,
    _set_wasStoppedByUser_ACU: setWasStoppedByUser,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: vi.fn() }));
  vi.doMock('../../../src/shared/idb-import-temp', () => ({
    importTempGet_ACU: importTempGet,
    importTempRemove_ACU: importTempRemove,
    importTempSet_ACU: importTempSet,
  }));
  vi.doMock('../../../src/service/import/import-executor', () => ({
    clearImportedEntriesCore_ACU: clearImportedEntriesCore,
    deleteImportedEntriesCore_ACU: deleteImportedEntriesCore,
    finalizeImportAndCleanup_ACU: finalizeImportAndCleanup,
    initImportDatabase_ACU: initImportDatabase,
    saveChunkProgress_ACU: saveChunkProgress,
  }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    executeCardUpdateCore_ACU: executeCardUpdateCore,
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: getCharPrimary,
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (data: any) => (data ? Object.keys(data) : []),
  }));
  vi.doMock('../../../src/shared/utils', () => ({
    parseTableTemplateJson_ACU: () => ({ sheetA: { name: 'A' } }),
    logError_ACU: vi.fn(),
    logDebug_ACU: vi.fn(),
  }));

  const [{ setActivePinia, createPinia }, { useImportFlowStore }, { useImportFlow }, { useToastStore }] = await Promise.all([
    import('pinia'),
    import('../../../src/presentation-v2/stores/import-flow-store'),
    import('../../../src/presentation-v2/composables/useImportFlow'),
    import('../../../src/presentation-v2/stores/toast-store'),
  ]);
  setActivePinia(createPinia());
  const store = useImportFlowStore();
  store.refreshFromSettings();
  const flow = useImportFlow();
  const toast = useToastStore();
  return {
    flow,
    store,
    toast,
    importTempRemove,
    importTempSet,
    importTempGet,
    clearImportedEntriesCore,
    deleteImportedEntriesCore,
    initImportDatabase,
    saveChunkProgress,
    finalizeImportAndCleanup,
    executeCardUpdateCore,
    getCharPrimary,
    abortAllActiveRequests,
    setWasStoppedByUser,
    settings,
  };
}

class FakeFile {
  constructor(public name: string, public _content: string) {}
}

class FakeFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((this: FakeFileReader, ev: any) => any) | null = null;
  onerror: ((this: FakeFileReader, ev: any) => any) | null = null;
  error: any = null;
  readAsText(blob: any, _encoding?: string): void {
    setTimeout(() => {
      this.result = blob?._content ?? '';
      this.onload?.call(this, { target: this });
    }, 0);
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error stub
  globalThis.FileReader = FakeFileReader;
});

describe('useImportFlow', () => {
  it('splitFile 按字符数拆分并写入 IndexedDB', async () => {
    const { flow, store, toast, importTempSet, importTempRemove } = await setup();
    const content = 'x'.repeat(550); // 550 chars / 200 -> 3 chunks (200, 200, 150)
    const file: any = new FakeFile('a.txt', content);
    store.setSplitSize(200);

    await flow.splitFile(file);

    expect(importTempRemove).toHaveBeenCalled();
    expect(importTempSet).toHaveBeenCalledTimes(1);
    const [key, value] = importTempSet.mock.calls[0];
    expect(String(key)).toContain('importedTxtEntries');
    const chunks = JSON.parse(String(value));
    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toHaveLength(200);
    expect(chunks[2].content).toHaveLength(150);
    expect(toast.items.at(-1)).toMatchObject({ kind: 'success' });
  });

  it('clearStaging 清空所有暂存键并发出消息', async () => {
    const { flow, toast, importTempRemove } = await setup();
    await flow.clearStaging();

    expect(importTempRemove).toHaveBeenCalledTimes(5);
    expect(['success', 'info']).toContain(toast.items.at(-1)?.kind);
  });

  it('clearImportedEntries 把 character sentinel 解析为角色卡主世界书', async () => {
    const { flow, store, toast, clearImportedEntriesCore } = await setup({ charPrimary: 'CharBook', clearedCount: 7 });
    store.setWorldbookTarget('character');

    await flow.clearImportedEntries();

    expect(clearImportedEntriesCore).toHaveBeenCalledWith('CharBook');
    expect(toast.items.at(-1)).toMatchObject({ kind: 'success' });
    expect(toast.items.at(-1)?.text).toMatch(/7 个/);
  });

  it('deleteImportedEntries 在没有目标时报错', async () => {
    const { flow, store, toast } = await setup();
    store.setWorldbookTarget('');

    await flow.deleteImportedEntries();

    expect(toast.items.at(-1)).toMatchObject({ kind: 'error' });
  });

  it('injectChunks 处理暂存分块并完成最终注入', async () => {
    const {
      flow,
      toast,
      importTempGet,
      initImportDatabase,
      saveChunkProgress,
      finalizeImportAndCleanup,
      executeCardUpdateCore,
    } = await setup();
    importTempGet.mockImplementation(async (key: string) => {
      if (key.endsWith('importedTxtEntries')) {
        return JSON.stringify([{ content: '第一段' }, { content: '第二段' }]);
      }
      return null;
    });

    await flow.injectChunks();

    expect(initImportDatabase).toHaveBeenCalledWith('world-A', ['sheetA'], expect.any(Array), JSON.stringify(['sheetA']));
    expect(executeCardUpdateCore).toHaveBeenCalledTimes(2);
    expect(saveChunkProgress).toHaveBeenCalledTimes(2);
    expect(finalizeImportAndCleanup).toHaveBeenCalledWith('world-A', ['sheetA'], '-Selected', 2);
    expect(toast.items).toHaveLength(1);
    expect(toast.items[0]).toMatchObject({ kind: 'success' });
  });

  it('injectChunks 在 v2 导入执行期间强制屏蔽外部导入条目并恢复旧设置', async () => {
    const {
      flow,
      importTempGet,
      executeCardUpdateCore,
      settings,
    } = await setup();
    settings.importPromptExcludeImportedWorldbookEntries = false;
    const observedValues: any[] = [];
    importTempGet.mockImplementation(async (key: string) => {
      if (key.endsWith('importedTxtEntries')) {
        return JSON.stringify([{ content: '第一段' }]);
      }
      return null;
    });
    executeCardUpdateCore.mockImplementation(async () => {
      observedValues.push(settings.importPromptExcludeImportedWorldbookEntries);
      return { success: true, modifiedKeys: ['sheetA'] };
    });

    await flow.injectChunks();

    expect(observedValues).toEqual([true]);
    expect(settings.importPromptExcludeImportedWorldbookEntries).toBe(false);
  });

  it('injectChunks 支持通过运行中 toast 终止并保存当前分块断点', async () => {
    const {
      flow,
      store,
      toast,
      importTempGet,
      importTempSet,
      saveChunkProgress,
      finalizeImportAndCleanup,
      executeCardUpdateCore,
      abortAllActiveRequests,
      setWasStoppedByUser,
    } = await setup();
    importTempGet.mockImplementation(async (key: string) => {
      if (key.endsWith('importedTxtEntries')) {
        return JSON.stringify([{ content: '第一段' }, { content: '第二段' }]);
      }
      return null;
    });
    executeCardUpdateCore.mockImplementation(async (...args: any[]) => {
      const abortController = args[7] as AbortController;
      const onProgress = args[9] as (event: any) => void;
      onProgress({ phase: 'calling_ai', attempt: 1, maxRetries: 3 });
      expect(toast.items[0]?.action?.label).toBe('终止');
      await toast.items[0]?.action?.onClick();
      expect(abortController.signal.aborted).toBe(true);
      return { success: false, modifiedKeys: [], aborted: true };
    });

    await flow.injectChunks();

    expect(abortAllActiveRequests).toHaveBeenCalledTimes(1);
    expect(setWasStoppedByUser).toHaveBeenCalledWith(true);
    expect(setWasStoppedByUser).toHaveBeenLastCalledWith(false);
    expect(executeCardUpdateCore).toHaveBeenCalledTimes(1);
    expect(saveChunkProgress).not.toHaveBeenCalled();
    expect(finalizeImportAndCleanup).not.toHaveBeenCalled();
    expect(importTempSet).toHaveBeenCalledWith(
      expect.stringContaining('importedTxtStatus'),
      expect.stringContaining('"currentIndex":0'),
    );
    expect(store.busy).toBe(false);
    expect(toast.items[0]).toMatchObject({ kind: 'warning' });
    expect(toast.items[0]?.text).toMatch(/已保存断点/);
  });
});
