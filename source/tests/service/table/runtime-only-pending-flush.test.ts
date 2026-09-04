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
    // 按集合清账：成功清除只覆盖本次实际落盘的 sheet_a；与回放一致的 sheet_b 登记保留
    //（旧实现放锁后全量清空会连它一起清掉；并发修复后不越界清除，也绝不丢登记）。
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_b'] });
    // 收敛性：下一轮 flush 确认 sheet_b 与回放一致后按候选集条件化清空（登记不泄漏）。
    const secondPass = await flushRuntimeOnlyPendingChanges_ACU('test-second-pass');
    expect(secondPass).toEqual({ flushed: false, sheetKeys: [] });
    expect(mocks.commit).toHaveBeenCalledTimes(1); // 第二轮确认一致，无需再提交
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

  // ═══ 并发窗口修复（clear 移入事务内 + 按集合条件化清账）═══
  // 旧实现在 runTableUpdateCommit 返回（finally 放锁）之后才 clearRuntimeOnlyPendingSheets_ACU(scope)：
  // 放锁到清除之间的微任务窗口里，并发写者（runTableUpdateCommit 持锁 markRuntimeOnlyPendingSheets）
  // 新登记的 sheet 会被全量清空且未落盘。新实现把清除移入 apply（持锁中），且只清「本次实际处理集」。
  describe('并发窗口与按集合清账', () => {
    beforeEach(() => {
      // 持锁重算组用例会改写 ensureStorageProviderReady 的实现且共享 beforeEach 不复位；
      // 本组统一恢复为默认快照读取形状（每次读都返回当前 providerData）。
      vi.mocked(ensureStorageProviderReady_ACU).mockClear();
      vi.mocked(ensureStorageProviderReady_ACU).mockImplementation(async () => ({ mode: 'sqlite', getCurrentData: () => mocks.providerData }));
    });

    it('并发窗口：apply 持锁清除之后、事务返回之前新登记的表在本次成功后仍存活', async () => {
      // vi.mock 包透传：commit mock 内部调用 apply，使持锁清除真实可达；apply 返回后、
      // 事务返回前模拟并发写者在新窗口 mark 新表 sheet_c（旧实现的全量 clear 会吞掉它）。
      mocks.commit.mockImplementation(async (_options: any, apply: any) => {
        const applied = await apply({});
        markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_c'] });
        return applied.success
          ? { success: true, messageIndex: 2 }
          : { success: false, error: applied.error, errorCategory: applied.errorCategory };
      });
      markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });

      const result = await flushRuntimeOnlyPendingChanges_ACU('test');

      expect(result.flushed).toBe(true);
      expect(result.sheetKeys).toEqual(['sheet_a']);
      // 清除只覆盖本次实际落盘的 sheet_a；并发写者新登记的 sheet_c 存活，等下一次落盘。
      expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_c'] });
    });

    it('并发窗口：锁等待期间新登记的表不在清除集合内，成功落盘后仍存活', async () => {
      mocks.commit.mockImplementation(async (_options: any, apply: any) => {
        // [并发] 写者 W 在 T0 读取之后、持锁 apply 之前 mark 了新表 sheet_c。
        markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_c'] });
        const applied = await apply({});
        return applied.success
          ? { success: true, messageIndex: 2 }
          : { success: false, error: applied.error, errorCategory: applied.errorCategory };
      });
      markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });

      const result = await flushRuntimeOnlyPendingChanges_ACU('test');

      expect(result.flushed).toBe(true);
      expect(result.sheetKeys).toEqual(['sheet_a']);
      expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_c'] });
    });

    it('负向控制：apply 持锁清除后 persist 失败时补登记，登记不丢（等价于失败完全不清）', async () => {
      mocks.commit.mockImplementation(async (_options: any, apply: any) => {
        const applied = await apply({});
        if (!applied.success) return { success: false, error: applied.error, errorCategory: applied.errorCategory };
        // apply 成功并已持锁清除，但其后的 persist（宿主保存）失败 → 提交整体失败。
        return { success: false, error: 'host persist failed' };
      });
      markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });

      const result = await flushRuntimeOnlyPendingChanges_ACU('test');

      expect(result).toEqual({ flushed: false, sheetKeys: ['sheet_a'], error: 'host persist failed' });
      // 失败路径等价于「完全不清」：被清除的 sheet_a 已补登记回去，等待下次重试。
      expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_a'] });
    });

    it('NOTHING_TO_FLUSH 持锁按候选集条件化清除：锁等待期间并发登记的新表存活', async () => {
      let snapshotReads = 0;
      vi.mocked(ensureStorageProviderReady_ACU).mockImplementation(async () => {
        snapshotReads += 1;
        if (snapshotReads >= 2) {
          // 持锁后：并发写者已把 sheet_a 物化进聊天 → 持锁重算无分歧 → NOTHING_TO_FLUSH。
          mocks.replay.mockResolvedValue({ data: { sheet_a: sheet([['row_id', '值'], ['1', '前端写入']]), sheet_b: sheet([['row_id', '值']]) } });
        }
        return { mode: 'sqlite', getCurrentData: () => mocks.providerData };
      });
      mocks.commit.mockImplementation(async (_options: any, apply: any) => {
        // [并发] 写者 W 在 T0 读取之后、持锁 apply 之前 mark 了新表 sheet_c。
        markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_c'] });
        const applied = await apply({});
        return applied.success
          ? { success: true, messageIndex: 2 }
          : { success: false, error: applied.error, errorCategory: applied.errorCategory };
      });
      markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });

      const result = await flushRuntimeOnlyPendingChanges_ACU('test');

      expect(result).toEqual({ flushed: false, sheetKeys: [] });
      // 持锁清除只覆盖重算候选集 {sheet_a}；并发登记的 sheet_c 存活。
      expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_c'] });
    });
  });
});
