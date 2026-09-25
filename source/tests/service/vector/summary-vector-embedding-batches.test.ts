import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockLogWarn } = vi.hoisted(() => ({ mockLogWarn: vi.fn() }));
vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return { ...actual, logWarn_ACU: mockLogWarn };
});
import {
  EmbeddingBatchExecutionError_ACU,
  executeEmbeddingBatchPlan_ACU,
  planEmbeddingBatches_ACU,
} from '../../../src/service/vector/summary-vector-embedding-batches';

describe('summary-vector-embedding-batches', () => {
  beforeEach(() => { mockLogWarn.mockClear(); });
  afterEach(() => { mockLogWarn.mockClear(); });

  it('keeps rows intact and applies row/character limits with an explicit over-budget row', () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'aa' }, { rowKey: 'a', text: 'bb' },
      { rowKey: 'b', text: 'ccc' }, { rowKey: 'c', text: '123456' },
    ], { maxRowsPerRequest: 2, maxInputCharsPerRequest: 5 });

    expect(plan.batches.map(batch => batch.sources.map(item => item.source.text))).toEqual([
      ['aa', 'bb'], ['ccc'], ['123456'],
    ]);
    expect(plan.batches.map(batch => batch.singleRowOverBudget)).toEqual([false, false, true]);
  });

  it('bounds concurrent requests and returns vectors in source order', async () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'a' }, { rowKey: 'b', text: 'b' }, { rowKey: 'c', text: 'c' },
    ], { maxRowsPerRequest: 1, maxInputCharsPerRequest: 10 });
    let active = 0;
    let peak = 0;
    const result = await executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 2,
      requestEmbeddings: async input => {
        active += 1; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, input[0] === 'a' ? 8 : 1));
        active -= 1;
        return [{ index: 0, embedding: [input[0].charCodeAt(0)] }];
      },
    });

    expect(peak).toBe(2);
    expect(result.embeddings).toEqual([[97], [98], [99]]);
    expect(result.stats).toMatchObject({ plannedBatchCount: 3, completedBatchCount: 3, successfulBatchCount: 3 });
  });

  it('跨批返回不同维度时整批拒绝，不返回可混合落盘的 vectors', async () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'a' },
      { rowKey: 'b', text: 'b' },
    ], { maxRowsPerRequest: 1, maxInputCharsPerRequest: 10 });

    await expect(executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 2,
      requestEmbeddings: async input => [{
        index: 0,
        embedding: input[0] === 'a' ? [1, 0] : [1, 0, 0],
      }],
    })).rejects.toThrow(/维度不一致.*2.*3/);
  });

  it('recovers only missing sources inside the failed-response batch', async () => {
    const plan = planEmbeddingBatches_ACU([{ rowKey: 'a', text: 'a' }, { rowKey: 'b', text: 'b' }], { maxRowsPerRequest: 2, maxInputCharsPerRequest: 10 });
    const requests: string[][] = [];
    const result = await executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 1,
      requestEmbeddings: async input => {
        requests.push(input);
        return requests.length === 1 ? [{ index: 0, embedding: [1] }] : [{ index: 0, embedding: [2] }];
      },
    });
    expect(requests).toEqual([['a', 'b'], ['b']]);
    expect(result.embeddings).toEqual([[1], [2]]);
  });

  it('stops new dispatch after a failure and settles already-started work', async () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'a' }, { rowKey: 'b', text: 'b' }, { rowKey: 'c', text: 'c' },
    ], { maxRowsPerRequest: 1, maxInputCharsPerRequest: 10 });
    const started: string[] = [];
    await expect(executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 2,
      requestEmbeddings: async input => {
        started.push(input[0]);
        if (input[0] === 'a') throw new Error('first failure');
        await new Promise(resolve => setTimeout(resolve, 5));
        return [{ index: 0, embedding: [1] }];
      },
    })).rejects.toBeInstanceOf(EmbeddingBatchExecutionError_ACU);
    expect(started).toEqual(['a', 'b']);
  });

  it('单行超预算时记录一次诊断，正常批次不记录', async () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'aa' }, { rowKey: 'over', text: '123456' },
    ], { maxRowsPerRequest: 5, maxInputCharsPerRequest: 3 });
    expect(plan.batches.filter(batch => batch.singleRowOverBudget).map(batch => batch.sources[0].source.rowKey)).toEqual(['over']);

    const result = await executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 1,
      requestEmbeddings: async input => [{ index: 0, embedding: [input[0].length] }],
    });

    expect(result.stats.overBudgetBatchCount).toBe(1);
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    const text = String(mockLogWarn.mock.calls[0][0]);
    expect(text).toContain('1 个 embedding 批次单行即超出字符预算');
    expect(text).toContain('over');
  });

  it('无超预算批次时不记录诊断', async () => {
    const plan = planEmbeddingBatches_ACU([{ rowKey: 'a', text: 'aa' }], { maxRowsPerRequest: 5, maxInputCharsPerRequest: 100 });
    const result = await executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 1,
      requestEmbeddings: async input => [{ index: 0, embedding: [input[0].length] }],
    });

    expect(result.stats.overBudgetBatchCount).toBe(0);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});
