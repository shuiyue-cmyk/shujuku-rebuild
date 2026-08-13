import { describe, expect, it } from 'vitest';
import {
  clearBm25CorpusCache_ACU,
  reciprocalRankFusion_ACU,
  sparseSearchBm25_ACU,
  tokenizeBm25Text_ACU,
  type SummaryHybridCandidate_ACU,
} from '../../../src/service/vector/summary-vector-hybrid-retrieval';

function candidate_ACU(id: string, text: string): SummaryHybridCandidate_ACU {
  const row = {
    rowKey: `row-${id}`,
    rowOrder: Number(id.replace(/\D/g, '')) || 0,
    timeSpan: '',
    location: '',
    summary: text,
    indexCode: id,
    status: 'active',
  } as any;
  return {
    row,
    chunk: {
      chunkId: `chunk-${id}`,
      rowKey: row.rowKey,
      sequence: 0,
      text,
      textHash: `hash-${id}`,
      vector: [1, 0],
    } as any,
    score: 0,
  };
}

describe('summary-vector-hybrid-retrieval', () => {
  it('BM25 命中英文关键词并按分数返回', () => {
    const results = sparseSearchBm25_ACU('dragon relic', [
      candidate_ACU('1', 'dragon relic hidden under the old bridge'),
      candidate_ACU('2', 'garden tea party and harmless gossip'),
    ], 5);

    expect(results).toHaveLength(1);
    expect(results[0].chunk.chunkId).toBe('chunk-1');
    expect(results[0].bm25Score).toBeGreaterThan(0);
  });

  it('BM25 支持中文 CJK unigram 与 bigram token 命中', () => {
    const tokens = tokenizeBm25Text_ACU('秘密基地');
    const results = sparseSearchBm25_ACU('秘密基地', [
      candidate_ACU('1', '众人在秘密基地交换情报'),
      candidate_ACU('2', '港口发生普通巡逻'),
    ], 5);

    expect(tokens).toContain('秘');
    expect(tokens).toContain('秘密');
    expect(results).toHaveLength(1);
    expect(results[0].chunk.chunkId).toBe('chunk-1');
  });

  it('BM25 保留文档词频，重复关键词文档分数更高', () => {
    const results = sparseSearchBm25_ACU('dragon', [
      candidate_ACU('1', 'dragon appears once'),
      candidate_ACU('2', 'dragon dragon dragon repeated signal'),
    ], 5);

    expect(results).toHaveLength(2);
    expect(results[0].chunk.chunkId).toBe('chunk-2');
    expect(results[0].bm25Score).toBeGreaterThan(results[1].bm25Score || 0);
  });

  it('BM25 按 limit 截断稀疏候选', () => {
    const results = sparseSearchBm25_ACU('relic', [
      candidate_ACU('1', 'relic alpha'),
      candidate_ACU('2', 'relic beta'),
      candidate_ACU('3', 'relic gamma'),
    ], 2);

    expect(results).toHaveLength(2);
    expect(results.every((item) => (item.bm25Score || 0) > 0)).toBe(true);
  });

  it('BM25 无稀疏命中时返回空数组', () => {
    const results = sparseSearchBm25_ACU('quantum laboratory', [
      candidate_ACU('1', 'forest campfire cooking'),
      candidate_ACU('2', 'market flower delivery'),
    ], 5);

    expect(results).toEqual([]);
  });

  it('RRF 中双路命中的第二名高于单路第一名', () => {
    const shared = candidate_ACU('shared', 'shared evidence');
    const denseOnly = candidate_ACU('dense', 'dense only');
    const sparseOnly = candidate_ACU('sparse', 'sparse only');

    const results = reciprocalRankFusion_ACU([
      [{ ...denseOnly, denseScore: 0.99 }, { ...shared, denseScore: 0.8 }],
      [{ ...shared, bm25Score: 2 }, { ...sparseOnly, bm25Score: 1 }],
    ], 60, 10);

    expect(results[0].chunk.chunkId).toBe('chunk-shared');
    expect(results[0].rrfScore).toBeGreaterThan(results.find((item) => item.chunk.chunkId === 'chunk-dense')?.rrfScore || 0);
  });

  it('RRF 对同一 chunk 去重并累加 RRF 分', () => {
    const same = candidate_ACU('1', 'same chunk');
    const results = reciprocalRankFusion_ACU([
      [{ ...same, denseScore: 0.9 }],
      [{ ...same, bm25Score: 1.2 }],
    ], 60, 10);

    expect(results).toHaveLength(1);
    expect(results[0].denseScore).toBe(0.9);
    expect(results[0].bm25Score).toBe(1.2);
    expect(results[0].rrfScore).toBeCloseTo(2 / 61, 8);
  });

  it('RRF 归一化非法参数并稳定截断输出', () => {
    const first = candidate_ACU('1', 'first');
    const second = candidate_ACU('2', 'second');
    const results = reciprocalRankFusion_ACU([[first, second]], 0, 1);

    expect(results).toHaveLength(1);
    expect(results[0].chunk.chunkId).toBe('chunk-1');
    expect(results[0].rrfScore).toBeCloseTo(1 / 61, 8);
  });

  it('RRF 在 sparse 先出现、dense 后出现时仍保留双路分数字段', () => {
    const same = candidate_ACU('1', 'same chunk');
    const results = reciprocalRankFusion_ACU([[{ ...same, bm25Score: 1.1 }], [{ ...same, denseScore: 0.7 }]], 60, 10);

    expect(results).toHaveLength(1);
    expect(results[0].bm25Score).toBe(1.1);
    expect(results[0].denseScore).toBe(0.7);
  });

  it('T10：相同 cacheKey 复用缓存语料，结果与重建一致', () => {
    clearBm25CorpusCache_ACU();
    const candidates = [candidate_ACU('1', 'dragon relic hidden'), candidate_ACU('2', 'garden tea party')];
    const first = sparseSearchBm25_ACU('dragon relic', candidates, 5, 'idx::wg1::c1|c2');
    const second = sparseSearchBm25_ACU('dragon relic', candidates, 5, 'idx::wg1::c1|c2');

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('T10：候选集变化（cacheKey 变化）时使用新语料，不误用旧缓存', () => {
    clearBm25CorpusCache_ACU();
    const first = sparseSearchBm25_ACU('dragon', [candidate_ACU('1', 'dragon appears once')], 5, 'idx::wg1::c1');
    const second = sparseSearchBm25_ACU('dragon', [candidate_ACU('2', 'dragon dragon dragon')], 5, 'idx::wg1::c2');

    // 两次命中不同候选：语料未串用。
    expect(first).toHaveLength(1);
    expect(first[0].chunk.chunkId).toBe('chunk-1');
    expect(second).toHaveLength(1);
    expect(second[0].chunk.chunkId).toBe('chunk-2');
    expect(second[0].bm25Score || 0).toBeGreaterThan(first[0].bm25Score || 0);
  });

  it('T10：clearBm25CorpusCache_ACU 清空缓存后强制重建', () => {
    clearBm25CorpusCache_ACU();
    const candidates = [candidate_ACU('1', 'dragon relic hidden')];
    sparseSearchBm25_ACU('dragon', candidates, 5, 'idx::wg1::c1');
    clearBm25CorpusCache_ACU();

    // 清空后再次调用（同 key）仍返回正确结果，说明缓存被重建而非残留。
    const after = sparseSearchBm25_ACU('dragon', candidates, 5, 'idx::wg1::c1');
    expect(after).toHaveLength(1);
    expect(after[0].chunk.chunkId).toBe('chunk-1');
  });
});
