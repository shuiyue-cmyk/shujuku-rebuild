import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  migration: vi.fn(),
  reload: vi.fn(),
  transaction: vi.fn(),
  persist: vi.fn(),
  ensureProvider: vi.fn(),
  setCurrentData: vi.fn(),
  currentChatKey: 'chat-a',
  currentIsolationKey: 'scope-a',
  isAutoUpdating: false,
  hydrate: vi.fn(),
  storageMode: 'native' as 'native' | 'sqlite',
}));

vi.mock('../../../src/shared/utils', () => ({
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mocks.currentChatKey; },
  currentJsonTableData_ACU: null,
  get isAutoUpdatingCard_ACU() { return mocks.isAutoUpdating; },
  getCurrentIsolationKey_ACU: () => mocks.currentIsolationKey,
  _set_currentJsonTableData_ACU: mocks.setCurrentData,
}));
vi.mock('../../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: mocks.migration,
  persistTablesToChatMessage_ACU: mocks.persist,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: mocks.ensureProvider,
  reloadStorageProvider: mocks.reload,
  hydrateStorageProviderFromSnapshot_ACU: mocks.hydrate,
  getRuntimeLifecycleEpoch_ACU: () => 7,
}));
vi.mock('../../../src/service/table/storage-mode', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getCurrentStorageMode: () => mocks.storageMode,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mocks.transaction,
}));
vi.mock('../../../src/service/table/manual-catch-up-provisional-bridge', () => ({
  ensureNoActiveProvisionalBridgeForCurrentScope_ACU: vi.fn(async () => ({ ok: true, action: 'none' })),
}));

import { runSqliteRuntimeMutationCommit_ACU, runTableUpdateCommit_ACU } from '../../../src/service/table/table-update-commit';
import { logError_ACU, logWarn_ACU } from '../../../src/shared/utils';
import { captureTableFillTargetGuard_ACU } from '../../../src/service/table/table-fill-target-guard';
import {
  clearRuntimeOnlyPendingSheets_ACU,
  markRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  registerRuntimeOnlyPendingFlusher_ACU,
} from '../../../src/service/table/runtime-only-pending-state';

function options(reason: string) {
  return {
    source: 'system' as const,
    reason,
    writeSet: [{ kind: 'all' as const }],
    targetMessageIndex: -1,
    targetSheetKeys: null,
  };
}

