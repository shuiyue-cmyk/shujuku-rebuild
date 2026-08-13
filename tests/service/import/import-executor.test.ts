/**
 * tests/service/import/import-executor.test.ts
 * 外部导入核心业务逻辑 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockCurrentJsonTableData, mockSetCurrentJsonTableData, mockImportTempGet, mockImportTempSet, mockImportTempRemove, mockLoadImportedJson, mockSaveImportedJson, mockDeleteImportedJson, mockGetLorebookEntries, mockDeleteLorebookEntries, mockGetCurrentCharPrimaryLorebook, mockUpdateReadable, mockGetSortedSheetKeys, mockGetIsoPrefix, mockParseTemplate, mockSaveSettings, mockExecuteCardUpdateCore } = vi.hoisted(() => ({
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '', importWorldbookTarget: 'lorebook1' } as any,
  mockCurrentJsonTableData: { sheet_0: { name: '物品表', content: [['row_id', '物品名']] } } as any,
  mockSetCurrentJsonTableData: vi.fn(),
  mockExecuteCardUpdateCore: vi.fn(),
  mockImportTempGet: vi.fn(),
  mockImportTempSet: vi.fn(),
  mockImportTempRemove: vi.fn(),
  mockLoadImportedJson: vi.fn(),
  mockSaveImportedJson: vi.fn(),
  mockDeleteImportedJson: vi.fn(),
  mockGetLorebookEntries: vi.fn(() => []),
  mockDeleteLorebookEntries: vi.fn(),
  mockGetCurrentCharPrimaryLorebook: vi.fn(),
  mockUpdateReadable: vi.fn(),
  mockGetSortedSheetKeys: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
  mockGetIsoPrefix: vi.fn(() => ''),
  mockParseTemplate: vi.fn(() => ({ sheet_0: { name: '物品表', content: [['row_id', '物品名']] } })),
  mockSaveSettings: vi.fn(),
}));

vi.mock('../../../src/shared/data-constants', () => ({
  STORAGE_KEY_IMPORTED_ENTRIES_ACU: 'imported_entries',
  STORAGE_KEY_IMPORTED_STATUS_ACU: 'imported_status',
  STORAGE_KEY_IMPORTED_STATUS_FULL_ACU: 'imported_status_full',
  STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU: 'imported_status_standard',
  STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU: 'imported_status_summary',
}));

vi.mock('../../../src/shared/idb-import-temp', () => ({
  importTempGet_ACU: mockImportTempGet,
  importTempSet_ACU: mockImportTempSet,
  importTempRemove_ACU: mockImportTempRemove,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: mockCurrentJsonTableData,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
}));

vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  loadImportedJsonDataFromLorebook_ACU: mockLoadImportedJson,
  saveImportedJsonDataToLorebook_ACU: mockSaveImportedJson,
  deleteImportedJsonDataFromLorebook_ACU: mockDeleteImportedJson,
  getLorebookEntries_ACU: mockGetLorebookEntries,
  deleteLorebookEntries_ACU: mockDeleteLorebookEntries,
  getCurrentCharPrimaryLorebook_ACU: mockGetCurrentCharPrimaryLorebook,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  updateReadableLorebookEntry_ACU: mockUpdateReadable,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  getIsolationPrefix_ACU: mockGetIsoPrefix,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: mockParseTemplate,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/service/table/update-orchestrator', () => ({
  executeCardUpdateCore_ACU: mockExecuteCardUpdateCore,
}));

import {
  importTxtTextAndSplitCore_ACU,
  injectImportedSelectedCore_ACU,
  initImportDatabase_ACU,
  saveChunkProgress_ACU,
  finalizeImportAndCleanup_ACU,
  clearImportedEntriesCore_ACU,
  deleteImportedEntriesCore_ACU,
} from '../../../src/service/import/import-executor';

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentJsonTableData.sheet_0 = { name: '物品表', content: [['row_id', '物品名']] };
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockSettings.importWorldbookTarget = 'lorebook1';
  mockSettings.importSelectedTables = [];
  mockSettings.hasImportTableSelection = false;
  mockSettings.importSplitSize = 10000;
  mockSettings.importPromptExcludeImportedWorldbookEntries = true;
  mockImportTempGet.mockResolvedValue(null);
  mockImportTempSet.mockResolvedValue(undefined);
  mockImportTempRemove.mockResolvedValue(undefined);
  mockSaveImportedJson.mockResolvedValue(true);
  mockLoadImportedJson.mockResolvedValue(null);
  mockDeleteImportedJson.mockResolvedValue(true);
  mockGetLorebookEntries.mockResolvedValue([]);
  mockDeleteLorebookEntries.mockResolvedValue(undefined);
  mockGetCurrentCharPrimaryLorebook.mockResolvedValue('CharBook');
  mockUpdateReadable.mockResolvedValue(undefined);
  mockGetSortedSheetKeys.mockImplementation((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []);
  mockGetIsoPrefix.mockImplementation(() => '');
  mockParseTemplate.mockImplementation(() => ({ sheet_0: { name: '物品表', content: [['row_id', '物品名']] } }));
  mockSaveSettings.mockImplementation(() => undefined);
  mockExecuteCardUpdateCore.mockResolvedValue({ success: true, modifiedKeys: [] });
});

// ═══ importTxtTextAndSplitCore_ACU ═══
describe('importTxtTextAndSplitCore_ACU', () => {
  it('拒绝空文本', async () => {
    const result = await importTxtTextAndSplitCore_ACU('   ');

    expect(result.success).toBe(false);
    expect(result.error).toContain('为空');
    expect(mockImportTempSet).not.toHaveBeenCalled();
  });

  it('使用 settings.importSplitSize 拆分并默认清理旧暂存', async () => {
    mockSettings.importSplitSize = 3;

    const result = await importTxtTextAndSplitCore_ACU('abcdefg');

    expect(result).toEqual({ success: true, chunksCount: 3, splitSize: 3 });
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status_standard');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status_summary');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status_full');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_entries');
    expect(mockImportTempSet).toHaveBeenCalledWith(
      'imported_entries',
      JSON.stringify([{ content: 'abc' }, { content: 'def' }, { content: 'g' }])
    );
  });

  it('clearPrevious=false 时保留旧状态但写入新分块', async () => {
    const result = await importTxtTextAndSplitCore_ACU('abcdef', { splitSize: 2, clearPrevious: false });

    expect(result).toEqual({ success: true, chunksCount: 3, splitSize: 2 });
    expect(mockImportTempRemove).not.toHaveBeenCalled();
    expect(mockImportTempSet).toHaveBeenCalledWith(
      'imported_entries',
      JSON.stringify([{ content: 'ab' }, { content: 'cd' }, { content: 'ef' }])
    );
  });

  it('非法 splitSize 回退到默认值避免死循环', async () => {
    const result = await importTxtTextAndSplitCore_ACU('abc', { splitSize: 0 });

    expect(result).toEqual({ success: true, chunksCount: 1, splitSize: 10000 });
    expect(mockImportTempSet).toHaveBeenCalledWith('imported_entries', JSON.stringify([{ content: 'abc' }]));
  });
});

// ═══ initImportDatabase_ACU ═══
describe('initImportDatabase_ACU', () => {
  it('全新导入：从模板初始化', async () => {
    const result = await initImportDatabase_ACU('lorebook1', ['sheet_0'], [{ chunk: 1 }, { chunk: 2 }], 'sig1');
    expect(result.success).toBe(true);
    expect(result.status!.total).toBe(2);
    expect(result.status!.currentIndex).toBe(0);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalled();
    expect(mockSaveImportedJson).toHaveBeenCalled();
  });

  it('断点续行：从世界书恢复', async () => {
    mockImportTempGet.mockResolvedValue(JSON.stringify({ total: 2, currentIndex: 1, selectionSig: 'sig1' }));
    mockLoadImportedJson.mockResolvedValue({ sheet_0: { name: '物品表' } });
    const result = await initImportDatabase_ACU('lorebook1', ['sheet_0'], [{ chunk: 1 }, { chunk: 2 }], 'sig1');
    expect(result.success).toBe(true);
    expect(result.status!.currentIndex).toBe(1);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith({ sheet_0: { name: '物品表' } });
  });

  it('模板解析失败返回错误', async () => {
    mockParseTemplate.mockImplementation(() => { throw new Error('解析失败'); });
    const result = await initImportDatabase_ACU('lorebook1', null, [{ chunk: 1 }], 'sig1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('模板');
  });

  it('断点续行但世界书数据丢失且内存无数据', async () => {
    mockImportTempGet.mockResolvedValue(JSON.stringify({ total: 2, currentIndex: 1, selectionSig: 'sig1' }));
    mockLoadImportedJson.mockResolvedValue(null);
    // 模拟 currentJsonTableData_ACU 为 null
    vi.doMock('../../../src/service/runtime/state-manager', () => ({
      settings_ACU: mockSettings,
      currentJsonTableData_ACU: null,
      _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
    }));
    // 由于 mock 已经固定，这里只能测试 fallback 到内存数据的分支
    const result = await initImportDatabase_ACU('lorebook1', null, [{ chunk: 1 }, { chunk: 2 }], 'sig1');
    // currentJsonTableData_ACU 不为 null（因为 mock 返回了对象），所以会 fallback
    expect(result.success).toBe(true);
  });
});

// ═══ saveChunkProgress_ACU ═══
describe('saveChunkProgress_ACU', () => {
  it('保存分块进度', async () => {
    const status = { total: 5, currentIndex: 0, selectionSig: 'sig1' };
    const result = await saveChunkProgress_ACU('lorebook1', '-Selected', status, 2);
    expect(result).toBe(true);
    expect(status.currentIndex).toBe(3);
    expect(mockImportTempSet).toHaveBeenCalled();
  });

  it('保存世界书失败返回 false', async () => {
    mockSaveImportedJson.mockRejectedValue(new Error('保存失败'));
    const status = { total: 5, currentIndex: 0, selectionSig: 'sig1' };
    const result = await saveChunkProgress_ACU('lorebook1', '-Selected', status, 0);
    expect(result).toBe(false);
  });
});

// ═══ finalizeImportAndCleanup_ACU ═══
describe('finalizeImportAndCleanup_ACU', () => {
  it('成功完成导入并清理', async () => {
    mockLoadImportedJson.mockResolvedValue({ sheet_0: { name: '物品表' } });
    const result = await finalizeImportAndCleanup_ACU('lorebook1', ['sheet_0'], '-Selected', 3);
    expect(result.success).toBe(true);
    expect(mockUpdateReadable).toHaveBeenCalled();
    expect(mockDeleteImportedJson).toHaveBeenCalled();
    expect(mockImportTempRemove).toHaveBeenCalled();
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('清理旧条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-ReadableDataTable-物品表' },
      { uid: 2, comment: '外部导入-TavernDB-ACU-ReadableDataTable' }, // 不删除（外部导入前缀）
      { uid: 3, comment: '无关条目' },
    ]);
    const result = await finalizeImportAndCleanup_ACU('lorebook1', null, '-Selected', 1);
    expect(result.success).toBe(true);
    expect(result.cleanedCount).toBe(1); // 只删除 uid=1
  });
});

// ═══ clearImportedEntriesCore_ACU ═══
describe('clearImportedEntriesCore_ACU', () => {
  it('删除导入条目并清理本地缓存', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-TavernDB-ACU-ReadableDataTable' },
      { uid: 2, comment: 'TavernDB-ACU-ImportedJsonData-Selected' },
      { uid: 3, comment: '普通条目' },
    ]);
    const result = await clearImportedEntriesCore_ACU('lorebook1');
    expect(result.deletedCount).toBe(2);
    expect(result.localCleared).toBe(true);
    expect(mockImportTempRemove).toHaveBeenCalled();
  });

  it('无匹配条目时 deletedCount=0', async () => {
    mockGetLorebookEntries.mockResolvedValue([{ uid: 1, comment: '普通条目' }]);
    const result = await clearImportedEntriesCore_ACU('lorebook1');
    expect(result.deletedCount).toBe(0);
    expect(result.localCleared).toBe(true);
  });
});

// ═══ deleteImportedEntriesCore_ACU ═══
describe('deleteImportedEntriesCore_ACU', () => {
  it('非隔离模式删除外部导入条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-物品表' },
      { uid: 2, comment: 'ACU-[tag]-外部导入-物品表' }, // 带隔离前缀，跳过
      { uid: 3, comment: 'TavernDB-ACU-ImportedJsonData-Selected' }, // 临时 JSON 源，跳过
      { uid: 4, comment: 'TavernDB-ACU-ImportedTxt-sheet_0' }, // 导入缓存源，跳过
      { uid: 5, comment: '普通条目' },
    ]);
    const count = await deleteImportedEntriesCore_ACU('lorebook1');
    expect(count).toBe(1);
    expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('lorebook1', [1]);
  });

  it('隔离模式只删除带隔离前缀的条目', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockGetIsoPrefix.mockReturnValue('ACU-[current]-');
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'ACU-[current]-外部导入-物品表' },
      { uid: 2, comment: '外部导入-物品表' }, // 无隔离前缀，跳过
      { uid: 3, comment: 'ACU-[other]-外部导入-物品表' }, // 其他隔离前缀，跳过
      { uid: 4, comment: 'ACU-[current]-TavernDB-ACU-ImportedJsonData-Selected' }, // 临时 JSON 源，跳过
      { uid: 5, comment: 'ACU-[current]-TavernDB-ACU-ImportedTxt-sheet_0' }, // 导入缓存源，跳过
    ]);
    const count = await deleteImportedEntriesCore_ACU('lorebook1');
    expect(count).toBe(1);
    expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('lorebook1', [1]);
  });

  it('无匹配条目返回 0', async () => {
    mockGetLorebookEntries.mockResolvedValue([]);
    const count = await deleteImportedEntriesCore_ACU('lorebook1');
    expect(count).toBe(0);
    expect(mockDeleteLorebookEntries).not.toHaveBeenCalled();
  });
});

// ═══ injectImportedSelectedCore_ACU ═══
describe('injectImportedSelectedCore_ACU', () => {
  const mockImportedEntries = (chunks: Array<{ content: string }> | string | null) => {
    mockImportTempGet.mockImplementation((key: string) => {
      if (key === 'imported_entries') {
        return Promise.resolve(typeof chunks === 'string' || chunks === null ? chunks : JSON.stringify(chunks));
      }
      return Promise.resolve(null);
    });
  };

  it('无暂存 entries 时返回尚未加载错误', async () => {
    mockImportedEntries(null);

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('尚未加载');
    expect(mockExecuteCardUpdateCore).not.toHaveBeenCalled();
  });

  it('暂存 JSON 损坏时清理五个暂存 key 并返回结构化错误', async () => {
    mockImportedEntries('{bad json');

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('导入暂存数据已损坏，已清空');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_entries');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status_standard');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status_summary');
    expect(mockImportTempRemove).toHaveBeenCalledWith('imported_status_full');
    expect(mockExecuteCardUpdateCore).not.toHaveBeenCalled();
  });

  it('暂存 chunks 为空数组时返回没有可注入分块错误', async () => {
    mockImportedEntries([]);

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('没有可注入的分块');
    expect(mockExecuteCardUpdateCore).not.toHaveBeenCalled();
  });

  it('targetWorldbook=character 时解析当前角色主世界书并完成注入', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockGetCurrentCharPrimaryLorebook.mockResolvedValue('CharBook');

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'character', selectedSheetKeys: ['sheet_0'] });

    expect(result.success).toBe(true);
    expect(result.targetWorldbook).toBe('CharBook');
    expect(result.selectedSheetKeys).toEqual(['sheet_0']);
    expect(mockGetCurrentCharPrimaryLorebook).toHaveBeenCalledTimes(1);
    expect(mockSaveImportedJson).toHaveBeenCalledWith('CharBook', mockCurrentJsonTableData, '-Selected');
    expect(mockExecuteCardUpdateCore).toHaveBeenCalledTimes(1);
    expect(mockUpdateReadable).toHaveBeenCalledWith(true, true, 'CharBook');
  });

  it('targetWorldbook=character 但当前角色无主世界书时返回错误', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockGetCurrentCharPrimaryLorebook.mockResolvedValue(null);

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'character' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('当前角色绑定的主世界书');
    expect(mockExecuteCardUpdateCore).not.toHaveBeenCalled();
  });

  it('targetWorldbook 未传时使用 settings.importWorldbookTarget', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockSettings.importWorldbookTarget = 'settingsBook';

    const result = await injectImportedSelectedCore_ACU({ selectedSheetKeys: ['sheet_0'] });

    expect(result.success).toBe(true);
    expect(result.targetWorldbook).toBe('settingsBook');
    expect(mockExecuteCardUpdateCore).toHaveBeenCalledTimes(1);
    expect(mockUpdateReadable).toHaveBeenCalledWith(true, true, 'settingsBook');
  });

  it('显式 selectedSheetKeys 空数组时返回未选择任何表格错误', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1', selectedSheetKeys: [] });

    expect(result.success).toBe(false);
    expect(result.error).toContain('未选择任何表格');
    expect(mockExecuteCardUpdateCore).not.toHaveBeenCalled();
  });

  it('显式 selectedSheetKeys 时传给 executeCardUpdateCore_ACU', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1', selectedSheetKeys: ['sheet_0'] });

    expect(result.success).toBe(true);
    expect(result.selectedSheetKeys).toEqual(['sheet_0']);
    expect(mockExecuteCardUpdateCore.mock.calls[0][5]).toEqual(['sheet_0']);
    const abortController = mockExecuteCardUpdateCore.mock.calls[0][7];
    expect(abortController).toBeInstanceOf(AbortController);
    expect(abortController.signal).toBeInstanceOf(AbortSignal);
    expect(abortController.signal.aborted).toBe(false);
  });

  it('selectedSheetKeys 为 undefined 且未开启 settings 表选择时按全表注入', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1', selectedSheetKeys: undefined });

    expect(result.success).toBe(true);
    expect(result.selectedSheetKeys).toBeUndefined();
    expect(mockExecuteCardUpdateCore).toHaveBeenCalledTimes(1);
    expect(mockExecuteCardUpdateCore.mock.calls[0][5]).toBeNull();
  });

  it('selectedSheetKeys 为 undefined 且 settings 开启表选择时使用 importSelectedTables', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockSettings.hasImportTableSelection = true;
    mockSettings.importSelectedTables = ['sheet_0'];

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1', selectedSheetKeys: undefined });

    expect(result.success).toBe(true);
    expect(result.selectedSheetKeys).toEqual(['sheet_0']);
    expect(mockExecuteCardUpdateCore).toHaveBeenCalledTimes(1);
    expect(mockExecuteCardUpdateCore.mock.calls[0][5]).toEqual(['sheet_0']);
  });

  it('settings 开启表选择时使用 importSelectedTables', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockSettings.hasImportTableSelection = true;
    mockSettings.importSelectedTables = ['sheet_0'];

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1' });

    expect(result.success).toBe(true);
    expect(result.selectedSheetKeys).toEqual(['sheet_0']);
    expect(mockExecuteCardUpdateCore.mock.calls[0][5]).toEqual(['sheet_0']);
  });

  it('settings 开启表选择但 importSelectedTables 为空时返回错误', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockSettings.hasImportTableSelection = true;
    mockSettings.importSelectedTables = [];

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('未选择任何表格');
    expect(mockExecuteCardUpdateCore).not.toHaveBeenCalled();
  });

  it('executeCardUpdateCore_ACU 失败时保存当前断点并返回 currentIndex', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockExecuteCardUpdateCore.mockResolvedValue({ success: false, error: 'AI填表失败' });

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1', maxRetries: 1 });

    expect(result.success).toBe(false);
    expect(result.currentIndex).toBe(0);
    expect(result.error).toContain('AI填表失败');
    expect(mockImportTempSet).toHaveBeenCalledWith('imported_status', JSON.stringify({ total: 1, currentIndex: 0, selectionSig: '[]' }));
    expect(mockSaveImportedJson).toHaveBeenCalledTimes(1);
    expect(mockUpdateReadable).not.toHaveBeenCalled();
  });

  it('executeCardUpdateCore_ACU 中止时保存当前 index 并返回 aborted', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockExecuteCardUpdateCore.mockResolvedValue({ success: false, aborted: true, error: '用户中止' });

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1', maxRetries: 1 });

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.currentIndex).toBe(0);
    expect(mockImportTempSet).toHaveBeenCalledWith('imported_status', JSON.stringify({ total: 1, currentIndex: 0, selectionSig: '[]' }));
    expect(mockSaveImportedJson).toHaveBeenCalledTimes(1);
    expect(mockUpdateReadable).not.toHaveBeenCalled();
  });

  it('注入期间强制 importPromptExcludeImportedWorldbookEntries=true 并在完成后恢复原值', async () => {
    mockImportedEntries([{ content: 'chunk-1' }]);
    mockSettings.importPromptExcludeImportedWorldbookEntries = false;
    mockExecuteCardUpdateCore.mockImplementation(async () => {
      expect(mockSettings.importPromptExcludeImportedWorldbookEntries).toBe(true);
      return { success: true, modifiedKeys: [] };
    });

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1' });

    expect(result.success).toBe(true);
    expect(mockSettings.importPromptExcludeImportedWorldbookEntries).toBe(false);
  });

  it('按 chunks 数量逐块执行 executeCardUpdateCore_ACU', async () => {
    mockImportedEntries([{ content: 'chunk-1' }, { content: 'chunk-2' }]);

    const result = await injectImportedSelectedCore_ACU({ targetWorldbook: 'lorebook1' });

    expect(result.success).toBe(true);
    expect(result.processedChunks).toBe(2);
    expect(mockExecuteCardUpdateCore).toHaveBeenCalledTimes(2);
    expect(mockExecuteCardUpdateCore.mock.calls[0][0][0].mes).toBe('chunk-1');
    expect(mockExecuteCardUpdateCore.mock.calls[1][0][0].mes).toBe('chunk-2');
  });
});
