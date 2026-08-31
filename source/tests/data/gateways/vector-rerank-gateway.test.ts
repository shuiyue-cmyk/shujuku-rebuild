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

describe('跨源（CORS）失败归类', () => {
    it('提供商未放行跨源（TypeError: Failed to fetch）→ 归类为 CORS 并给出可行动提示', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

        const message = await createRerankScores_ACU({
            endpoint: 'https://rerank.test/v1/rerank',
            model: 'rerank-m',
            query: '查询',
            documents: ['doc-a'],
        }).then(() => '', (error) => String(error?.message));

        expect(message).toContain('API 提供商未允许跨源访问（CORS）');
        expect(message).toContain('Access-Control-Allow-Origin');
        expect(message).toContain('中转地址');
        // 原始错误保留：真断网与跨源被拒同形，排查时不能丢。
        expect(message).toContain('Failed to fetch');
    });

    it('非跨源形态的网络失败不贴 CORS 标签', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));

        const message = await createRerankScores_ACU({
            endpoint: 'https://rerank.test/v1/rerank',
            model: 'rerank-m',
            query: '查询',
            documents: ['doc-a'],
        }).then(() => '', (error) => String(error?.message));

        expect(message).toBe('Rerank 请求网络失败：socket hang up');
        expect(message).not.toContain('CORS');
    });

    it('超时（AbortError）不被误归类为跨源失败', async () => {
        vi.useFakeTimers();
        try {
            vi.stubGlobal('fetch', vi.fn((_url: unknown, init: any) => new Promise<Response>((_resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
                });
            })));
            const promise = createRerankScores_ACU({
                endpoint: 'https://rerank.test/v1/rerank',
                model: 'rerank-m',
                query: '查询',
                documents: ['doc-a'],
            });
            const messagePromise = promise.then(() => '', (error) => String(error?.message));
            await vi.runAllTimersAsync();
            const message = await messagePromise;
            expect(message).toContain('超时');
            expect(message).not.toContain('CORS');
        } finally {
            vi.useRealTimers();
        }
    });
});