describe('runTableUpdateCommit_ACU migration gate', () => {
  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.migration.mockReset().mockResolvedValue({ success: false, error: 'mixed storage evidence insufficient' });
    mocks.reload.mockReset();
    mocks.transaction.mockReset();
    mocks.persist.mockReset();
    mocks.ensureProvider.mockReset();
    mocks.setCurrentData.mockReset();
  });

  it('mixed/legacy 迁移失败时不执行 apply、事务或持久化', async () => {
    const apply = vi.fn();

    const result = await runTableUpdateCommit_ACU(options('test_mixed_gate'), apply);

    expect(result).toEqual({
      success: false,
      error: 'mixed storage evidence insufficient',
      errorCategory: 'infrastructure',
    });
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('SQLite mutation 同样在 provider 写入前被 migration gate 拦截', async () => {
    const result = await runSqliteRuntimeMutationCommit_ACU({
      ...options('test_sqlite_mixed_gate'),
      sql: 'UPDATE sheet_0 SET value = ?',
      params: ['changed'],
      mapValue: () => 'unreachable',
    });

    expect(result).toEqual({
      success: false,
      error: 'mixed storage evidence insufficient',
      errorCategory: 'infrastructure',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.ensureProvider).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('AI 等待期间切换聊天后 fail-loud，禁止进入事务与 apply', async () => {
    const apply = vi.fn();
    mocks.migration.mockImplementation(async () => {
      mocks.currentChatKey = 'chat-b';
      mocks.currentIsolationKey = 'scope-b';
      return { success: true, migrated: false };
    });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_scope_switch_guard'),
      chatKey: 'chat-a',
      isolationKey: 'scope-a',
    }, apply);

    expect(result).toMatchObject({
      success: false,
      errorCategory: 'precondition',
      error: expect.stringContaining('聊天或隔离标识已切换'),
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('AI 等待期间目标楼层换成了另一条回复（滑动 / 重新生成）：拒绝写回，不重试', async () => {
    const chat: any[] = [
      { is_user: true, mes: '你好' },
      { is_user: false, mes: '第一版', swipe_id: 0, send_date: 'd1' },
    ];
    const targetGuard = captureTableFillTargetGuard_ACU(chat, () => chat);
    mocks.migration.mockImplementation(async () => {
      chat[1].swipe_id = 1;
      chat[1].mes = '第二版';
      return { success: true, migrated: false };
    });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({ runCommit: async (commitTask: any) => commitTask() }, null));

    const result = await runTableUpdateCommit_ACU({
      ...options('test_target_swiped'),
      targetMessageIndex: 1,
      targetGuard,
    }, async () => ({ success: true, tableData: { mate: { type: 'acu', version: 1 } } as any }));

    expect(result).toMatchObject({
      success: false,
      errorCategory: 'precondition',
      error: expect.stringContaining('目标楼层已换成另一条回复'),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('目标楼层在事务内（应用期间）才被滑动：写回前的核对拦下，不调持久化', async () => {
    const chat: any[] = [
      { is_user: true, mes: '你好' },
      { is_user: false, mes: '第一版', swipe_id: 0, send_date: 'd1' },
    ];
    const targetGuard = captureTableFillTargetGuard_ACU(chat, () => chat);
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({ runCommit: async (commitTask: any) => commitTask() }, null));

    const result = await runTableUpdateCommit_ACU({
      ...options('test_target_swiped_in_apply'),
      targetMessageIndex: 1,
      targetGuard,
    }, async () => {
      chat[1].swipe_id = 1;
      return { success: true, tableData: { mate: { type: 'acu', version: 1 } } as any };
    });

    expect(result).toMatchObject({ success: false, errorCategory: 'precondition', error: expect.stringContaining('持久化前') });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('apply 改写了写回目标楼层（persist.targetMessageIndex）：核对的是实际写回的那一楼', async () => {
    const chat: any[] = [
      { is_user: false, mes: '旧楼', swipe_id: 0, send_date: 'd0' },
      { is_user: true, mes: '你好' },
      { is_user: false, mes: '目标', swipe_id: 0, send_date: 'd2' },
    ];
    const targetGuard = captureTableFillTargetGuard_ACU(chat, () => chat);
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({ runCommit: async (commitTask: any) => commitTask() }, null));

    const result = await runTableUpdateCommit_ACU({
      ...options('test_target_override'),
      targetMessageIndex: 2,
      targetGuard,
    }, async () => {
      chat[0].swipe_id = 1; // 实际写回的是 #0，它被滑动了；#2 没变
      return { success: true, tableData: { mate: { type: 'acu', version: 1 } } as any, persist: { targetMessageIndex: 0 } };
    });

    expect(result).toMatchObject({ success: false, errorCategory: 'precondition' });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('RuntimeRevision 错误不再分类为 conflict，未知提交错误统一归为 infrastructure', async () => {
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('[RuntimeRevision] 表 sheet_0 已变化'), {
      name: 'TableRuntimeRevisionConflictError',
    }));

    const result = await runTableUpdateCommit_ACU(options('test_runtime_conflict'), vi.fn());

    expect(result).toEqual({
      success: false,
      error: '[RuntimeRevision] 表 sheet_0 已变化',
      errorCategory: 'infrastructure',
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('persist 前只读拒绝空 row_id，且不会调用持久化或修复数据', async () => {
    const invalidData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0',
        name: '损坏表',
        content: [['row_id', '名称'], ['', '未分配身份']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));

    const result = await runTableUpdateCommit_ACU(options('test_row_identity_guard'), async () => ({
      success: true,
      tableData: invalidData,
      value: 'unreachable',
    }));

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('sheetKey=sheet_0, rowIndex=1 的 row_id 为空') });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(invalidData.sheet_0.content[1][0]).toBe('');
  });

  it('persist 前拒绝重复 row_id，并提供可定位的行号', async () => {
    const invalidData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0',
        name: '损坏表',
        content: [['row_id', '名称'], ['stable', '第一行'], ['stable', '第二行']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));

    const result = await runTableUpdateCommit_ACU(options('test_duplicate_row_identity_guard'), async () => ({
      success: true,
      tableData: invalidData,
    }));

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('sheetKey=sheet_0, rowIndex=2 的 row_id 重复：stable') });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('将 workingDataMode=none 透传给事务层，并允许 apply 使用预计算结果', async () => {
    const precomputedData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (transactionOptions: any, task: any) => {
      expect(transactionOptions.workingDataMode).toBe('none');
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });
    mocks.persist.mockResolvedValue({ saved: true, messageIndex: 1 });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_precomputed_commit'),
      workingDataMode: 'none',
      targetSheetKeys: ['sheet_target'],
    }, async ({ workingData }) => ({ success: true, tableData: precomputedData, value: workingData }));

    expect(result).toMatchObject({ success: true, value: null, tableData: precomputedData });
  });

  it('表格持久化失败时回滚同提交暂存的附属状态', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    const rollback = vi.fn();
    const beforePersist = vi.fn(() => ({ rollback }));
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockResolvedValue({ saved: false, error: 'host save failed' });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_before_persist_rollback'),
      targetSheetKeys: ['sheet_target'],
    }, async () => ({
      success: true,
      tableData: data,
      persist: { beforePersist },
    }));

    expect(result).toMatchObject({ success: false, error: 'host save failed', errorCategory: 'infrastructure' });
    expect(beforePersist).toHaveBeenCalledWith(data);
    expect(rollback).toHaveBeenCalledOnce();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('回放宽容、写入严格：persist 拒绝按成因分类——写时探针拒绝可重试(model)，兼容只读门闸不可重试(precondition)', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    const apply = async () => ({ success: true, tableData: data });

    // 写时严格探针：本次增量叠加到目标楼层历史上撞 UNIQUE——是这份 AI 结果的问题，
    // 历史没被写坏，chunk 级重试应把错误反馈给模型重新生成。
    mocks.persist.mockResolvedValueOnce({
      saved: false,
      error: 'V2 写入被拒绝：本次增量与聊天历史回放状态不一致（写入时基底与回放基底不一致），已阻止写出不可严格回放的历史：第 1 条语句失败: INSERT INTO t (row_id) VALUES (1) → UNIQUE constraint failed: t.row_id',
    });
    const guarded = await runTableUpdateCommit_ACU({ ...options('test_write_guard'), targetSheetKeys: ['sheet_target'] }, apply);
    expect(guarded).toMatchObject({ success: false, errorCategory: 'model', error: expect.stringContaining('写入时基底与回放基底不一致') });
    expect(mocks.reload).toHaveBeenCalledTimes(1);

    // 兼容只读门闸：聊天历史本身只能宽容回放，重试 AI 修不好历史——不重试，指向显式恢复。
    mocks.persist.mockResolvedValueOnce({
      saved: false,
      error: 'V2 写入前检测到聊天历史仅可经兼容宽容回放读出（严格回放失败：x），不能继续写入；请在数据管理 → 「诊断 V2 数据恢复」中把兼容回放结果固化为过渡根后重试。',
    });
    const readonly = await runTableUpdateCommit_ACU({ ...options('test_compat_readonly'), targetSheetKeys: ['sheet_target'] }, apply);
    expect(readonly).toMatchObject({ success: false, errorCategory: 'precondition', error: expect.stringContaining('兼容宽容回放读出') });
    expect(mocks.reload).toHaveBeenCalledTimes(2);
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('表格持久化成功后保留同提交暂存的附属状态', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    const rollback = vi.fn();
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockResolvedValue({ saved: true, messageIndex: 1 });

    const result = await runTableUpdateCommit_ACU({ ...options('test_before_persist_success'), targetSheetKeys: ['sheet_target'] }, async () => ({
      success: true,
      tableData: data,
      persist: { beforePersist: () => ({ rollback }) },
    }));

    expect(result.success).toBe(true);
    expect(rollback).not.toHaveBeenCalled();
  });

  it('增量提交只校验目标表，不因未写入表的既有坏行重复扫描并阻断', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: {
        uid: 'sheet_target',
        name: '目标表',
        content: [['row_id', '名称'], ['target-1', '正常']],
      },
      sheet_untouched: {
        uid: 'sheet_untouched',
        name: '未修改表',
        content: [['row_id', '名称'], ['', '历史坏行']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockResolvedValue({ saved: true, messageIndex: 1 });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_scoped_row_identity_guard'),
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_target' }],
      targetSheetKeys: ['sheet_target'],
    }, async () => ({
      success: true,
      tableData: data,
      value: 'saved',
    }));

    expect(result).toMatchObject({ success: true, value: 'saved', saved: true });
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      targetSheetKeys: ['sheet_target'],
      tableData: data,
    }));
  });

  it('全量提交仍校验全部表，不能借范围收窄绕过坏行', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: {
        uid: 'sheet_target',
        name: '目标表',
        content: [['row_id', '名称'], ['target-1', '正常']],
      },
      sheet_broken: {
        uid: 'sheet_broken',
        name: '损坏表',
        content: [['row_id', '名称'], ['', '坏行']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));

    const result = await runTableUpdateCommit_ACU({
      ...options('test_full_row_identity_guard'),
      targetSheetKeys: null,
    }, async () => ({ success: true, tableData: data }));

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('sheetKey=sheet_broken, rowIndex=1 的 row_id 为空'),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});


describe('runTableUpdateCommit_ACU runtime-only 未落盘登记与写回', () => {
  const scope = { chatKey: 'chat-a', isolationKey: 'scope-a' };
  const data: any = {
    mate: { type: 'acu', version: 1 },
    sheet_a: { uid: 'sheet_a', name: '表A', content: [['row_id'], ['1']] },
    sheet_b: { uid: 'sheet_b', name: '表B', content: [['row_id'], ['1']] },
  };

  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.isAutoUpdating = false;
    mocks.migration.mockReset().mockResolvedValue({ success: true, migrated: false });
    mocks.reload.mockReset();
    mocks.transaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockReset().mockResolvedValue({ saved: true, messageIndex: 1 });
    mocks.setCurrentData.mockReset();
    clearRuntimeOnlyPendingSheets_ACU();
    registerRuntimeOnlyPendingFlusher_ACU(null);
  });

  it('外部来源 skipChatSave 提交按写集登记待落盘表，不写聊天', async () => {
    const result = await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'insertRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      revisionWriteSet: [{ kind: 'row', sheetKey: 'sheet_a', rowId: '1' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data, value: 1 }));

    expect(result).toMatchObject({ success: true, saved: true });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(readRuntimeOnlyPendingSheets_ACU(scope)).toEqual({ all: false, sheetKeys: ['sheet_a'] });
  });

  it('kind:all 的外部 skipChatSave 写集按当前全部表登记', async () => {
    await runTableUpdateCommit_ACU({
      source: 'raw_sql_batch',
      reason: 'raw_sql_batch',
      writeSet: [{ kind: 'all' }],
      targetMessageIndex: -1,
      targetSheetKeys: null,
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));

    expect(readRuntimeOnlyPendingSheets_ACU(scope)).toEqual({ all: false, sheetKeys: ['sheet_a', 'sheet_b'] });
  });

  it('非外部来源（填表 import 候选 / 运行时恢复）的 skipChatSave 不登记', async () => {
    await runTableUpdateCommit_ACU({
      source: 'group_fill',
      reason: 'executeCardUpdateCore',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: -1,
      targetSheetKeys: null,
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));
    await runTableUpdateCommit_ACU({
      source: 'import',
      reason: 'importTableAsJson',
      writeSet: [{ kind: 'all' }],
      targetMessageIndex: -1,
      targetSheetKeys: null,
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));

    expect(readRuntimeOnlyPendingSheets_ACU(scope)).toBeNull();
  });

  it('普通持久化提交在开启事务前先触发已注册的写回；flush 自身提交不再触发', async () => {
    const flusher = vi.fn(async () => ({ flushed: true, sheetKeys: ['sheet_a'] }));
    registerRuntimeOnlyPendingFlusher_ACU(flusher);
    await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'insertRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));
    expect(flusher).not.toHaveBeenCalled();

    const order: string[] = [];
    flusher.mockImplementation(async (reason: string) => { order.push(`flush:${reason}`); return { flushed: true, sheetKeys: ['sheet_a'] }; });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => {
      order.push('transaction');
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });

    await runTableUpdateCommit_ACU({
      source: 'group_fill',
      reason: 'executeCardUpdateCore',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
    }, async () => ({ success: true, tableData: data }));
    expect(order).toEqual(['flush:executeCardUpdateCore', 'transaction']);

    flusher.mockClear();
    await runTableUpdateCommit_ACU({
      source: 'system',
      reason: 'runtime_only_flush:test',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipRuntimeOnlyPendingFlush: true,
    }, async () => ({ success: true, tableData: data }));
    expect(flusher).not.toHaveBeenCalled();
  });

  it('写回失败不阻断本次提交', async () => {
    registerRuntimeOnlyPendingFlusher_ACU(vi.fn(async () => { throw new Error('flush exploded'); }));
    await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'insertRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));

    const result = await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'updateRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
    }, async () => ({ success: true, tableData: data, value: true }));
    expect(result.success).toBe(true);
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });

  it('填表进行中依旧拒绝外部写入：runtime-only 闸门不绕过本库外部写闸门', async () => {
    vi.mocked(logWarn_ACU).mockClear();
    vi.mocked(logError_ACU).mockClear();
    mocks.isAutoUpdating = true;
    const result = await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'insertRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('precondition');
    expect(result.error).toContain('已拒绝外部表格写入');
    // 级别控制：precondition 拒绝记 warn（带统一可操作指引），不记 error。
    expect(vi.mocked(logWarn_ACU)).toHaveBeenCalled();
    expect(vi.mocked(logError_ACU)).not.toHaveBeenCalled();
    const warnText = vi.mocked(logWarn_ACU).mock.calls.flat().map((value) => String(value)).join('\n');
    expect(warnText).toContain('切回');
    // 被闸门拒绝的写入不得留下待落盘登记
    expect(readRuntimeOnlyPendingSheets_ACU(scope)).toBeNull();
    // 复位：不得把填表标志泄漏给后续 describe。
    mocks.isAutoUpdating = false;
  });
});


