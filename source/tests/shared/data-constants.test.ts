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
