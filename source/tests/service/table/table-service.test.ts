/**
 * tests/service/table/table-service.test.ts
 * 表格数据操作 service 层 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logWarn_ACU } from '../../../src/shared/utils';

const {
  mockSettings,
  mockCurrentJsonTableDataRef,
  mockGetCurrentIsolationKey,
  mockSetCurrentJsonTableData,
  mockGetChatArray,
  mockSaveChatToHost,
  mockParseTableTemplateJson,
  mockApplyTemplateScopeForCurrentChat,
  mockGetChatSheetGuideData,
  mockSetChatSheetGuideData,
  mockBuildChatSheetGuideData,
  mockGetSortedSheetKeys,
  mockSanitizeSheetForStorage,
  mockAttachSeedRows,
  mockEnsureChatSheetGuideSeeded,
  mockDeleteAllGeneratedEntries,
  mockMergeAllIndependentTables,
  mockCloneIsolatedData,
  mockWriteIsolatedTagData,
  mockWriteMessageIdentity,
  mockReadIsolatedTagData,
  mockReadLegacyIndependentData,
  mockIsLegacyMatchForIsolation,
  mockResolveTableStorageStrategy,
  mockPersistTableMutationLogV2,
  mockMigrateLegacyStorage,
  mockEnsureStableRowIdsForSheetContent,
} = vi.hoisted(() => {
  const mockCurrentJsonTableDataRef = {
    value: {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
      sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
    } as any,
  };
  return {
    mockSettings: {
      dataIsolationEnabled: false,
      dataIsolationCode: '',
    } as any,
    mockCurrentJsonTableDataRef,
    mockGetCurrentIsolationKey: vi.fn(() => ''),
    mockSetCurrentJsonTableData: vi.fn((value: any) => { mockCurrentJsonTableDataRef.value = value; }),
    mockGetChatArray: vi.fn(),
    mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
    mockParseTableTemplateJson: vi.fn(),
    mockApplyTemplateScopeForCurrentChat: vi.fn(),
    mockGetChatSheetGuideData: vi.fn(() => null),
    mockSetChatSheetGuideData: vi.fn(),
    mockBuildChatSheetGuideData: vi.fn(() => null),
    mockGetSortedSheetKeys: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
    mockSanitizeSheetForStorage: vi.fn((sheet: any) => sheet),
    mockAttachSeedRows: vi.fn(),
    mockEnsureChatSheetGuideSeeded: vi.fn().mockResolvedValue(null),
    mockDeleteAllGeneratedEntries: vi.fn().mockResolvedValue(undefined),
    mockMergeAllIndependentTables: vi.fn(),
    mockCloneIsolatedData: vi.fn(() => ({})),
    mockWriteIsolatedTagData: vi.fn(),
    mockWriteMessageIdentity: vi.fn(),
    mockReadIsolatedTagData: vi.fn(() => null),
    mockReadLegacyIndependentData: vi.fn(() => null),
    mockEnsureStableRowIdsForSheetContent: vi.fn((content: any) => {
      if (!Array.isArray(content) || content.length === 0) return [];
      const header = Array.isArray(content[0]) ? [...content[0]] : ['row_id'];
      const rows = content.slice(1).map((row: any) => Array.isArray(row) ? [...row] : []);
      const used = new Set<string>();
      let nextId = 1;
      return [header, ...rows.map((row: any) => {
        let value = row[0] == null ? '' : String(row[0]).trim();
        if (!value || used.has(value)) {
          while (used.has(String(nextId))) nextId += 1;
          value = String(nextId++);
        }
        used.add(value);
        if (row.length === 0) return [value];
        row[0] = value;
        return row;
      })];
    }),
    mockIsLegacyMatchForIsolation: vi.fn(() => false),
    mockResolveTableStorageStrategy: vi.fn(() => ({ mode: 'empty' })),
    mockPersistTableMutationLogV2: vi.fn(async () => ({ saved: true, messageIndex: 0 })),
    mockMigrateLegacyStorage: vi.fn(),
  };
});

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHost_ACU: mockSaveChatToHost,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: mockParseTableTemplateJson,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  currentChatFileIdentifier_ACU: 'test-chat',
  settings_ACU: mockSettings,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: mockApplyTemplateScopeForCurrentChat,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  attachSeedRowsToCurrentDataFromGuide_ACU: mockAttachSeedRows,
  buildChatSheetGuideDataFromData_ACU: mockBuildChatSheetGuideData,
  ensureChatSheetGuideSeeded_ACU: mockEnsureChatSheetGuideSeeded,
  getChatSheetGuideDataForIsolationKey_ACU: mockGetChatSheetGuideData,
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
  ensureStableRowIdsForSheetContent_ACU: mockEnsureStableRowIdsForSheetContent,
  sanitizeSheetForStorage_ACU: mockSanitizeSheetForStorage,
  setChatSheetGuideDataForIsolationKey_ACU: mockSetChatSheetGuideData,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: mockDeleteAllGeneratedEntries,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  mergeAllIndependentTables_ACU: mockMergeAllIndependentTables,
  mergeAllIndependentTablesLegacyV1_ACU: mockMergeAllIndependentTables,
  consumeLastMergeSourceInventory_ACU: vi.fn(() => new Map<string, string>()),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  cloneIsolatedData_ACU: mockCloneIsolatedData,
  writeIsolatedTagData_ACU: mockWriteIsolatedTagData,
  writeMessageIdentity_ACU: mockWriteMessageIdentity,
  readIsolatedTagData_ACU: mockReadIsolatedTagData,
  readLegacyIndependentData_ACU: mockReadLegacyIndependentData,
  isLegacyMatchForIsolation_ACU: mockIsLegacyMatchForIsolation,
}));

vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  isV2TagData_ACU: vi.fn(() => false),
  resolveTableStorageStrategy_ACU: mockResolveTableStorageStrategy,
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  persistTableMutationLogV2_ACU: mockPersistTableMutationLogV2,
}));

vi.mock('../../../src/service/table/storage-v2-migration', () => ({
  migrateLegacyStorageToV2OnLoad_ACU: mockMigrateLegacyStorage,
}));

import {
  saveIndependentTableToChatHistory_ACU,
  persistTablesToChatMessage_ACU,
  checkIfFirstTimeInit_ACU,
  loadOrCreateJsonTableFromChatHistory_ACU,
  ensureLegacyStorageMigratedBeforeWrite_ACU,
} from '../../../src/service/table/table-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentJsonTableDataRef.value = {
    sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
    sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
  };
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockGetCurrentIsolationKey.mockReturnValue('');
  mockCloneIsolatedData.mockReturnValue({});
  mockReadIsolatedTagData.mockReturnValue({ independentData: {}, modifiedKeys: [], updateGroupKeys: [], _acu_storage_mode: 'checkpoint', _acu_storage_version: 1 });
  mockGetChatSheetGuideData.mockReturnValue(null);
  mockSaveChatToHost.mockResolvedValue(undefined);
  mockResolveTableStorageStrategy.mockReturnValue({ mode: 'empty' });
  mockPersistTableMutationLogV2.mockResolvedValue({ saved: true, messageIndex: 0 });
  mockMigrateLegacyStorage.mockReset();
});

function makeTestTransactionContext_ACU(): any {
  return {
    transactionId: 'tx-test',
    chatKey: 'test-chat',
    isolationKey: '',
    source: 'system',
    baseRevision: null,
    writeSet: [{ kind: 'all' }],
    runCommit: async (task: any) => task(),
  };
}

describe('direct persistence guards', () => {
  it('旧兼容入口直接调用被拒绝', async () => {
    const result = await saveIndependentTableToChatHistory_ACU();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('commit model');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('底层持久化未带公共提交锁时被拒绝', async () => {
    const result = await persistTablesToChatMessage_ACU();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('commit model');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('empty 策略的首次真实写入自动下发 init checkpoint 参数', async () => {
    const message = { is_user: false, mes: 'AI 回复' };
    mockGetChatArray.mockReturnValue([message]);
    const transactionContext = makeTestTransactionContext_ACU();

    const result = await persistTablesToChatMessage_ACU({
      assumeCommitLock: true,
      transactionContext,
      targetMessageIndex: 0,
      tableData: mockCurrentJsonTableDataRef.value,
      source: 'manual_fill',
      filledSheetKeys: ['sheet_0'],
      trackingSheetKeys: ['sheet_0'],
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: mockCurrentJsonTableDataRef.value.sheet_0, reason: 'system' }],
    });

    expect(result).toEqual({ saved: true, messageIndex: 0, error: undefined });
    expect(mockResolveTableStorageStrategy).toHaveBeenCalledWith([message], '', { enabled: false, code: '' });
    expect(mockPersistTableMutationLogV2).toHaveBeenCalledWith(expect.objectContaining({
      afterData: mockCurrentJsonTableDataRef.value,
      forceCheckpoint: true,
      checkpointReason: 'init',
      operations: [],
      transactionContext,
    }));
  });
});

describe('ensureLegacyStorageMigratedBeforeWrite_ACU', () => {
  it('迁移成功后使用修复候选数据替换 runtime 状态', async () => {
    const legacyData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], [' 1 ', '原始旧数据']] },
    };
    const repairedData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '修复候选数据']] },
    };
    const chat = [{ is_user: false, mes: 'AI 回复' }];
    mockGetChatArray.mockReturnValue(chat);
    mockMergeAllIndependentTables.mockResolvedValue(legacyData);
    mockResolveTableStorageStrategy
      .mockReturnValueOnce({ mode: 'legacy-v1', reason: 'legacy-data' })
      .mockReturnValueOnce({ mode: 'v2' });
    mockMigrateLegacyStorage.mockResolvedValue({ migrated: true, data: repairedData });

    const result = await ensureLegacyStorageMigratedBeforeWrite_ACU('test');

    expect(result).toEqual({ success: true, migrated: true, data: repairedData });
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(repairedData);
  });

  it('mixed storage strategy 的 warning 会写入 migration gate 日志', async () => {
    const legacyData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '旧数据']] },
    };
    const repairedData = structuredClone(legacyData);
    mockGetChatArray.mockReturnValue([{ is_user: false, mes: 'AI 回复' }]);
    mockMergeAllIndependentTables.mockResolvedValue(legacyData);
    mockResolveTableStorageStrategy
      .mockReturnValueOnce({ mode: 'legacy-v1', reason: 'legacy-data', warning: 'mixed legacy-v1 and v2 data detected; legacy-v1 wins' })
      .mockReturnValueOnce({ mode: 'v2' });
    mockMigrateLegacyStorage.mockResolvedValue({ migrated: true, data: repairedData });

    await expect(ensureLegacyStorageMigratedBeforeWrite_ACU('mixed-test')).resolves.toEqual({ success: true, migrated: true, data: repairedData });

    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('warning=mixed legacy-v1 and v2 data detected; legacy-v1 wins'));
  });

  it('迁移伪成功但缺少候选数据时拒绝继续并保留 runtime 状态', async () => {
    const runtimeBefore = mockCurrentJsonTableDataRef.value;
    mockGetChatArray.mockReturnValue([{ is_user: false, mes: 'AI 回复' }]);
    mockMergeAllIndependentTables.mockResolvedValue({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '旧数据']] },
    });
    mockResolveTableStorageStrategy.mockReturnValue({ mode: 'legacy-v1', reason: 'legacy-data' });
    mockMigrateLegacyStorage.mockResolvedValue({ migrated: true });

    const result = await ensureLegacyStorageMigratedBeforeWrite_ACU('test');

    expect(result).toEqual({ success: false, error: '旧存储迁移到 V2 失败: 迁移成功结果缺少修复后的表格数据。' });
    expect(mockSetCurrentJsonTableData).not.toHaveBeenCalled();
    expect(mockCurrentJsonTableDataRef.value).toBe(runtimeBefore);
  });
});

// ═══ checkIfFirstTimeInit_ACU ═══
describe('checkIfFirstTimeInit_ACU', () => {
  it('空聊天记录返回 true', async () => {
    mockGetChatArray.mockReturnValue([]);
    expect(await checkIfFirstTimeInit_ACU()).toBe(true);
  });

  it('有隔离数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue({
      independentData: { sheet_0: { name: '表', content: [] } },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('有 legacy 数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue(null);
    mockIsLegacyMatchForIsolation.mockReturnValue(true);
    mockReadLegacyIndependentData.mockReturnValue({
      sheet_0: { name: '表', content: [] },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('有 V2 checkpoint 数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue({
      _acu_storage_version: 2,
      storageFrame: {
        version: 2,
        checkpoint: {
          kind: 'full',
          data: { mate: {}, sheet_0: { name: '表', content: [['row_id']] } },
        },
        logEntries: [],
      },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('只有用户消息时返回 true', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '用户消息' },
    ]);
    expect(await checkIfFirstTimeInit_ACU()).toBe(true);
  });
});

// ═══ loadOrCreateJsonTableFromChatHistory_ACU ═══
describe('loadOrCreateJsonTableFromChatHistory_ACU', () => {
  it('空聊天记录时触发初始化，返回 source=initialized', async () => {
    mockGetChatArray.mockReturnValue([]);
    mockParseTableTemplateJson.mockReturnValue({
      sheet_0: { name: '默认表', content: [['row_id', '列1']] },
    });
    // initializeJsonTableInChatHistory 内部会调用 _set_currentJsonTableData_ACU
    // 然后检查 currentJsonTableData_ACU 是否为 null
    // 由于 mockSetCurrentJsonTableData 会更新 mockCurrentJsonTableDataRef.value
    // 所以 parseTableTemplateJson 返回非 null 时，initialized=true

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('initialized');
    expect(result.loaded).toBe(true);
    expect(mockApplyTemplateScopeForCurrentChat).toHaveBeenCalledTimes(1);
    expect(mockDeleteAllGeneratedEntries).toHaveBeenCalledTimes(1);
  });

  it('merge await 期间切换聊天时不发布旧聊天数据', async () => {
    const chatA = [{ is_user: false, mes: 'A' }];
    const chatB = [{ is_user: false, mes: 'B' }];
    let releaseMerge!: (value: any) => void;
    mockGetChatArray.mockReturnValue(chatA);
    mockMergeAllIndependentTables.mockImplementation(() => new Promise(resolve => {
      releaseMerge = resolve;
    }));

    const loadPromise = loadOrCreateJsonTableFromChatHistory_ACU();
    await Promise.resolve();
    mockGetChatArray.mockReturnValue(chatB);
    mockSetCurrentJsonTableData.mockClear();
    releaseMerge({ sheet_0: { name: 'A表', content: [['row_id'], ['1', 'A数据']] } });

    const result = await loadPromise;
    expect(result.loaded).toBe(false);
    expect(result.error).toContain('scope');
    expect(mockSetCurrentJsonTableData).not.toHaveBeenCalled();
  });

  it('有合并数据时返回 source=merged', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    const mergedData = {
      sheet_0: { name: '合并表', content: [['row_id', '列1'], ['1', '值1']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('merged');
    expect(result.loaded).toBe(true);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(mergedData);
  });

  it('无合并数据时触发初始化', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockMergeAllIndependentTables.mockResolvedValue(null);
    mockParseTableTemplateJson.mockReturnValue({
      sheet_0: { name: '默认表', content: [['row_id', '列1']] },
    });

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('initialized');
    expect(result.loaded).toBe(true);
  });

  it('模板解析失败时返回 loaded=false', async () => {
    mockGetChatArray.mockReturnValue([]);
    mockParseTableTemplateJson.mockImplementation(() => { throw new Error('模板格式错误'); });

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.loaded).toBe(false);
    expect(result.error).toBeDefined();
  });
});