describe('runTableUpdateCommit_ACU stage_only 判别联合（计划 5.3）', () => {
  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.migration.mockReset().mockResolvedValue({ success: true, migrated: false });
    mocks.reload.mockReset();
    mocks.transaction.mockReset();
    mocks.persist.mockReset();
    mocks.ensureProvider.mockReset();
    mocks.setCurrentData.mockReset();
  });

  it('stage_only 不调用 migration、bridge gate、persist，只更新运行时快照', async () => {
    const stagedData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    mocks.transaction.mockImplementation(async (transactionOptions: any, task: any) => {
      expect(transactionOptions.workingDataMode).toBe('none');
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_stage_only_commit'),
      commitMode: 'stage_only',
      workingDataMode: 'none',
      targetSheetKeys: ['sheet_target'],
    }, async () => ({ success: true, tableData: stagedData, value: 'staged' }));

    expect(result).toMatchObject({ success: true, value: 'staged', saved: false });
    expect(mocks.migration).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).toHaveBeenCalledTimes(1);
  });

  it('stage_only 在应用阶段检测到聊天切换时 fail-closed', async () => {
    mocks.transaction.mockImplementation(async (_options: any, task: any) => {
      mocks.currentChatKey = 'chat-b';
      mocks.currentIsolationKey = 'scope-b';
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_stage_only_scope_guard'),
      commitMode: 'stage_only',
      chatKey: 'chat-a',
      isolationKey: 'scope-a',
    }, async () => ({ success: true, tableData: { mate: { type: 'acu', version: 1 } } }));

    expect(result).toMatchObject({
      success: false,
      errorCategory: 'precondition',
      error: expect.stringContaining('聊天或隔离标识已切换'),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });
});

