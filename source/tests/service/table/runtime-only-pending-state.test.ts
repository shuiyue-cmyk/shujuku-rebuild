import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRuntimeOnlyPendingScopeKey_ACU,
  clearRuntimeOnlyPendingSheetKeys_ACU,
  clearRuntimeOnlyPendingSheets_ACU,
  extractPendingSheetKeysFromWriteSet_ACU,
  hasRuntimeOnlyPendingSheets_ACU,
  markRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  registerRuntimeOnlyPendingFlusher_ACU,
  runRegisteredRuntimeOnlyPendingFlush_ACU,
} from '../../../src/service/table/runtime-only-pending-state';

const scopeA = { chatKey: 'chat-a', isolationKey: '' };
const scopeB = { chatKey: 'chat-b', isolationKey: 'tag' };

describe('runtime-only-pending-state', () => {
  beforeEach(() => {
    clearRuntimeOnlyPendingSheets_ACU();
    registerRuntimeOnlyPendingFlusher_ACU(null);
  });

  it('scope key 对空 chatKey/isolationKey 使用稳定默认值', () => {
    expect(buildRuntimeOnlyPendingScopeKey_ACU({})).toBe('current-chat::default');
    expect(buildRuntimeOnlyPendingScopeKey_ACU({ chatKey: ' chat ', isolationKey: 'tag' })).toBe('chat::tag');
  });

  it('extractPendingSheetKeysFromWriteSet：sheet/row/cell 单元归并到表；all 或缺 sheetKey 视为全部', () => {
    expect(extractPendingSheetKeysFromWriteSet_ACU([
      { kind: 'sheet', sheetKey: 'sheet_b' },
      { kind: 'row', sheetKey: 'sheet_a' },
      { kind: 'cell', sheetKey: 'sheet_a' },
    ])).toEqual({ all: false, sheetKeys: ['sheet_a', 'sheet_b'] });
    expect(extractPendingSheetKeysFromWriteSet_ACU([{ kind: 'all' }])).toEqual({ all: true, sheetKeys: [] });
    expect(extractPendingSheetKeysFromWriteSet_ACU([{ kind: 'sheet', sheetKey: '' }])).toEqual({ all: true, sheetKeys: [] });
    expect(extractPendingSheetKeysFromWriteSet_ACU([])).toEqual({ all: true, sheetKeys: [] });
    expect(extractPendingSheetKeysFromWriteSet_ACU(null)).toEqual({ all: true, sheetKeys: [] });
  });

  it('按 scope 隔离登记，多次登记合并且去重', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_b', 'sheet_a'] });
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a', 'not_a_sheet'] });
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toEqual({ all: false, sheetKeys: ['sheet_a', 'sheet_b'] });
    expect(readRuntimeOnlyPendingSheets_ACU(scopeB)).toBeNull();
    expect(hasRuntimeOnlyPendingSheets_ACU(scopeA)).toBe(true);
    expect(hasRuntimeOnlyPendingSheets_ACU(scopeB)).toBe(false);
  });

  it('all 登记一旦出现就保持为 all', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: true, sheetKeys: [] });
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a'] });
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toEqual({ all: true, sheetKeys: ['sheet_a'] });
  });

  it('clear 只清指定 scope；不传 scope 清空全部', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a'] });
    markRuntimeOnlyPendingSheets_ACU(scopeB, { all: false, sheetKeys: ['sheet_b'] });
    clearRuntimeOnlyPendingSheets_ACU(scopeA);
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toBeNull();
    expect(readRuntimeOnlyPendingSheets_ACU(scopeB)).toEqual({ all: false, sheetKeys: ['sheet_b'] });
    clearRuntimeOnlyPendingSheets_ACU();
    expect(readRuntimeOnlyPendingSheets_ACU(scopeB)).toBeNull();
  });

  // 按集合条件化清除：runtime-only-pending-flush 持锁内按「本次实际处理集」清账专用，
  // 不能吞掉同 scope 下并发写者新登记的其他表（全量 clear 的并发窗口缺陷）。
  it('按集合清除只移除给定表并保留同 scope 其他登记；清空后删除 scope 条目', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a', 'sheet_b'] });
    clearRuntimeOnlyPendingSheetKeys_ACU(scopeA, ['sheet_a']);
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toEqual({ all: false, sheetKeys: ['sheet_b'] });
    clearRuntimeOnlyPendingSheetKeys_ACU(scopeA, ['sheet_b']);
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toBeNull();
    expect(hasRuntimeOnlyPendingSheets_ACU(scopeA)).toBe(false);
  });

  it('按集合清除的 dropAllFlag 关闭 all 语义且不影响其他表的显式登记', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: true, sheetKeys: ['sheet_a'] });
    // 模拟并发写者在 flush 候选计算之后登记的新表：清除集合之外，必须存活。
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_c'] });
    clearRuntimeOnlyPendingSheetKeys_ACU(scopeA, ['sheet_a'], { dropAllFlag: true });
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toEqual({ all: false, sheetKeys: ['sheet_c'] });
  });

  it('按集合清除未知 scope 或未登记的表是无害 no-op', () => {
    expect(() => clearRuntimeOnlyPendingSheetKeys_ACU(scopeB, ['sheet_x'])).not.toThrow();
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a'] });
    clearRuntimeOnlyPendingSheetKeys_ACU(scopeA, ['sheet_not_present']);
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toEqual({ all: false, sheetKeys: ['sheet_a'] });
    clearRuntimeOnlyPendingSheetKeys_ACU(scopeA, ['sheet_a']);
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toBeNull();
  });

  it('未注册落盘器或无登记时 runRegistered 直接返回未落盘且不调用', async () => {
    const flusher = vi.fn(async () => ({ flushed: true, sheetKeys: ['sheet_a'] }));
    expect(await runRegisteredRuntimeOnlyPendingFlush_ACU(scopeA, 'r')).toEqual({ flushed: false, sheetKeys: [] });

    registerRuntimeOnlyPendingFlusher_ACU(flusher);
    expect(await runRegisteredRuntimeOnlyPendingFlush_ACU(scopeA, 'r')).toEqual({ flushed: false, sheetKeys: [] });
    expect(flusher).not.toHaveBeenCalled();

    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a'] });
    expect(await runRegisteredRuntimeOnlyPendingFlush_ACU(scopeA, 'reason-x')).toEqual({ flushed: true, sheetKeys: ['sheet_a'] });
    expect(flusher).toHaveBeenCalledWith('reason-x');
  });
});
