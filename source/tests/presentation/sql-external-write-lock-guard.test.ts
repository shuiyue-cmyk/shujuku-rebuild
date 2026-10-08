/**
 * R9-04：外部写入（原生 SQL API、CRUD、SQL 控制台）与 AI 写路径同一套锁定保护：
 * 改到已锁定的行/列/单元格（含外键级联）整笔拒绝并回滚。真实 SqlTableService + 真实锁模块。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveChat: vi.fn().mockResolvedValue(undefined),
  saveChatStrict: vi.fn().mockResolvedValue(undefined),
  settings: {
    storageMode: 'sqlite',
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    skipUpdateFloors: 0,
    updateBatchSize: 1,
  } as any,
  chatIdentifier: 'frontend-crud-chat',
  isolationKey: '',
  currentJsonTableData: null as any,
  isAutoUpdating: false,
  provider: null as any,
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
  registerPostChatSaveListener_ACU: vi.fn(),
}));

vi.mock('../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/data/repositories/chat-message-data-repo')>()),
  cloneIsolatedData_ACU: vi.fn((message: any) => JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData || {}))),
  writeMessageIdentity_ACU: vi.fn(() => {}),
}));

vi.mock('../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
    parseTableTemplateJson_ACU: vi.fn(() => JSON.parse(JSON.stringify(TEMPLATE))),
  };
});

vi.mock('../../src/service/runtime/state-manager', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/service/runtime/state-manager')>();
  return {
    ...actual,
    settings_ACU: mocks.settings,
    get currentChatFileIdentifier_ACU() { return mocks.chatIdentifier; },
    get isAutoUpdatingCard_ACU() { return mocks.isAutoUpdating; },
    getCurrentIsolationKey_ACU: vi.fn(() => mocks.isolationKey),
    get currentJsonTableData_ACU() { return mocks.currentJsonTableData; },
    _set_currentJsonTableData_ACU: vi.fn((value: any) => { mocks.currentJsonTableData = value; }),
  };
});

vi.mock('../../src/data/storage/chat-history', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/data/storage/chat-history')>();
  return {
    ...actual,
    getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatIdentifier),
  };
});

vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => true),
  getCurrentStorageMode: vi.fn(() => 'sqlite'),
}));

vi.mock('../../src/service/table/table-storage-strategy', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/service/table/table-storage-strategy')>();
  return {
    ...actual,
    ensureStorageProviderReady_ACU: vi.fn(async () => mocks.provider),
    getStorageProvider: vi.fn(() => mocks.provider),
    getActiveStorageProvider: vi.fn(() => mocks.provider),
    reloadStorageProvider: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock('../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: vi.fn(),
  loadAllChatMessages_ACU: vi.fn(),
  updateReadableLorebookEntry_ACU: vi.fn(),
}));

const TEMPLATE = {
  mate: { type: 'chatSheets', version: 1 },
  sheet_tong_shi: {
    uid: 'sheet_tong_shi',
    name: '同事状态表',
    sourceData: { ddl: 'CREATE TABLE tongshizhuangtaibiao (row_id INTEGER PRIMARY KEY, name TEXT UNIQUE, affection TEXT);' },
    content: [['row_id', 'name', 'affection']],
    updateConfig: {}, exportConfig: {}, orderNo: 0,
  },
};

import { SqlTableService } from '../../src/service/table/sql-table-service';
import { runSqliteRuntimeMutationCommit_ACU } from '../../src/service/table/table-update-commit';
import { loadTableStateFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';
import { readIsolatedTagData_ACU } from '../../src/data/repositories/chat-message-data-repo';
import { flushRuntimeOnlyPendingChanges_ACU } from '../../src/service/table/runtime-only-pending-flush';
import { clearRuntimeOnlyPendingSheets_ACU, readRuntimeOnlyPendingSheets_ACU } from '../../src/service/table/runtime-only-pending-state';
import { _set_currentChatFileIdentifier_ACU } from '../../src/service/runtime/state-manager';
import { createSqlApi } from '../../src/presentation/bootstrap/api-groups/sql-api';

const pendingScope = () => ({ chatKey: mocks.chatIdentifier, isolationKey: '' });

async function frontendInsertRow(name: string, affection: string, extra: Record<string, any> = {}) {
  return runSqliteRuntimeMutationCommit_ACU<number>({
    source: 'manual_crud',
    reason: 'insertRow:sqlite',
    isolationKey: mocks.isolationKey,
    writeSet: [{ kind: 'sheet', sheetKey: 'sheet_tong_shi' }],
    revisionWriteSet: [{ kind: 'sheet', sheetKey: 'sheet_tong_shi' }],
    initialData: mocks.currentJsonTableData,
    targetMessageIndex: 0,
    targetSheetKeys: ['sheet_tong_shi'],
    updateGroupKeys: null,
    trackingSheetKeys: [],
    trackAsUpdate: false,
    sql: 'INSERT INTO `tongshizhuangtaibiao` (`name`, `affection`) VALUES (?, ?);',
    params: [name, affection],
    mapValue: ({ tableData }) => (tableData as any).sheet_tong_shi.content.length - 1,
    ...extra,
  });
}
import { getTableLockIdentitiesForSheet_ACU, saveTableLocksForSheet_ACU } from '../../src/service/runtime/helpers-table-lock';

describe('R9-04 外部 SQL 写入遵守表格锁', () => {
  beforeEach(async () => {
    clearRuntimeOnlyPendingSheets_ACU();
    _set_currentChatFileIdentifier_ACU(mocks.chatIdentifier);
    mocks.settings.tableUpdateLocks = {};
    mocks.chat.length = 0;
    mocks.chat.push({ is_user: false, mes: '首楼' });
    mocks.currentJsonTableData = JSON.parse(JSON.stringify(TEMPLATE));
    mocks.provider = new SqlTableService();
    await mocks.provider.loadFromData(JSON.parse(JSON.stringify(TEMPLATE)));
    expect((await frontendInsertRow('A', '1')).success).toBe(true);
    expect((await frontendInsertRow('B', '2')).success).toBe(true);
    saveTableLocksForSheet_ACU('sheet_tong_shi', { rows: new Set([0]), cols: new Set(), cells: new Set() }, mocks.currentJsonTableData.sheet_tong_shi.content);
    expect(getTableLockIdentitiesForSheet_ACU('sheet_tong_shi', mocks.currentJsonTableData.sheet_tong_shi.content).rowIds.has('1')).toBe(true);
  });

  const rows = () => mocks.provider.getCurrentData().sheet_tong_shi.content;

  it('executeSqlMutation 改锁定行被拒绝，值不变', async () => {
    const api = createSqlApi({} as any);
    const result = await api.executeSqlMutation('UPDATE `tongshizhuangtaibiao` SET `affection` = ? WHERE `row_id` = 1', ['99'], { skipNotify: true });
    expect(JSON.stringify(result)).toContain('锁定');
    expect(rows().find((row: any[]) => String(row[0]) === '1')?.[2]).toBe('1');
  });

  it('executeSqlBatch 删锁定行被拒绝，整批回滚（同批的未锁定改动也不生效）', async () => {
    const api = createSqlApi({} as any);
    const result = await api.executeSqlBatch(
      "UPDATE `tongshizhuangtaibiao` SET `affection` = '7' WHERE `row_id` = 2;\nDELETE FROM `tongshizhuangtaibiao` WHERE `row_id` = 1;",
      { skipNotify: true },
    );
    expect(result?.success).not.toBe(true);
    expect(rows().length).toBe(3);
    expect(rows().find((row: any[]) => String(row[0]) === '2')?.[2]).toBe('2');
  });

  it('未锁定的行照常写入', async () => {
    const api = createSqlApi({} as any);
    await api.executeSqlMutation('UPDATE `tongshizhuangtaibiao` SET `affection` = ? WHERE `row_id` = 2', ['9'], { skipNotify: true });
    expect(rows().find((row: any[]) => String(row[0]) === '2')?.[2]).toBe('9');
  });

  it('CRUD 提交路径改锁定行同样被拒绝', async () => {
    const result = await runSqliteRuntimeMutationCommit_ACU<boolean>({
      source: 'manual_crud',
      reason: 'deleteRow:sqlite',
      isolationKey: mocks.isolationKey,
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_tong_shi' }],
      revisionWriteSet: [{ kind: 'sheet', sheetKey: 'sheet_tong_shi' }],
      initialData: mocks.currentJsonTableData,
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_tong_shi'],
      updateGroupKeys: null,
      trackingSheetKeys: [],
      trackAsUpdate: false,
      sql: 'DELETE FROM `tongshizhuangtaibiao` WHERE `row_id` = ?;',
      params: ['1'],
      mapValue: () => true,
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('锁定');
    expect(rows().length).toBe(3);
  });
});