describe('runTableUpdateCommit_ACU 运行时已变更但未落盘时的收敛', () => {
  const data: any = {
    mate: { type: 'acu', version: 1 },
    sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
  };

  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.migration.mockReset().mockResolvedValue({ success: true, migrated: false });
    mocks.reload.mockReset();
    mocks.persist.mockReset();
    mocks.setCurrentData.mockReset();
    mocks.transaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
  });

  it('apply 已改动运行时、随后持久化抛异常：重载运行时，不留下未落盘的孤儿行', async () => {
    // 曾只在 persist 返回 saved:false 时重载；抛异常（如基线过期）时引擎保留整批行。
    mocks.persist.mockRejectedValueOnce(new Error('runtime revision conflict: simulated'));

    const result = await runTableUpdateCommit_ACU({ ...options('test_persist_throw'), targetSheetKeys: ['sheet_target'] }, async () => ({ success: true, tableData: data }));

    expect(result.success).toBe(false);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it('apply 声明运行时已改动但返回失败：同样重载运行时', async () => {
    const result = await runTableUpdateCommit_ACU(options('test_apply_failed_after_mutation'), async () => ({
      success: false, error: '构建回放操作失败', errorCategory: 'model' as const, runtimeMutated: true,
    }));

    expect(result.success).toBe(false);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it('apply 未改动运行时（如 runtime-only 写回聊天）持久化失败：不得重载，否则冲掉待写回的行', async () => {
    mocks.persist.mockResolvedValueOnce({ saved: false, error: 'compat readonly gate' });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_flush_persist_failed'),
      targetSheetKeys: ['sheet_target'],
      skipRuntimeOnlyPendingFlush: true,
      applyMutatesRuntime: false,
    }, async () => ({ success: true, tableData: data }));

    expect(result.success).toBe(false);
    expect(mocks.reload).not.toHaveBeenCalled();
  });
});

