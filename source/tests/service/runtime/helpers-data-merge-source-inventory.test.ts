/**
 * tests/service/runtime/helpers-data-merge-source-inventory.test.ts
 *
 * 修复二：源带行表清单（sourceInventory）与错字段宽容收集。
 * - legacy 合并在每个原始读取点、任何过滤之前登记"源里带真实行的表"（sheetKey → 规范名），
 *   delta 槽登记增量 key（名留空）；consumeLastMergeSourceInventory_ACU 读取并清空。
 * - 迁移保险闸消费该清单（见 storage-v2-migration.test.ts），与合并读取严格同源。
 * - 错字段宽容收集：总结表落进 Data 字段 / 标准表落进 SummaryData 字段时，带真实行的表
 *   仍按 first-write-wins 收取并记 warning；无行的错字段表维持跳过。
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
  isSummaryOrOutlineTable_ACU: vi.fn((name: unknown) => String(name ?? '').includes('总结')),
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
  getTemplateSheetKeys_ACU: vi.fn(() => []),
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
  readIsolatedTagData_ACU: vi.fn((message: any) => message?.__tagData ?? null),
  readLegacyIndependentData_ACU: vi.fn((message: any) => message?.__legacyIndep ?? null),
  readLegacyStandardData_ACU: vi.fn((message: any) => message?.__legacyStd ?? null),
  readLegacySummaryData_ACU: vi.fn((message: any) => message?.__legacySum ?? null),
  readModifiedKeys_ACU: vi.fn(() => []),
  readUpdateGroupKeys_ACU: vi.fn(() => []),
  readMessageIdentity_ACU: vi.fn(() => null),
  isLegacyMatchForIsolation_ACU: vi.fn((message: any) => Boolean(message?.__legacyMatch)),
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
  migrateLegacyStorageToV2OnLoad_ACU: vi.fn().mockResolvedValue({ migrated: false, error: 'test-blocked' }),
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

import {
  consumeLastMergeSourceInventory_ACU,
  mergeAllIndependentTables_ACU,
  mergeAllIndependentTablesLegacyV1_ACU,
} from '../../../src/service/runtime/helpers-data-merge';
import { getChatArray_ACU } from '../../../src/data/gateways/chat-gateway';
import { migrateLegacyStorageToV2OnLoad_ACU } from '../../../src/service/table/storage-v2-migration';
import { logWarn_ACU } from '../../../src/shared/utils';

function sheet(name: string, content: unknown[][]): any {
  return { name, content, updateConfig: {}, exportConfig: {} };
}

describe('源带行表清单登记与消费', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeLastMergeSourceInventory_ACU(); // 清残留
  });

  it('隔离槽/顶层 legacy 源的带行表与 delta 槽增量 key 全部登记；无行表不登记；consume 后清空', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        __tagData: {
          _acu_storage_mode: 'delta',
          incrementalData: { sheet_delta: { ops: [] } },
          independentData: { sheet_mixed: sheet('畸形混合槽表', [['row_id', '列'], ['1', '值']]) },
        },
      },
      {
        is_user: false,
        __tagData: {
          independentData: {
            sheet_iso: sheet('隔离槽表', [['row_id', '列'], ['1', '值']]),
            sheet_empty: sheet('空占位表', [['row_id', '列']]),
          },
        },
      },
      {
        is_user: false,
        __legacyMatch: true,
        __legacyIndep: { sheet_top: sheet('顶层独立表', [['row_id', '列'], ['1', '值']]) },
        __legacyStd: { sheet_std: sheet('标准表', [['row_id', '列'], ['1', '值']]) },
        __legacySum: { sheet_sum: sheet('剧情总结', [['row_id', '列'], ['1', '值']]) },
      },
    ] as any);

    await mergeAllIndependentTablesLegacyV1_ACU();

    const inventory = consumeLastMergeSourceInventory_ACU();
    expect(inventory.get('sheet_delta')).toBe('');
    expect(inventory.has('sheet_mixed')).toBe(true);
    expect(inventory.has('sheet_iso')).toBe(true);
    expect(inventory.has('sheet_top')).toBe(true);
    expect(inventory.has('sheet_std')).toBe(true);
    expect(inventory.has('sheet_sum')).toBe(true);
    expect(inventory.has('sheet_empty')).toBe(false); // 无真实行不登记

    // consume 语义：读取后清空
    expect(consumeLastMergeSourceInventory_ACU().size).toBe(0);
  });

  it('legacy 分支把 sourceInventory 传给迁移闸（与合并同源）', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        __legacyMatch: true,
        __legacyIndep: { sheet_top: sheet('顶层独立表', [['row_id', '列'], ['1', '值']]) },
      },
    ] as any);

    await mergeAllIndependentTables_ACU();

    expect(migrateLegacyStorageToV2OnLoad_ACU).toHaveBeenCalledTimes(1);
    const options = vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mock.calls[0][0] as any;
    expect(options.sourceInventory).toBeInstanceOf(Map);
    expect(options.sourceInventory.has('sheet_top')).toBe(true);
  });
});

describe('错字段宽容收集', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeLastMergeSourceInventory_ACU();
  });

  it('总结表落进 Data 字段且带真实行 → 仍收取并记 warning', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        __legacyMatch: true,
        __legacyStd: { sheet_wrong: sheet('剧情总结', [['row_id', '纪要'], ['1', '第一章']]) },
      },
    ] as any);

    const merged = await mergeAllIndependentTablesLegacyV1_ACU();

    expect(merged).not.toBeNull();
    expect(merged!.sheet_wrong.content).toEqual([['row_id', '纪要'], ['1', '第一章']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('错字段宽容模式'));
  });

  it('标准表落进 SummaryData 字段且带真实行 → 仍收取并记 warning', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        __legacyMatch: true,
        __legacySum: { sheet_wrong2: sheet('背包物品表', [['row_id', '名称'], ['1', '铁剑']]) },
      },
    ] as any);

    const merged = await mergeAllIndependentTablesLegacyV1_ACU();

    expect(merged).not.toBeNull();
    expect(merged!.sheet_wrong2.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('错字段宽容模式'));
  });

  it('错字段表无真实行 → 维持跳过（占位表不复活）', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        __legacyMatch: true,
        __legacyStd: { sheet_hollow: sheet('剧情总结', [['row_id', '纪要']]) },
      },
    ] as any);

    const merged = await mergeAllIndependentTablesLegacyV1_ACU();

    expect(merged === null || merged.sheet_hollow === undefined).toBe(true);
  });

  it('字段正确的表不触发错字段 warning（既有语义不回归）', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        __legacyMatch: true,
        __legacyStd: { sheet_ok: sheet('背包物品表', [['row_id', '名称'], ['1', '铁剑']]) },
        __legacySum: { sheet_sumok: sheet('剧情总结', [['row_id', '纪要'], ['1', '第一章']]) },
      },
    ] as any);

    const merged = await mergeAllIndependentTablesLegacyV1_ACU();

    expect(merged!.sheet_ok.content[1]).toEqual(['1', '铁剑']);
    expect(merged!.sheet_sumok.content[1]).toEqual(['1', '第一章']);
    const wrongFieldWarnings = vi.mocked(logWarn_ACU).mock.calls
      .filter(call => String(call[0]).includes('错字段宽容模式'));
    expect(wrongFieldWarnings).toHaveLength(0);
  });
});
