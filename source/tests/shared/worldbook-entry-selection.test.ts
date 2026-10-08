import { describe, expect, it } from 'vitest';
import { isEntryExplicitlySelected_ACU } from '../../src/shared/worldbook-entry-selection';

describe('R7-03：条目是否被用户显式勾选', () => {
  it('只有该书勾选列表里含此 uid 才算显式勾选（数字与字符串 uid 互认）', () => {
    expect(isEntryExplicitlySelected_ACU({ 书A: [1, '2'] }, '书A', '1')).toBe(true);
    expect(isEntryExplicitlySelected_ACU({ 书A: [1, '2'] }, '书A', 2)).toBe(true);
    expect(isEntryExplicitlySelected_ACU({ 书A: [1] }, '书A', 3)).toBe(false);
    expect(isEntryExplicitlySelected_ACU({}, '书A', 1)).toBe(false);
    expect(isEntryExplicitlySelected_ACU(undefined, '书A', 1)).toBe(false);
    expect(isEntryExplicitlySelected_ACU({ 书A: 'x' }, '书A', 1)).toBe(false);
  });
});
