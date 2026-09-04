import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  chatKey: 'chat-a',
  isolationKey: '',
  sqlite: true,
  providerData: null as any,
  currentJsonTableData: null as any,
  replay: vi.fn(),
  commit: vi.fn(),
  settings: { dataIsolationEnabled: false, dataIsolationCode: '' },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mocks.chat,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mocks.chatKey; },
  get currentJsonTableData_ACU() { return mocks.currentJsonTableData; },
  get settings_ACU() { return mocks.settings; },
  getCurrentIsolationKey_ACU: () => mocks.isolationKey,
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: () => mocks.sqlite,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: vi.fn(async () => ({ mode: 'sqlite', getCurrentData: () => mocks.providerData })),
}));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2Detailed_ACU: (...args: any[]) => mocks.replay(...args),
}));
vi.mock('../../../src/service/table/table-history', () => ({
  getLatestTableAppendMessageIndexFromChat_ACU: (chat: any[]) => {
    for (let i = chat.length - 1; i >= 0; i -= 1) if (chat[i] && !chat[i].is_user) return i;
    return -1;
  },
}));
vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: (...args: any[]) => mocks.commit(...args),
}));

import { flushRuntimeOnlyPendingChanges_ACU } from '../../../src/service/table/runtime-only-pending-flush';
import { ensureStorageProviderReady_ACU } from '../../../src/service/table/table-storage-strategy';
import {
  clearRuntimeOnlyPendingSheets_ACU,
  markRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  runRegisteredRuntimeOnlyPendingFlush_ACU,
} from '../../../src/service/table/runtime-only-pending-state';

const scope = () => ({ chatKey: mocks.chatKey, isolationKey: mocks.isolationKey });

function sheet(rows: any[][]) {
  return { uid: 'sheet_a', name: '表A', content: rows, sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 };
}

