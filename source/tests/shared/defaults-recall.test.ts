/**
 * spv9.2 召回默认值（真实 defaults 断言，不经过 settings-service 测试的 mock）。
 */
import { describe, expect, it } from 'vitest';
import {
  VECTOR_MEMORY_RECALL_PARAM_KEYS_ACU,
  VECTOR_MEMORY_RECALL_PARAMS_FORCE_OVERRIDE_VERSION_ACU,
  defaultVectorMemoryConfig_ACU,
} from '../../src/shared/defaults';

describe('spv9.2 recall defaults（真实默认值）', () => {
  it('一次性覆盖 marker 与 7 键常量', () => {
    expect(VECTOR_MEMORY_RECALL_PARAMS_FORCE_OVERRIDE_VERSION_ACU)
      .toBe('spv9.2-recall-params-force-override');
    expect([...VECTOR_MEMORY_RECALL_PARAM_KEYS_ACU]).toEqual([
      'summaryIndexKeywordMinRows',
      'topK',
      'minScore',
      'recallCandidateLimit',
      'bm25CandidateLimit',
      'recentFixedInjectCount',
      'rerankBatchSize',
    ]);
  });

  it('7 键新默认值与产品侧 spv9.2 一致', () => {
    const config = defaultVectorMemoryConfig_ACU as any;
    expect(config.summaryIndexKeywordMinRows).toBe(200);
    expect(config.topK).toBe(200);
    expect(config.minScore).toBe(0.35);
    expect(config.recallCandidateLimit).toBe(1000);
    expect(config.bm25CandidateLimit).toBe(1000);
    expect(config.recentFixedInjectCount).toBe(50);
    expect(config.rerankBatchSize).toBe(300);
  });
});
