
/**
 * tests/service/worldbook/injection-engine-order.test.ts
 * 世界书注入引擎 Order 分配工具 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  getEntryOrderNumber_ACU,
  buildUsedOrderSet_ACU,
  allocOrder_ACU,
  allocConsecutiveOrderBlock_ACU,
} from '../../../src/service/worldbook/injection-engine-order';

// ═══ getEntryOrderNumber_ACU ═══
describe('getEntryOrderNumber_ACU', () => {
  it('数字 order 直接返回', () => {
    expect(getEntryOrderNumber_ACU({ order: 42 })).toBe(42);
  });

  it('字符串数字 order 解析后返回', () => {
    expect(getEntryOrderNumber_ACU({ order: '100' })).toBe(100);
  });

  it('0 也是有效值', () => {
    expect(getEntryOrderNumber_ACU({ order: 0 })).toBe(0);
  });

  it('负数也是有效值', () => {
    expect(getEntryOrderNumber_ACU({ order: -5 })).toBe(-5);
  });

  it('NaN 返回 null', () => {
    expect(getEntryOrderNumber_ACU({ order: NaN })).toBeNull();
  });

  it('非数字字符串返回 null', () => {
    expect(getEntryOrderNumber_ACU({ order: 'abc' })).toBeNull();
  });

  it('undefined order 返回 null', () => {
    expect(getEntryOrderNumber_ACU({})).toBeNull();
  });

  it('null entry 返回 null', () => {
    expect(getEntryOrderNumber_ACU(null)).toBeNull();
  });

  it('Infinity 返回 null', () => {
    expect(getEntryOrderNumber_ACU({ order: Infinity })).toBeNull();
  });
});

// ═══ buildUsedOrderSet_ACU ═══
describe('buildUsedOrderSet_ACU', () => {
  it('从条目数组构建 order 集合', () => {
    const entries = [{ order: 1 }, { order: 5 }, { order: 10 }];
    const set = buildUsedOrderSet_ACU(entries);
    expect(set.size).toBe(3);
    expect(set.has(1)).toBe(true);
    expect(set.has(5)).toBe(true);
    expect(set.has(10)).toBe(true);
  });

  it('跳过无效 order', () => {
    const entries = [{ order: 1 }, { order: 'abc' }, { order: null }, { order: 5 }];
    const set = buildUsedOrderSet_ACU(entries);
    expect(set.size).toBe(2);
  });

  it('空数组返回空集合', () => {
    expect(buildUsedOrderSet_ACU([]).size).toBe(0);
  });

  it('非数组输入返回空集合', () => {
    expect(buildUsedOrderSet_ACU(null as any).size).toBe(0);
    expect(buildUsedOrderSet_ACU(undefined as any).size).toBe(0);
  });

  it('去重相同 order', () => {
    const entries = [{ order: 1 }, { order: 1 }, { order: 1 }];
    const set = buildUsedOrderSet_ACU(entries);
    expect(set.size).toBe(1);
  });
});

// ═══ allocOrder_ACU ═══
describe('allocOrder_ACU', () => {
  it('preferred 未被占用时直接返回', () => {
    const used = new Set<number>();
    const order = allocOrder_ACU(used, 100);
    expect(order).toBe(100);
    expect(used.has(100)).toBe(true);
  });

  it('preferred 被占用时寻找下一个可用', () => {
    const used = new Set([100, 101, 102]);
    const order = allocOrder_ACU(used, 100);
    expect(order).toBe(103);
  });

  it('向后搜索到 max 后回绕到 min', () => {
    const used = new Set([99998, 99999]);
    const order = allocOrder_ACU(used, 99998, 1, 99999);
    expect(order).toBe(1);
  });

  it('所有 order 被占用时抛出错误', () => {
    const used = new Set([1, 2, 3]);
    expect(() => allocOrder_ACU(used, 1, 1, 3)).toThrow('无法分配可用的世界书条目 order');
  });

  it('preferred 小于 min 时从 min 开始', () => {
    const used = new Set<number>();
    const order = allocOrder_ACU(used, -5, 10, 100);
    expect(order).toBe(10);
  });

  it('preferred 大于 max 时从 max 开始', () => {
    const used = new Set<number>();
    const order = allocOrder_ACU(used, 200, 1, 100);
    expect(order).toBe(100);
  });

  it('分配后将 order 加入 usedSet', () => {
    const used = new Set<number>();
    allocOrder_ACU(used, 50);
    expect(used.has(50)).toBe(true);
  });

  it('非 Set 输入被当作空 Set 处理', () => {
    const order = allocOrder_ACU(null as any, 1);
    expect(order).toBe(1);
  });

  it('无效 preferred 从 min 开始', () => {
    const used = new Set<number>();
    const order = allocOrder_ACU(used, NaN as any, 5, 100);
    expect(order).toBe(5);
  });
});

// ═══ allocConsecutiveOrderBlock_ACU ═══
describe('allocConsecutiveOrderBlock_ACU', () => {
  it('分配连续的 order 块', () => {
    const used = new Set<number>();
    const start = allocConsecutiveOrderBlock_ACU(used, 3, 10);
    expect(start).toBe(10);
    expect(used.has(10)).toBe(true);
    expect(used.has(11)).toBe(true);
    expect(used.has(12)).toBe(true);
  });

  it('preferred 位置有冲突时向后搜索', () => {
    const used = new Set([10, 11]);
    const start = allocConsecutiveOrderBlock_ACU(used, 3, 10);
    expect(start).toBe(12);
    expect(used.has(12)).toBe(true);
    expect(used.has(13)).toBe(true);
    expect(used.has(14)).toBe(true);
  });

  it('中间有间隔时跳过', () => {
    const used = new Set([11]); // 10 可用，但 10-12 中 11 被占
    const start = allocConsecutiveOrderBlock_ACU(used, 3, 10);
    expect(start).toBe(12); // 需要连续 3 个：12, 13, 14
  });

  it('向后搜索到末尾后回绕到 min', () => {
    const used = new Set([99998, 99999]);
    const start = allocConsecutiveOrderBlock_ACU(used, 2, 99998, 1, 99999);
    expect(start).toBe(1);
  });

  it('无法分配时抛出错误', () => {
    const used = new Set([1, 2, 3, 4, 5]);
    expect(() => allocConsecutiveOrderBlock_ACU(used, 3, 1, 1, 5)).toThrow('无法分配连续的世界书条目 order 区间');
  });

  it('blockSize 为 1 时等同于 allocOrder', () => {
    const used = new Set<number>();
    const start = allocConsecutiveOrderBlock_ACU(used, 1, 50);
    expect(start).toBe(50);
    expect(used.has(50)).toBe(true);
  });

  it('blockSize 为 0 或负数时按 1 处理', () => {
    const used = new Set<number>();
    const start = allocConsecutiveOrderBlock_ACU(used, 0, 50);
    expect(start).toBe(50);
  });

  it('非 Set 输入被当作空 Set 处理', () => {
    const start = allocConsecutiveOrderBlock_ACU(null as any, 2, 1);
    expect(start).toBe(1);
  });
});
