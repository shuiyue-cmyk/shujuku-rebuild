/**
 * tests/data/gateways/vector-embedding-gateway.test.ts
 * T3：embedding 错误结构化分类验收
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmbeddings_ACU,
  isVectorEmbeddingError_ACU,
} from '../../../src/data/gateways/vector-embedding-gateway';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function errorBody(code: string | null, message: string): unknown {
  return code != null
    ? { error: { code, message } }
    : { error: { message } };
}

describe('createEmbeddings_ACU 错误结构化分类（T3）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('401 → credential，且 apiKey 不出现在错误消息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, errorBody('invalid_key', 'bad key'))));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-secret-abc123',
      model: 'test-model',
      input: ['hello'],
    })).rejects.toMatchObject({
      name: 'VectorEmbeddingError_ACU',
      kind: 'credential',
      httpStatus: 401,
      providerCode: 'invalid_key',
      endpoint: 'https://embedding.test/v1',
      model: 'test-model',
    });

    try {
      await createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-secret-abc123',
        model: 'test-model',
        input: ['hello'],
      });
      expect.unreachable('应抛出 VectorEmbeddingError_ACU');
    } catch (error) {
      expect(isVectorEmbeddingError_ACU(error)).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('sk-secret-abc123');
    }
  });

  it('403 code 30001 → credential（insufficient_balance），providerCode 保留供上层细分', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, errorBody('30001', 'insufficient balance'))));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({
      kind: 'credential',
      httpStatus: 403,
      providerCode: '30001',
      providerMessage: 'insufficient balance',
    });
  });

  it('403 普通 → credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, errorBody('forbidden', 'forbidden'))));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({ kind: 'credential', httpStatus: 403, providerCode: 'forbidden' });
  });

  it('400 / 404 / 422 → request（terminal）', async () => {
    for (const status of [400, 404, 422]) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, errorBody('bad_request', `err-${status}`))));

      await expect(createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      })).rejects.toMatchObject({ kind: 'request', httpStatus: status, providerCode: 'bad_request' });
    }
  });

  it('413 → limited-retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(413, errorBody(null, 'payload too large'))));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({ kind: 'limited-retryable', httpStatus: 413 });
  });

  it('408 / 429 → retryable，并解析 Retry-After 头', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, errorBody('rate_limit', 'slow down'), { 'Retry-After': '5' })));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({ kind: 'retryable', httpStatus: 429, retryAfterMs: 5000 });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(408, errorBody(null, 'timeout'))));
    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({ kind: 'retryable', httpStatus: 408 });
  });

  it('5xx → retryable', async () => {
    for (const status of [500, 502, 503]) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, errorBody(null, 'server error'))));

      await expect(createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      })).rejects.toMatchObject({ kind: 'retryable', httpStatus: status });
    }
  });

  it('网络异常（fetch reject）→ 仍是裸 Error，向后', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toThrow('Failed to fetch');
  });

  it('响应中无可用向量（空/非法维度）→ provider-contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: [{ index: 0, embedding: [] }] })));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({
      name: 'VectorEmbeddingError_ACU',
      kind: 'provider-contract',
      httpStatus: 200,
    });
  });
});
