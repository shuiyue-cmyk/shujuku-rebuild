import { describe, expect, it } from 'vitest';
import {
  VIZ_PAGE_SIZE,
  isShortDataField,
  pageWindow,
  pairFieldRows,
} from '../../src/presentation-v3/surfaces/visualizer/data-layout';

describe('数据库编辑器（v3）数据布局', () => {
  it('短字段：单行且不超过 24 字；换行或超长都算长字段', () => {
    expect(isShortDataField('')).toBe(true);
    expect(isShortDataField('平静')).toBe(true);
    expect(isShortDataField('一'.repeat(24))).toBe(true);
    expect(isShortDataField('一'.repeat(25))).toBe(false);
    expect(isShortDataField('第一行\n第二行')).toBe(false);
    expect(isShortDataField('  多个   空格  会被压成一个  ')).toBe(true);
  });

  it('相邻两列都短时并排，否则独占一行', () => {
    const fields = [0, 1, 2, 3, 4].map(columnIndex => ({ columnIndex }));
    const rows = pairFieldRows(fields, [true, true, false, true, true]);
    expect(rows.map(row => [row.wide, row.fields.map(f => f.columnIndex)])).toEqual([
      [false, [0, 1]],
      [true, [2]],
      [false, [3, 4]],
    ]);
    expect(pairFieldRows(fields.slice(0, 3), [true, true, true]).map(row => row.fields.length)).toEqual([2, 1]);
    expect(pairFieldRows([], [])).toEqual([]);
  });

  it('分页窗口：页码夹在 1..总页数，空表也有 1 页', () => {
    expect(VIZ_PAGE_SIZE).toBe(30);
    expect(pageWindow(0, 1)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 });
    expect(pageWindow(31, 2)).toEqual({ page: 2, pageCount: 2, start: 30, end: 31 });
    expect(pageWindow(31, 9)).toEqual({ page: 2, pageCount: 2, start: 30, end: 31 });
    expect(pageWindow(31, 0)).toEqual({ page: 1, pageCount: 2, start: 0, end: 30 });
    expect(pageWindow(31, Number.NaN)).toEqual({ page: 1, pageCount: 2, start: 0, end: 30 });
  });
});
