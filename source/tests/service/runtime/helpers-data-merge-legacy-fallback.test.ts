/**
 * tests/service/runtime/helpers-data-merge-legacy-fallback.test.ts
 *
 * C4 Legacy V1（xing 时代）读取不阻塞：迁移到 V2 失败时降级为直读合并结果，
 * 数据照常可用、不 throw；全程静默（仅 logWarn 后台日志，不弹任何 toast）。
 * 写入门闸（ensureLegacyStorageMigratedBeforeWrite_ACU）独立于读路径，维持严格。
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: {},
  isLocalStorageDisabled_ACU: false,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  parseTableTemplateJson_ACU: vi.fn(() => null),
  ensureSheetOrderNumbers_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  settings_ACU: {},
  currentChatFileIdentifier_ACU: 'test-chat',
  independentTableStates_ACU: {},
  suppressWorldbookInjectionInGreeting_ACU: false,
  _set_suppressWorldbookInjectionInGreeting_ACU: vi.fn(),
  _set_currentJsonTableData_ACU: vi.fn(),
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
  saveChatToHost_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
  saveSettings_ACU: vi.fn(),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatSheetGuideDataFromTemplateObj_ACU: vi.fn(),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
  getTemplateSheetKeys_ACU: vi.fn(() => ['sheet_0']),
  materializeDataFromSheetGuide_ACU: vi.fn(() => ({})),
  reorderDataBySheetKeys_ACU: vi.fn((data: any) => data),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn(() => null),
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
  attachSeedRowsToCurrentDataFromGuide_ACU: vi.fn(),
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any[]) => content.map(row => Array.isArray(row) ? [...row] : row)),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: vi.fn(() => null),
  readLegacyIndependentData_ACU: vi.fn(() => null),
  readLegacyStandardData_ACU: vi.fn(() => null),
  readLegacySummaryData_ACU: vi.fn(() => null),
  readModifiedKeys_ACU: vi.fn(() => []),
  readUpdateGroupKeys_ACU: vi.fn(() => []),
  readMessageIdentity_ACU: vi.fn(() => null),
  isLegacyMatchForIsolation_ACU: vi.fn(() => false),
  cloneIsolatedData_ACU: vi.fn((message: any) => JSON.parse(JSON.stringify(message?.TavernDB_ACU_IsolatedData || {}))),
  writeMessageIdentity_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/template-preset-utils', () => ({
  deriveTemplatePresetNameForImport_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  upsertTemplatePreset_ACU: vi.fn(() => true),
}));

vi.mock('../../../src/shared/constants', () => ({
  TABLE_ORDER_FIELD_ACU: 'orderNo',
}));

vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  isV2TagData_ACU: vi.fn((tagData: any) => !!tagData?.storageFrame && tagData?._acu_storage_version === 2),
  resolveTableStorageStrategy_ACU: vi.fn(() => ({ mode: 'legacy-v1' })),
}));

vi.mock('../../../src/service/table/storage-v2-migration', () => ({
  migrateLegacyStorageToV2OnLoad_ACU: vi.fn().mockResolvedValue({ migrated: true, data: null }),
}));

vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2_ACU: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  persistTableMutationLogV2_ACU: vi.fn().mockResolvedValue({ saved: true, messageIndex: 0 }),
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: vi.fn(async (_options: any, task: any) => task({
    transactionId: 'tx-test',
    chatKey: 'test-chat',
    isolationKey: '',
    source: _options.source,
    baseRevision: null,
    writeSet: _options.writeSet,
    runCommit: async (commitTask: any) => commitTask(),
  })),
}));

vi.mock('../../../src/shared/ui-surface-registry', () => ({
  showUiSurfaceToast_ACU: vi.fn(),
  registerUiSurface_ACU: vi.fn(),
  getUiSurface_ACU: vi.fn(() => null),
  resetUiSurfaceRegistryForTests_ACU: vi.fn(),
}));

import { mergeAllIndependentTables_ACU } from '../../../src/service/runtime/helpers-data-merge';
import { getChatArray_ACU } from '../../../src/data/gateways/chat-gateway';
import { readLegacyIndependentData_ACU, isLegacyMatchForIsolation_ACU } from '../../../src/data/repositories/chat-message-data-repo';
import { migrateLegacyStorageToV2OnLoad_ACU } from '../../../src/service/table/storage-v2-migration';
import { showUiSurfaceToast_ACU } from '../../../src/shared/ui-surface-registry';
import { logWarn_ACU } from '../../../src/shared/utils';

function makeLegacyChat(sendDate: string): any[] {
  return [{ is_user: false, mes: 'AI回复', send_date: sendDate }];
}

function primeLegacyData(): void {
  vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(true);
  vi.mocked(readLegacyIndependentData_ACU).mockReturnValue({
    sheet_0: {
      name: '背包物品表',
      content: [['row_id', '物品名称'], ['1', '旧格式数据']],
    },
  } as any);
}

describe('legacy-v1 迁移失败降级为直读（C4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeLegacyData();
  });

  it('迁移 throw（如 audit 阻断）时不再上抛：返回直读合并数据并 logWarn，全程不弹 toast', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue(makeLegacyChat('fallback-throw'));
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockRejectedValueOnce(new Error('audit gate 阻断：upgrade_overflow_cells'));

    const result = await mergeAllIndependentTables_ACU();

    expect(result).not.toBeNull();
    expect(result!.sheet_0.content).toEqual([['row_id', '物品名称'], ['1', '旧格式数据']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('已降级为直读旧格式'));
    expect(showUiSurfaceToast_ACU).not.toHaveBeenCalled();
  });

  it('迁移返回 migrated:false 时同样降级直读，不 throw', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue(makeLegacyChat('fallback-not-migrated'));
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockResolvedValueOnce({ migrated: false, error: 'mixed 存储阻断' } as any);

    const result = await mergeAllIndependentTables_ACU();

    expect(result).not.toBeNull();
    expect(result!.sheet_0.content).toEqual([['row_id', '物品名称'], ['1', '旧格式数据']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('mixed 存储阻断'));
  });

  it('重复失败也保持静默：多个聊天多次失败均不弹 toast，数据始终可读', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue(makeLegacyChat('dedupe-chat-a'));
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockRejectedValue(new Error('持续失败'));

    await mergeAllIndependentTables_ACU();
    await mergeAllIndependentTables_ACU();

    vi.mocked(getChatArray_ACU).mockReturnValue(makeLegacyChat('dedupe-chat-b'));
    const result = await mergeAllIndependentTables_ACU();

    expect(showUiSurfaceToast_ACU).not.toHaveBeenCalled();
    expect(result!.sheet_0.content).toEqual([['row_id', '物品名称'], ['1', '旧格式数据']]);
  });

  it('迁移成功路径不受影响：仍返回修复候选数据且不弹降级 toast', async () => {
    const repairedData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '修复后数据']] },
    };
    vi.mocked(getChatArray_ACU).mockReturnValue(makeLegacyChat('success-chat'));
    const { resolveTableStorageStrategy_ACU } = await import('../../../src/service/table/storage-strategy-resolver');
    vi.mocked(resolveTableStorageStrategy_ACU)
      .mockReturnValueOnce({ mode: 'legacy-v1' } as any)
      .mockReturnValueOnce({ mode: 'v2' } as any);
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockResolvedValueOnce({ migrated: true, data: repairedData } as any);

    const result = await mergeAllIndependentTables_ACU();

    expect(result).toEqual(repairedData);
    expect(showUiSurfaceToast_ACU).not.toHaveBeenCalled();
  });
});
