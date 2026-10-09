import { describe, expect, it } from 'vitest';
import {
  VIZ_PAGE_SIZE,
  pageWindow,
} from '../../src/presentation-v3/surfaces/visualizer/data-layout';

describe('数据库编辑器（v3）数据布局', () => {

  it('分页窗口：页码夹在 1..总页数，空表也有 1 页', () => {
    expect(VIZ_PAGE_SIZE).toBe(30);
    expect(pageWindow(0, 1)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 });
    expect(pageWindow(31, 2)).toEqual({ page: 2, pageCount: 2, start: 30, end: 31 });
    expect(pageWindow(31, 9)).toEqual({ page: 2, pageCount: 2, start: 30, end: 31 });
    expect(pageWindow(31, 0)).toEqual({ page: 1, pageCount: 2, start: 0, end: 30 });
    expect(pageWindow(31, Number.NaN)).toEqual({ page: 1, pageCount: 2, start: 0, end: 30 });
  });
});
