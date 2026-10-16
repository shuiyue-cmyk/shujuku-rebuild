import { describe, expect, it } from 'vitest';
import { claudeGreeting } from '../../src/presentation-v3/shell/claude-greeting';

describe('claudeGreeting', () => {
  it.each([
    [5, '早上好'], [10, '早上好'], [11, '中午好'], [12, '中午好'], [13, '下午好'], [17, '下午好'],
    [18, '晚上好'], [22, '晚上好'], [23, '夜深了'], [0, '夜深了'], [4, '夜深了'],
  ])('%i 点 → %s', (hour, expected) => {
    expect(claudeGreeting(hour)).toBe(expected);
  });

  it('非法时间退回中性问候', () => {
    expect(claudeGreeting(Number.NaN)).toBe('你好');
  });
});
