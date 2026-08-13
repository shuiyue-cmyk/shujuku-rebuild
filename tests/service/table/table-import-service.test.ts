import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChatArray: vi.fn(),
  getCurrentIsolationKey: vi.fn(() => ''),
  sanitizeChatSheetsObject: vi.fn((data: any) => data),
  replaceAllData: vi.fn().mockResolvedValue({ success: true }),
  getCurrentData: vi.fn(),
  runTableUpdateCommit: vi.fn(),
  reloadStorageProvider: vi.fn().mockResolvedValue(undefined),
  validateSqliteTemplateDataStrict: vi.fn().mockResolvedValue({ success: true }),
  isSqliteMode: vi.fn(() => false),
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: mocks.getChatArray,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: { mate: { type: 'acu', version: 1 } },
  getCurrentIsolationKey_ACU: mocks.getCurrentIsolationKey,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  sanitizeChatSheetsObject_ACU: mocks.sanitizeChatSheetsObject,
}));

vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(() => ({
    replaceAllData: mocks.replaceAllData,
    getCurrentData: mocks.getCurrentData,
  })),
  reloadStorageProvider: mocks.reloadStorageProvider,
}));

vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: mocks.runTableUpdateCommit,
}));

vi.mock('../../../src/service/table/sqlite-template-validation', () => ({
  validateSqliteTemplateDataStrict_ACU: mocks.validateSqliteTemplateDataStrict,
}));

vi.mock('../../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('纪要') || name.includes('总结')),
  logDebug_ACU: vi.fn(),
}));

vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: mocks.isSqliteMode,
}));

import { importTableJsonThroughCommit_ACU } from '../../../src/service/table/table-import-service';

