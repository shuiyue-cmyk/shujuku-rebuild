/**
 * R9-14：锁 API 支持按 row_id 寻址（与 CRUD 的行号口径无关），旧下标方法为 0 基数据行。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tableData: null as any,
  lockRows: new Set<number>(),
  save: vi.fn(),
}));

vi.mock('../../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.tableData; },
}));
vi.mock('../../../../src/shared/utils', () => ({ logError_ACU: vi.fn() }));
vi.mock('../../../../src/service/runtime/helpers-remaining', () => ({
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: h.lockRows, cols: new Set(), cells: new Set() })),
  saveTableLocksForSheet_ACU: h.save,
  toggleRowLock_ACU: vi.fn(),
  toggleColLock_ACU: vi.fn(),
  toggleCellLock_ACU: vi.fn(),
  isSpecialIndexLockEnabled_ACU: vi.fn(),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
}));

import { createTableLockApi } from '../../../../src/presentation/bootstrap/api-groups/table-lock-api';

beforeEach(() => {
  h.tableData = { sheet_a: { name: '人物', content: [[null, '名字'], ['r1', '甲'], ['r2', '乙'], ['r3', '丙']] } };
  h.lockRows = new Set();
  h.save.mockReset();
});

describe('lockTableRowById（R9-14）', () => {
  it('按 row_id 找到当前数据行再加锁/解锁', () => {
    const api = createTableLockApi({} as any);

    expect(api.lockTableRowById('sheet_a', 'r2')).toBe(true);
    expect([...h.lockRows]).toEqual([1]);
    expect(api.lockTableRowById('sheet_a', 'r2', false)).toBe(true);
    expect([...h.lockRows]).toEqual([]);
  });

  it('row_id 不存在时返回 false，不写锁', () => {
    const api = createTableLockApi({} as any);

    expect(api.lockTableRowById('sheet_a', 'r404')).toBe(false);
    expect(api.lockTableRowById('sheet_x', 'r1')).toBe(false);
    expect(h.save).not.toHaveBeenCalled();
  });
});
