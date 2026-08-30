/**
 * tests/data/gateways/vector-rerank-gateway.test.ts
 * V1-f：Rerank 条数守卫。provider 按 top_n 截断（返回条数 < documents.length）
 * 或索引重复未全覆盖时，网关必须显式抛错，让调用方（runtime rerankCandidates_ACU）
 * 整批回退 embedding 排序，杜绝 rerankScore 与 embedding score 混排。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRerankScores_ACU } from '../../../src/data/gateways/vector-rerank-gateway';

function rerankResponse(results: unknown[]): Response {
    return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => vi.unstubAllGlobals());

describe('V1-f Rerank 返回条数守卫', () => {
    it('provider top_n 截断（2/3 条）→ 抛「Rerank 返回条数不完整」', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => rerankResponse([
            { index: 0, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.7 },
        ])));
        await expect(createRerankScores_ACU({
            endpoint: 'https://rerank.test/v1/rerank',
            model: 'rerank-m',
            query: '查询',
            documents: ['doc-a', 'doc-b', 'doc-c'],
        })).rejects.toThrow('Rerank 返回条数不完整');
    });

    it('条数一致且索引全覆盖 → 正常返回，不误伤', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => rerankResponse([
            { index: 1, relevance_score: 0.7 },
            { index: 0, relevance_score: 0.9 },
        ])));
        const results = await createRerankScores_ACU({
            endpoint: 'https://rerank.test/v1/rerank',
            model: 'rerank-m',
            query: '查询',
            documents: ['doc-a', 'doc-b'],
        });
        expect(results).toHaveLength(2);
        expect(results.map((item) => item.index).sort()).toEqual([0, 1]);
    });

    it('条数一致但索引重复未覆盖全部文档 → 同样抛错（防混排）', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => rerankResponse([
            { index: 0, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.8 },
        ])));
        await expect(createRerankScores_ACU({
            endpoint: 'https://rerank.test/v1/rerank',
            model: 'rerank-m',
            query: '查询',
            documents: ['doc-a', 'doc-b'],
        })).rejects.toThrow('Rerank 返回条数不完整');
    });
});
