import { describe, expect, it } from 'vitest';
import {
  clearSummaryVectorIndexDirtyForRealign_ACU,
  getSummaryVectorIndexDirtyForRealign_ACU,
  isSummaryVectorIndexDirtyForRealign_ACU,
  markSummaryVectorIndexDirtyForRealign_ACU,
} from '../../../src/service/vector/summary-vector-index-realign-state';

describe('summary-vector-index realign dirty scope', () => {
  it('按完整 scope 隔离标记与清理，不会串扰其他 scope', () => {
    const scopeA = 'chat-a::iso-a::summary-a';
    const scopeB = 'chat-a::iso-b::summary-a';

    markSummaryVectorIndexDirtyForRealign_ACU(scopeA, 'chat_modified_deleted');
    markSummaryVectorIndexDirtyForRealign_ACU(scopeB, 'chat_modified_swiped');
    clearSummaryVectorIndexDirtyForRealign_ACU(scopeA);

    expect(isSummaryVectorIndexDirtyForRealign_ACU(scopeA)).toBe(false);
    expect(getSummaryVectorIndexDirtyForRealign_ACU(scopeA)).toBeNull();
    expect(getSummaryVectorIndexDirtyForRealign_ACU(scopeB)).toMatchObject({
      dirty: true,
      reason: 'chat_modified_swiped',
    });

    clearSummaryVectorIndexDirtyForRealign_ACU(scopeB);
  });

  it('拒绝缺失 scope 的 dirty 标记', () => {
    expect(() => markSummaryVectorIndexDirtyForRealign_ACU('', 'runtime_stale_rows'))
      .toThrow('缺少 scopeKey');
  });
});