describe('块 2A 复审 R2A-04：提交失败回滚保住尚未落盘的运行时写入', () => {
  const pendingScope = { chatKey: 'chat-a', isolationKey: 'scope-a' };
  const before: any = {
    mate: { type: 'acu', version: 1 },
    sheet_script: { uid: 'sheet_script', name: '脚本表', content: [['row_id'], ['script-row']] },
    sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
  };
  const after: any = JSON.parse(JSON.stringify(before));
  after.sheet_target.content.push(['r2']);

  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.migration.mockReset().mockResolvedValue({ success: true, migrated: false });
    mocks.reload.mockReset();
    mocks.persist.mockReset().mockResolvedValue({ saved: false, error: 'disk full' });
    mocks.setCurrentData.mockReset();
    mocks.hydrate.mockReset().mockResolvedValue({ ok: true, degraded: false, source: 'merged' });
    mocks.transaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, JSON.parse(JSON.stringify(before))));
    registerRuntimeOnlyPendingFlusher_ACU(null);
    clearRuntimeOnlyPendingSheets_ACU();
  });

  it('有未落盘的脚本写入时，不整体重载，而是把运行时恢复到本次提交前（含未落盘行）', async () => {
    mocks.storageMode = 'native';
    markRuntimeOnlyPendingSheets_ACU(pendingScope, { all: false, sheetKeys: ['sheet_script'] });
    const result = await runTableUpdateCommit_ACU({ ...options('fill'), targetSheetKeys: ['sheet_target'] }, async () => ({ success: true, tableData: after }));
    expect(result.success).toBe(false);
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).toHaveBeenCalledWith(before);
    expect(readRuntimeOnlyPendingSheets_ACU(pendingScope)?.sheetKeys).toEqual(['sheet_script']);
  });

  it('SQLite 下用提交前快照重建运行时；重建失败时退回整体重载', async () => {
    mocks.storageMode = 'sqlite';
    markRuntimeOnlyPendingSheets_ACU(pendingScope, { all: false, sheetKeys: ['sheet_script'] });
    await runTableUpdateCommit_ACU({ ...options('fill'), targetSheetKeys: ['sheet_target'] }, async () => ({ success: true, tableData: after }));
    expect(mocks.hydrate).toHaveBeenCalledWith(expect.objectContaining({ data: before, storageMode: 'sqlite' }));
    expect(mocks.reload).not.toHaveBeenCalled();

    mocks.hydrate.mockResolvedValueOnce({ ok: false, degraded: false, failureCode: 'provider_init_failed' });
    await runTableUpdateCommit_ACU({ ...options('fill'), targetSheetKeys: ['sheet_target'] }, async () => ({ success: true, tableData: after }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it('没有未落盘写入时维持原行为：整体重载', async () => {
    mocks.storageMode = 'native';
    await runTableUpdateCommit_ACU({ ...options('fill'), targetSheetKeys: ['sheet_target'] }, async () => ({ success: true, tableData: after }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
});

