/**
 * 块 5 复审 R5-12：纪要表选取按「纪要表 > 总结表 > 总体大纲」优先级，不依赖对象键顺序。
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ data: null as any }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.data; },
}));

import { findSummaryTableSelection_ACU } from '../../../src/service/vector/summary-vector-index-scope-resolver';
import { pickSummarySheetKeyByPriority_ACU } from '../../../src/shared/utils';

const sheet = (name: string) => ({ name, content: [['row_id']] });

describe('块 5 复审 R5-12：纪要表选取优先级', () => {
  it('大纲排在前面时仍选总结表', () => {
    h.data = { sheet_outline: sheet('总体大纲'), sheet_summary: sheet('总结表') };
    expect(findSummaryTableSelection_ACU()?.summaryKey).toBe('sheet_summary');
  });

  it('纪要表优先于总结表', () => {
    h.data = { sheet_summary: sheet('总结表'), sheet_chronicle: sheet('纪要表'), sheet_outline: sheet('总体大纲') };
    expect(findSummaryTableSelection_ACU()?.summaryKey).toBe('sheet_chronicle');
  });

  it('只有总体大纲时仍可选中', () => {
    h.data = { sheet_outline: sheet('总体大纲'), sheet_other: sheet('物品表') };
    expect(findSummaryTableSelection_ACU()?.summaryKey).toBe('sheet_outline');
  });

  it('共用选取函数对任意数据源同口径', () => {
    const data: Record<string, any> = { a: sheet('总体大纲'), b: sheet('物品表'), c: sheet('总结表') };
    expect(pickSummarySheetKeyByPriority_ACU(Object.keys(data), (key) => data[key]?.name)).toBe('c');
  });
});
