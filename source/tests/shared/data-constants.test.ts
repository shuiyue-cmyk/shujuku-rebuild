import { describe, expect, it } from 'vitest';


describe('R7-05：隔离标识保留名', () => {
  it('default 不分大小写、去空白后都是保留名；空串与普通标识不是', async () => {
    const { isReservedIsolationCode_ACU } = await import('../../src/shared/data-constants');
    expect(isReservedIsolationCode_ACU('default')).toBe(true);
    expect(isReservedIsolationCode_ACU(' DEFAULT ')).toBe(true);
    expect(isReservedIsolationCode_ACU('')).toBe(false);
    expect(isReservedIsolationCode_ACU('defaults')).toBe(false);
  });
});

describe('G11-02：隔离标识保留名同时挡住存储哨兵 __default__', () => {
  it('字面 __default__（槽键产物等于哨兵）是保留名；普通含下划线标识不是', async () => {
    const {
      isReservedIsolationCode_ACU,
      getIsolationSlot_ACU,
      DEFAULT_ISOLATION_SLOT_ACU,
    } = await import('../../src/shared/data-constants');
    // 半相撞的根源：字面 __default__ 的槽键产物直接等于默认槽哨兵，
    // 会和空标识（默认槽）共用同一份设置/模板存储。
    expect(getIsolationSlot_ACU('__default__')).toBe(DEFAULT_ISOLATION_SLOT_ACU);
    expect(isReservedIsolationCode_ACU('__default__')).toBe(true);
    expect(isReservedIsolationCode_ACU('  __default__  ')).toBe(true); // trim 后仍命中
    // 不误伤：空串本身是默认槽入口、普通含下划线标识与 __default__ 的近似形态都放行。
    expect(isReservedIsolationCode_ACU('')).toBe(false);
    expect(isReservedIsolationCode_ACU('__defaults__')).toBe(false);
    expect(isReservedIsolationCode_ACU('_default_')).toBe(false);
    expect(isReservedIsolationCode_ACU('my_slot')).toBe(false);
  });
});
