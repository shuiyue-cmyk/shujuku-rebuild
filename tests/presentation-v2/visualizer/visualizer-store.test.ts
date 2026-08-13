import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useVisualizerStore } from '../../../src/presentation-v2/stores/visualizer-store';

describe('visualizer-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('记录进入来源并在关闭时返回 shell 处理信息', () => {
    const store = useVisualizerStore();

    store.open({
      source: 'external-api',
      wasShellOpen: false,
      previousPageId: 'form-fill',
    });

    expect(store.isActive).toBe(true);
    expect(store.mode).toBe('data');
    expect(store.openTick).toBe(1);

    const result = store.closeSurface();

    expect(result).toEqual({
      shouldCloseShell: true,
      previousPageId: 'form-fill',
    });
    expect(store.isActive).toBe(false);
  });

  it('重复打开复用现有 surface，干净状态下记录一次刷新请求', () => {
    const store = useVisualizerStore();

    store.open({
      source: 'external-api',
      wasShellOpen: true,
      previousPageId: 'dashboard',
    });
    store.open({
      source: 'external-api',
      wasShellOpen: false,
      previousPageId: null,
    });

    expect(store.openTick).toBe(1);
    expect(store.focusTick).toBe(2);
    expect(store.externalRefreshTick).toBe(1);
  });

  it('外部刷新在 dirty 状态下转为冲突标记', () => {
    const store = useVisualizerStore();
    store.open({
      source: 'external-api',
      wasShellOpen: true,
      previousPageId: 'dashboard',
    });
    store.setDirty(true);

    expect(store.requestExternalRefresh()).toBe('conflicted');
    expect(store.externalRevisionChanged).toBe(true);
    expect(store.externalRefreshTick).toBe(0);
  });

  it('载入工作副本后支持切表、编辑单元格和 dirty 标记', () => {
    const store = useVisualizerStore();

    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_b: { name: '事件记录', orderNo: 1, content: [[null, '事项'], [null, '旧值']] },
      sheet_a: { name: '角色状态', orderNo: 0, content: [[null, '姓名', '状态'], [null, 'A', '平静']] },
    }, ['sheet_a', 'sheet_b']);

    expect(store.sheetItems.map(item => item.name)).toEqual(['角色状态', '事件记录']);
    expect(store.currentSheetKey).toBe('sheet_a');
    expect(store.dirty).toBe(false);

    store.updateCell(0, 1, '紧张');

    expect(store.currentSheet.content[1][2]).toBe('紧张');
    expect(store.dirty).toBe(true);
    expect(store.templateBaseData?.sheet_a.content[1][2]).toBe('平静');
    expect(store.templateBaseSheetOrder).toEqual(['sheet_a', 'sheet_b']);
    store.markSaved('template-chat');
    expect(store.templateBaseData?.sheet_a.content[1][2]).toBe('紧张');
  });

  it('新增、删除和排序表格会维护顺序与删除队列', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1']] },
      sheet_b: { name: 'B', orderNo: 1, content: [[null, '列1']] },
    }, ['sheet_a', 'sheet_b']);

    store.addSheet('sheet_c', { name: 'C', content: [[null, '列1']] });
    expect(store.sheetOrder).toEqual(['sheet_a', 'sheet_b', 'sheet_c']);
    expect(store.currentSheetKey).toBe('sheet_c');

    store.moveSheet('sheet_c', 'up');
    expect(store.sheetOrder).toEqual(['sheet_a', 'sheet_c', 'sheet_b']);
    expect(store.tempData?.sheet_c.orderNo).toBe(1);

    store.deleteSheet('sheet_c');
    expect(store.sheetOrder).toEqual(['sheet_a', 'sheet_b']);
    expect(store.deletedSheetKeys).toEqual(['sheet_c']);
    expect(store.dirty).toBe(true);
  });

  it('删除中间表后存活表 orderNo 保留空洞，手动排序仍会连续重排', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1']] },
      sheet_b: { name: 'B', orderNo: 1, content: [[null, '列1']] },
      sheet_c: { name: 'C', orderNo: 2, content: [[null, '列1']] },
    }, ['sheet_a', 'sheet_b', 'sheet_c']);

    store.deleteSheet('sheet_b');

    expect(store.sheetOrder).toEqual(['sheet_a', 'sheet_c']);
    expect(store.deletedSheetKeys).toEqual(['sheet_b']);
    expect(store.tempData?.sheet_a.orderNo).toBe(0);
    expect(store.tempData?.sheet_c.orderNo).toBe(2);
    expect(store.tempData?.sheet_b).toBeUndefined();

    store.moveSheet('sheet_c', 'up');

    expect(store.sheetOrder).toEqual(['sheet_c', 'sheet_a']);
    expect(store.tempData?.sheet_c.orderNo).toBe(0);
    expect(store.tempData?.sheet_a.orderNo).toBe(1);
  });

  it('锁状态作为 visualizer 草稿维护，AI lockChanges 会合并到同一份草稿', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      sheet_a: { name: '总结表', orderNo: 0, content: [[null, '事件', '编码索引'], [null, '旧值', 'AM0001']] },
    }, ['sheet_a']);
    store.loadLockDrafts({
      sheet_a: {
        rows: [],
        cols: [1],
        cells: [],
        specialIndexLocked: true,
      },
    });
    expect(store.lockDirty).toBe(false);

    store.toggleRowLock('sheet_a', 0);
    store.toggleCellLock('sheet_a', 0, 0);
    store.applyLockChangesToDraft([
      {
        sheetKey: 'sheet_a',
        columns: [{ colIndex: 1, locked: false }],
        cells: [{ rowIndex: 0, colIndex: 0, locked: false }],
        specialIndexLocked: false,
      },
    ]);

    expect(store.isRowLocked('sheet_a', 0)).toBe(true);
    expect(store.isColumnLocked('sheet_a', 1)).toBe(false);
    expect(store.isCellLocked('sheet_a', 0, 0)).toBe(false);
    expect(store.isSpecialIndexLocked('sheet_a')).toBe(false);
    expect(store.lockDirty).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it('committed 状态冻结所有结构与锁草稿编辑入口', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1'], ['1', '旧值']] },
      sheet_b: { name: 'B', orderNo: 1, content: [[null, '列1'], ['1', '旧值']] },
    }, ['sheet_a', 'sheet_b']);
    store.loadLockDrafts({
      sheet_a: { rows: [], cols: [], cells: [], specialIndexLocked: true },
    });
    store.pendingDataOps.committed = { afterData: {}, insertedRowIds: {} };
    const before = JSON.stringify({
      tempData: store.tempData,
      deletedSheetKeys: store.deletedSheetKeys,
      sheetOrder: store.sheetOrder,
      tableLockDrafts: store.tableLockDrafts,
      pendingLockChanges: store.pendingLockChanges,
      dirty: store.dirty,
      lockDirty: store.lockDirty,
    });
    const actions = [
      () => store.addSheet('sheet_c', { name: 'C', content: [[null, '列1']] }),
      () => store.deleteSheet('sheet_a'),
      () => store.moveSheet('sheet_b', 'up'),
      () => store.toggleRowLock('sheet_a', 0),
      () => store.toggleColumnLock('sheet_a', 0),
      () => store.toggleCellLock('sheet_a', 0, 0),
      () => store.applyLockChangesToDraft([{ sheetKey: 'sheet_a', rows: [{ rowIndex: 0, locked: true }] }]),
      () => store.queueLockChanges([{ sheetKey: 'sheet_a', rows: [{ rowIndex: 0, locked: true }] }]),
    ];

    actions.forEach(action => expect(action).toThrow('数据已持久化但本地刷新尚未完成'));

    expect(JSON.stringify({
      tempData: store.tempData,
      deletedSheetKeys: store.deletedSheetKeys,
      sheetOrder: store.sheetOrder,
      tableLockDrafts: store.tableLockDrafts,
      pendingLockChanges: store.pendingLockChanges,
      dirty: store.dirty,
      lockDirty: store.lockDirty,
    })).toBe(before);
  });

  it('saving 状态冻结所有结构与锁草稿编辑入口', () => {
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { name: 'A', orderNo: 0, content: [[null, '列1'], ['1', '旧值']] },
      sheet_b: { name: 'B', orderNo: 1, content: [[null, '列1'], ['1', '旧值']] },
    }, ['sheet_a', 'sheet_b']);
    store.loadLockDrafts({
      sheet_a: { rows: [], cols: [], cells: [], specialIndexLocked: true },
    });
    store.setSaving(true);
    const before = JSON.stringify({
      tempData: store.tempData,
      deletedSheetKeys: store.deletedSheetKeys,
      sheetOrder: store.sheetOrder,
      tableLockDrafts: store.tableLockDrafts,
      pendingLockChanges: store.pendingLockChanges,
      dirty: store.dirty,
      lockDirty: store.lockDirty,
    });
    const actions = [
      () => store.addSheet('sheet_c', { name: 'C', content: [[null, '列1']] }),
      () => store.deleteSheet('sheet_a'),
      () => store.moveSheet('sheet_b', 'up'),
      () => store.toggleRowLock('sheet_a', 0),
      () => store.toggleColumnLock('sheet_a', 0),
      () => store.toggleCellLock('sheet_a', 0, 0),
      () => store.applyLockChangesToDraft([{ sheetKey: 'sheet_a', rows: [{ rowIndex: 0, locked: true }] }]),
      () => store.queueLockChanges([{ sheetKey: 'sheet_a', rows: [{ rowIndex: 0, locked: true }] }]),
    ];

    actions.forEach(action => expect(action).toThrow('保存正在进行中'));

    expect(JSON.stringify({
      tempData: store.tempData,
      deletedSheetKeys: store.deletedSheetKeys,
      sheetOrder: store.sheetOrder,
      tableLockDrafts: store.tableLockDrafts,
      pendingLockChanges: store.pendingLockChanges,
      dirty: store.dirty,
      lockDirty: store.lockDirty,
    })).toBe(before);
  });
});
