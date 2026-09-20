/**
 * tests/data/gateways/vector-rerank-gateway.test.ts
 * V1-f：Rerank 条数守卫。provider 按 top_n 截断（返回条数 < documents.length）
 * 或索引重复未全覆盖时，网关必须显式抛错，让调用方（runtime rerankCandidates_ACU）
 * 整批回退 embedding 排序，杜绝 rerankScore 与 embedding score 混排。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRerankScores_ACU,
  normalizeRerankBatchSize_ACU,
  splitRerankDocumentsIntoBatches_ACU,
  VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU,
  VECTOR_RERANK_MAX_BATCH_SIZE_ACU,
  VECTOR_RERANK_MIN_BATCH_SIZE_ACU,
} from '../../../src/data/gateways/vector-rerank-gateway';

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

        expect(message).toBe('Rerank 请求网络失败（第 1/1 批，1 条）：socket hang up');
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

describe('normalizeRerankBatchSize_ACU', () => {
  it('缺省 / 非法值回落到默认值，越界值夹到 [min, max]', () => {
    expect(normalizeRerankBatchSize_ACU(undefined)).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU('abc')).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(0)).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(-5)).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(1)).toBe(VECTOR_RERANK_MIN_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(99999)).toBe(VECTOR_RERANK_MAX_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(250.7)).toBe(250);
  });
});

describe('splitRerankDocumentsIntoBatches_ACU', () => {
  it('按批大小切分并记录每批偏移', () => {
    const docs = Array.from({ length: 25 }, (_, i) => `d${i}`);
    const batches = splitRerankDocumentsIntoBatches_ACU(docs, 10);
    expect(batches.map(b => b.offset)).toEqual([0, 10, 20]);
    expect(batches.map(b => b.documents.length)).toEqual([10, 10, 5]);
    expect(batches[2].documents).toEqual(['d20', 'd21', 'd22', 'd23', 'd24']);
  });

  it('文档数不超过批大小时只有一批', () => {
    const batches = splitRerankDocumentsIntoBatches_ACU(['a', 'b'], 300);
    expect(batches).toEqual([{ offset: 0, documents: ['a', 'b'] }]);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function documentsOf(call: any): string[] {
  return JSON.parse(String(call[1].body)).documents;
}

describe('createRerankScores_ACU 分批', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('文档数不超过批大小时只发一次请求，index 原样返回', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await createRerankScores_ACU({
      endpoint: 'https://rerank.test/v1/rerank/',
      model: 'm',
      query: 'q',
      documents: ['a', 'b'],
      batchSize: 300,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as any)[0]).toBe('https://rerank.test/v1/rerank');
    expect(results).toEqual([{ index: 1, relevanceScore: 0.9 }, { index: 0, relevanceScore: 0.2 }]);
  });

  it('超过批大小时分批并行发送，批内 index 按偏移还原为全局 index', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const documents = JSON.parse(String(init.body)).documents as string[];
      return jsonResponse(200, { results: documents.map((doc, index) => ({ index, relevance_score: Number(doc.slice(1)) / 100 })) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const documents = Array.from({ length: 25 }, (_, i) => `d${i}`);

    const results = await createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents, batchSize: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(documentsOf).map(d => d.length)).toEqual([10, 10, 5]);
    expect(results).toHaveLength(25);
    const byIndex = new Map(results.map(r => [r.index, r.relevanceScore]));
    expect(byIndex.get(0)).toBeCloseTo(0);
    expect(byIndex.get(10)).toBeCloseTo(0.1);
    expect(byIndex.get(24)).toBeCloseTo(0.24);
    // 每批请求都带同一个 query 与 model。
    fetchMock.mock.calls.forEach((call: any) => {
      const body = JSON.parse(String(call[1].body));
      expect(body.query).toBe('q');
      expect(body.model).toBe('m');
    });
  });

  it('批内返回越界 index 被丢弃后触发 V1-f 条数守卫（整体抛错，不混排）', async () => {
    // TT 适配：上游该用例期望返回 2 条部分结果；本库 V1-f 覆盖度守卫要求整批回退，
    // 合并后 2/20 条即抛「条数不完整」，由调用方回退 embedding 排序。
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const documents = JSON.parse(String(init.body)).documents as string[];
      return jsonResponse(200, { results: [{ index: 0, relevance_score: 0.5 }, { index: documents.length + 3, relevance_score: 0.99 }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: Array.from({ length: 20 }, (_, i) => `d${i}`), batchSize: 10 }))
      .rejects.toThrow('Rerank 返回条数不完整');
  });

  it('任一批失败整体抛错，错误里带批次标签', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      const documents = JSON.parse(String(init.body)).documents as string[];
      if (calls === 2) return new Response(JSON.stringify({ error: { message: '单次请求提交的条目数量超过限制' } }), { status: 503 });
      return jsonResponse(200, { results: documents.map((_d, index) => ({ index, relevance_score: 0.5 })) });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: Array.from({ length: 20 }, (_, i) => `d${i}`), batchSize: 10 }))
      .rejects.toThrow(/第 2\/2 批.*503/);
  });

  it('单条 document 超长会被截断到上限，请求头只带 Content-Type 与 Authorization', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { results: [{ index: 0, relevance_score: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);

    await createRerankScores_ACU({ endpoint: 'https://rerank.test', apiKey: 'sk-1', model: 'm', query: 'q', documents: ['x'.repeat(5000)] });

    const call = fetchMock.mock.calls[0] as any;
    expect(documentsOf(call)[0].length).toBe(2000);
    expect(call[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-1' });
  });

  it('空 query 或空 documents 不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: '', documents: ['a'] })).toEqual([]);
    expect(await createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: ['', '  '] })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('响应头到达后响应体停滞 → 看门狗仍中断（覆盖 body 读取）', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: unknown, init: any) => Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        text: () => new Promise<string>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
          });
        }),
      } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);
      const promise = createRerankScores_ACU({
        endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: ['a'],
      });
      const assertion = expect(promise).rejects.toThrow('请求超时');
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
