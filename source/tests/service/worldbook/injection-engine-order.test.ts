
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

  it('0 也是有效值', () => {
    expect(getEntryOrderNumber_ACU({ order: 0 })).toBe(0);
  });

  it('负数也是有效值', () => {
    expect(getEntryOrderNumber_ACU({ order: -5 })).toBe(-5);
  });
});

// ═══ buildUsedOrderSet_ACU ═══
describe('buildUsedOrderSet_ACU', () => {

  it('跳过无效 order', () => {
    const entries = [{ order: 1 }, { order: 'abc' }, { order: null }, { order: 5 }];
    const set = buildUsedOrderSet_ACU(entries);
    expect(set.size).toBe(2);
  });
});

// ═══ allocOrder_ACU ═══
describe('allocOrder_ACU', () => {

  it('preferred 被占用时寻找下一个可用', () => {
    const used = new Set([100, 101, 102]);
    const order = allocOrder_ACU(used, 100);
    expect(order).toBe(103);
  });

  it('所有 order 被占用时抛出错误', () => {
    const used = new Set([1, 2, 3]);
    expect(() => allocOrder_ACU(used, 1, 1, 3)).toThrow('无法分配可用的世界书条目 order');
  });
});

// ═══ allocConsecutiveOrderBlock_ACU ═══
describe('allocConsecutiveOrderBlock_ACU', () => {

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
});
