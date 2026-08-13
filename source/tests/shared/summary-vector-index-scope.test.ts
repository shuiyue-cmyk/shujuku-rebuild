import { describe, expect, it } from 'vitest';
import {
  normalizeSummaryVectorIndexScope_ACU,
  normalizeSummaryVectorIsolationKey_ACU,
  serializeSummaryVectorIndexScope_ACU,
} from '../../src/shared/summary-vector-index-scope';

describe('summary vector index canonical scope', () => {
  it.each([undefined, null, '', '   ', '\t\n'])('将默认隔离域输入规范为 default: %j', (value) => {
    expect(normalizeSummaryVectorIsolationKey_ACU(value)).toBe('default');
  });

  it('清理非空 identity 的首尾空白，但保持大小写敏感', () => {
    expect(normalizeSummaryVectorIsolationKey_ACU('  Profile-A  ')).toBe('Profile-A');
    expect(normalizeSummaryVectorIsolationKey_ACU('Default')).toBe('Default');
    expect(normalizeSummaryVectorIsolationKey_ACU('Default')).not.toBe('default');
  });

  it('scope tuple 对空值使用稳定 fallback 且没有分隔符歧义', () => {
    expect(normalizeSummaryVectorIndexScope_ACU({ chatKey: ' ', isolationKey: '', sourceTableKey: '' }))
      .toEqual({ chatKey: 'current-chat', isolationKey: 'default', sourceTableKey: 'summary' });
    expect(serializeSummaryVectorIndexScope_ACU({ chatKey: 'a::b', isolationKey: 'c', sourceTableKey: 'd' }))
      .not.toBe(serializeSummaryVectorIndexScope_ACU({ chatKey: 'a', isolationKey: 'b::c', sourceTableKey: 'd' }));
  });
});