describe('importTableJsonThroughCommit_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSqliteMode.mockReturnValue(false);
    // clearAllMocks 不会清空上个用例未消费的 mockResolvedValueOnce 队列。
    mocks.validateSqliteTemplateDataStrict.mockReset().mockResolvedValue({ success: true });
    mocks.getChatArray.mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    mocks.getCurrentData.mockReturnValue(null);
    mocks.runTableUpdateCommit.mockImplementation(async (options: any, apply: any) => {
      const applied = await apply();
      return {
        success: applied.success !== false,
        value: applied.value,
        tableData: applied.tableData,
        messageIndex: options.targetMessageIndex,
      };
    });
  });

  it('外部导入会写入聊天持久化，但不推进自动更新楼层标记', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
      sheet_1: { name: '背包', content: [['row_id', '物品']] },
    };

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result.success).toBe(true);
    expect(mocks.replaceAllData).toHaveBeenCalledWith(importedData);
    expect(result.persisted).toBe(true);
    const [commitOptions, apply] = mocks.runTableUpdateCommit.mock.calls[0];
    const applied = await apply();
    expect(commitOptions).toEqual(expect.objectContaining({
      source: 'import',
      reason: 'importTableAsJson',
      targetMessageIndex: 1,
      targetSheetKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: null,
      trackingSheetKeys: [],
      trackAsUpdate: false,
      strictSave: true,
    }));
    expect(applied.persist).toEqual({ operations: [] });
  });

  it('可修复的旧版 rowId 表头只持久化并加载审计后的 candidate', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['rowId', '物品'], [' 1 ', '铁剑'], ['1', '药水']] },
    };

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    const [options, apply] = mocks.runTableUpdateCommit.mock.calls[0];
    const applied = await apply();
    const expectedCandidate = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['row_id', '物品'], ['1', '铁剑'], ['2', '药水']] },
    };
    expect(applied.persist).toEqual({ operations: [] });
    expect(applied.tableData).toEqual(expectedCandidate);
    expect(mocks.replaceAllData).toHaveBeenCalledWith(expectedCandidate);
    expect(result).toEqual(expect.objectContaining({ success: true, tableData: expectedCandidate }));
  });

  it('SQLite 模式下无数据业务表头自动补 row_id，并以同一候选数据预检、提交和替换 runtime', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['物品', '数量']] },
    };
    const expectedCandidate = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['row_id', '物品', '数量']] },
    };
    mocks.isSqliteMode.mockReturnValue(true);

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result).toEqual(expect.objectContaining({ success: true, tableData: expectedCandidate }));
    expect(mocks.validateSqliteTemplateDataStrict).toHaveBeenCalledWith(expectedCandidate, { allowRuntimeDdlFallback: true });
    const [, apply] = mocks.runTableUpdateCommit.mock.calls[0];
    expect((await apply()).tableData).toEqual(expectedCandidate);
    expect(mocks.replaceAllData).toHaveBeenCalledWith(expectedCandidate);
    expect(importedData.sheet_0.content).toEqual([['物品', '数量']]);
  });

  it('native 模式下跳过 SQLite 预检，仍可导入 SQLite 约束不兼容的历史数据', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_3NoMc1wI: { name: '纪要表', content: [['row_id', '编码索引'], ['1', 'not-an-AM-code']] },
    };
    mocks.validateSqliteTemplateDataStrict.mockResolvedValueOnce({ success: false, error: 'CHECK constraint failed' });

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result.success).toBe(true);
    expect(mocks.validateSqliteTemplateDataStrict).not.toHaveBeenCalled();
    expect(mocks.runTableUpdateCommit).toHaveBeenCalledOnce();
    expect(mocks.replaceAllData).toHaveBeenCalledWith(importedData);
  });

  it('有种子行的业务表头不走空模板补列捷径', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['物品']], seedRows: [['铁剑']] },
    };

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result).toMatchObject({ failureStage: 'preflight', auditStatus: 'requires_confirmation' });
    expect(mocks.runTableUpdateCommit).not.toHaveBeenCalled();
    expect(mocks.replaceAllData).not.toHaveBeenCalled();
  });

  it('删除楼层/备份恢复模式只恢复运行时，不写新的持久化事件', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
    };

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData), { persist: false });

    expect(result.success).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.tableData).toEqual(importedData);
    expect(mocks.replaceAllData).toHaveBeenCalledWith(importedData);
    expect(mocks.runTableUpdateCommit).not.toHaveBeenCalled();
  });

  it('持久化失败时不替换 runtime，保留预检后提交的原子边界', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '旧版模板', content: [['row_id', '数量'], ['1', 1]] },
    };
    mocks.runTableUpdateCommit.mockResolvedValueOnce({
      success: false,
      error: 'V2 checkpoint 行标识或结构不合法：invalid_header: sheet_0 第 0 行',
    });

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result).toEqual({
      success: false,
      persisted: false,
      failureStage: 'commit',
      error: 'V2 checkpoint 行标识或结构不合法：invalid_header: sheet_0 第 0 行',
    });
    expect(mocks.replaceAllData).not.toHaveBeenCalled();
    expect(mocks.runTableUpdateCommit).toHaveBeenCalledOnce();
  });

  it('预检要求人工确认时不启动提交且不替换 runtime', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '无法确认模板', content: [['名称', '数量'], ['铁剑', 1]] },
    };

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result).toEqual({
      success: false,
      persisted: false,
      failureStage: 'preflight',
      auditStatus: 'requires_confirmation',
      issues: [expect.objectContaining({ code: 'upgrade_invalid_header', sheetKey: 'sheet_0' })],
      error: '导入数据需要人工确认或无法修复：upgrade_invalid_header',
    });
    expect(mocks.runTableUpdateCommit).not.toHaveBeenCalled();
    expect(mocks.replaceAllData).not.toHaveBeenCalled();
  });

  it('严格保存成功后 runtime 替换失败会重载 provider 并如实返回已保存状态', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['row_id', '物品'], ['1', '铁剑']] },
    };
    mocks.replaceAllData.mockResolvedValueOnce({ success: false, error: 'SQLite hydrate failed' });

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result).toEqual({
      success: false,
      persisted: true,
      failureStage: 'post_commit_runtime',
      error: '导入数据已保存，但运行时全量替换失败；已尝试重新加载运行时：SQLite hydrate failed',
    });
    expect(mocks.runTableUpdateCommit).toHaveBeenCalledOnce();
    expect(mocks.replaceAllData).toHaveBeenCalledWith(importedData);
    expect(mocks.reloadStorageProvider).toHaveBeenCalledOnce();
  });

  it('SQLite 预检失败时不启动提交也不替换 runtime', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['row_id', '物品'], ['1', '铁剑']] },
    };
    mocks.validateSqliteTemplateDataStrict.mockResolvedValueOnce({ success: false, error: 'DDL 与表头不一致' });
    mocks.isSqliteMode.mockReturnValue(true);

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    expect(result).toEqual({
      success: false,
      persisted: false,
      failureStage: 'preflight',
      auditStatus: 'clean',
      issues: [{ code: 'sqlite_preflight_failed', message: 'DDL 与表头不一致' }],
      error: '导入候选数据未通过 SQLite 预检：DDL 与表头不一致',
    });
    expect(mocks.runTableUpdateCommit).not.toHaveBeenCalled();
    expect(mocks.replaceAllData).not.toHaveBeenCalled();
  });

  it('已有 V2 full checkpoint 时才追加 data_replace 操作', async () => {
    const importedData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '背包', content: [['row_id', '物品'], ['1', '铁剑']] },
    };
    mocks.getChatArray.mockReturnValue([
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: importedData },
              logEntries: [],
            },
          },
        },
      },
      { is_user: false, mes: 'AI回复' },
    ]);

    await importTableJsonThroughCommit_ACU(JSON.stringify(importedData));

    const [, apply] = mocks.runTableUpdateCommit.mock.calls[0];
    const applied = await apply();
    expect(applied.persist).toEqual({
      operations: [{ kind: 'data_replace', data: importedData, reason: 'import' }],
    });
  });
});