describe('flushRuntimeOnlyPendingChanges_ACU', () => {
  beforeEach(() => {
    clearRuntimeOnlyPendingSheets_ACU();
    mocks.chat.length = 0;
    mocks.chat.push({ is_user: false, mes: 'AI0' }, { is_user: true, mes: 'U1' }, { is_user: false, mes: 'AI2' });
    mocks.sqlite = true;
    mocks.providerData = {
      mate: { type: 'acu' },
      sheet_a: sheet([['row_id', '值'], ['1', '前端写入']]),
      sheet_b: sheet([['row_id', '值']]),
    };
    mocks.currentJsonTableData = null;
    mocks.replay.mockReset().mockResolvedValue({ data: { sheet_a: sheet([['row_id', '值']]), sheet_b: sheet([['row_id', '值']]) } });
    mocks.commit.mockReset().mockResolvedValue({ success: true, messageIndex: 2 });
  });

  it('无登记时不读运行时、不提交', async () => {
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result).toEqual({ flushed: false, sheetKeys: [] });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('登记表与回放不一致时，以 sheet_replace 写回最新 AI 楼层并清空登记', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a', 'sheet_b'] });

    const result = await flushRuntimeOnlyPendingChanges_ACU('processUpdatesBatch');

    expect(result).toEqual({ flushed: true, sheetKeys: ['sheet_a'], messageIndex: 2 });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    const [options, apply] = mocks.commit.mock.calls[0];
    expect(options).toMatchObject({
      source: 'system',
      reason: 'runtime_only_flush:processUpdatesBatch',
      targetMessageIndex: 2,
      targetSheetKeys: ['sheet_a'],
      trackAsUpdate: false,
      trackingSheetKeys: [],
      revisionWriteSet: [],
      skipRuntimeOnlyPendingFlush: true,
      // writeSet 覆盖全部候选表（⊇ 持锁重算后的任何分歧集），而非仅 T0 分歧表。
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }, { kind: 'sheet', sheetKey: 'sheet_b' }],
    });
    // 持锁重算：operations 由 apply 在持锁后以 fresh 快照重建，经 persist 覆盖生效。
    expect(options.operations).toBeUndefined();
    const applied = await apply({});
    expect(applied.success).toBe(true);
    expect(applied.persist.targetMessageIndex).toBe(2);
    expect(applied.persist.targetSheetKeys).toEqual(['sheet_a']);
    expect(applied.persist.operations).toEqual([{
      kind: 'sheet_replace',
      sheetKey: 'sheet_a',
      sheet: expect.objectContaining({ content: [['row_id', '值'], ['1', '前端写入']] }),
      reason: 'system',
    }]);
    expect(applied.tableData.sheet_a.content).toEqual([['row_id', '值'], ['1', '前端写入']]);
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toBeNull();
  });

  it('运行时与回放一致的表不写入；全部一致时清空登记且不提交', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_b'] });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result).toEqual({ flushed: false, sheetKeys: [] });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toBeNull();
  });

  it('all 登记按运行时全部表比对；回放失败时保守地写回全部候选表', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: true, sheetKeys: [] });
    mocks.replay.mockRejectedValue(new Error('replay broken'));
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result.flushed).toBe(true);
    expect(result.sheetKeys).toEqual(['sheet_a', 'sheet_b']);
    expect(mocks.commit.mock.calls[0][0].targetSheetKeys).toEqual(['sheet_a', 'sheet_b']);
  });

  it('提交失败时保留登记等待下次重试', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    mocks.commit.mockResolvedValue({ success: false, error: 'host save failed' });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result).toEqual({ flushed: false, sheetKeys: ['sheet_a'], error: 'host save failed' });
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_a'] });
  });

  it('没有 AI 楼层可写时不提交且保留登记', async () => {
    mocks.chat.length = 0;
    mocks.chat.push({ is_user: true, mes: 'U0' });
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result.flushed).toBe(false);
    expect(result.error).toContain('no AI message');
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).not.toBeNull();
  });

  it('native 模式以 currentJsonTableData 作为运行时快照', async () => {
    mocks.sqlite = false;
    mocks.currentJsonTableData = { mate: { type: 'acu' }, sheet_a: sheet([['row_id', '值'], ['1', 'native 行']]) };
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result.flushed).toBe(true);
    const [, apply] = mocks.commit.mock.calls[0];
    const applied = await apply({});
    expect(applied.persist.operations[0].sheet.content).toEqual([['row_id', '值'], ['1', 'native 行']]);
  });

  it('模块加载即向 state 注册落盘器，提交模型可通过注册入口触发', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    const result = await runRegisteredRuntimeOnlyPendingFlush_ACU(scope(), 'insertRow');
    expect(result.flushed).toBe(true);
    expect(mocks.commit.mock.calls[0][0].reason).toBe('runtime_only_flush:insertRow');
  });

  // 真实提交契约：commit mock 内部调用 apply，使持锁重算（T1）逻辑可达。
  function runCommitWithRealApply() {
    mocks.commit.mockImplementation(async (_options: any, apply: any) => {
      const applied = await apply({});
      return applied.success
        ? { success: true, messageIndex: 2 }
        : { success: false, error: applied.error, errorCategory: applied.errorCategory };
    });
  }

  it('持锁重算：第二写者在快照与抢锁之间提交时，以最新运行时重建 operations，不回滚其结果', async () => {
    runCommitWithRealApply();
    // T0 读快照后、抢锁前，第二写者（runtime-only 写入）把新行追加进运行时。
    let snapshotReads = 0;
    vi.mocked(ensureStorageProviderReady_ACU).mockImplementation(async () => {
      snapshotReads += 1;
      if (snapshotReads >= 2) {
        mocks.providerData = {
          mate: { type: 'acu' },
          sheet_a: sheet([['row_id', '值'], ['1', '前端写入'], ['2', '第二写者']]),
          sheet_b: sheet([['row_id', '值']]),
        };
      }
      return { mode: 'sqlite', getCurrentData: () => mocks.providerData };
    });
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });

    const result = await flushRuntimeOnlyPendingChanges_ACU('test');

    expect(result.flushed).toBe(true);
    expect(result.sheetKeys).toEqual(['sheet_a']);
    // 写入内容来自持锁后的 fresh 快照（含第二写者的行），而不是 T0 旧快照。
    const [, apply] = mocks.commit.mock.calls[0];
    const applied = await apply({});
    expect(applied.persist.operations[0].sheet.content).toEqual([['row_id', '值'], ['1', '前端写入'], ['2', '第二写者']]);
    expect(applied.tableData.sheet_a.content).toEqual([['row_id', '值'], ['1', '前端写入'], ['2', '第二写者']]);
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toBeNull();
  });

  it('持锁重算：第二写者已把内容物化进聊天时，清空登记且不再写重复帧', async () => {
    runCommitWithRealApply();
    let snapshotReads = 0;
    vi.mocked(ensureStorageProviderReady_ACU).mockImplementation(async () => {
      snapshotReads += 1;
      if (snapshotReads >= 2) {
        // 第二写者已把登记表内容物化：持锁后回放与运行时一致。
        mocks.replay.mockResolvedValue({ data: { sheet_a: sheet([['row_id', '值'], ['1', '前端写入']]), sheet_b: sheet([['row_id', '值']]) } });
      }
      return { mode: 'sqlite', getCurrentData: () => mocks.providerData };
    });
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });

    const result = await flushRuntimeOnlyPendingChanges_ACU('test');

    expect(result).toEqual({ flushed: false, sheetKeys: [] });
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toBeNull();
  });

  it('持锁重算：锁内目标楼层丢失时保留登记等待下次重试', async () => {
    runCommitWithRealApply();
    let snapshotReads = 0;
    vi.mocked(ensureStorageProviderReady_ACU).mockImplementation(async () => {
      snapshotReads += 1;
      if (snapshotReads >= 2) {
        // 抢锁后聊天被重建为只剩 user 楼层：无可写 AI 楼层。
        mocks.chat.length = 0;
        mocks.chat.push({ is_user: true, mes: 'U0' });
      }
      return { mode: 'sqlite', getCurrentData: () => mocks.providerData };
    });
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });

    const result = await flushRuntimeOnlyPendingChanges_ACU('test');

    expect(result.flushed).toBe(false);
    expect(result.error).toContain('no AI message');
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_a'] });
  });
});
