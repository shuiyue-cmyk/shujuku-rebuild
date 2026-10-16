/**
 * API 页「测试连接」：用当前填写的配置发一条最短请求，结果结构化返回、从不向界面抛错。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings } = vi.hoisted(() => ({
  mockSettings: { apiMode: 'custom', apiConfig: {}, streamingEnabled: false, apiPresets: [] as any[] } as any,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: mockSettings }));
vi.mock('../../../src/data/gateways/ai-gateway', () => ({ getHostRequestHeaders_ACU: vi.fn(() => ({ 'X-CSRF-Token': 't' })) }));
vi.mock('../../../src/service/ai/preset-rate-limiter', () => ({ acquirePresetRateLimitSlot_ACU: vi.fn(async () => {}) }));
vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn() };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { testApiConnection_ACU } from '../../../src/service/ai/api-call';

const config = (overrides: Record<string, unknown> = {}) => ({ url: 'https://api.example.com/v1', apiKey: 'sk-t', model: 'm', max_tokens: 60000, temperature: 1, customApiFormat: 'openai_compat', ...overrides }) as any;
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => mockFetch.mockReset());

describe('testApiConnection_ACU', () => {
  it('成功：返回模型回复与耗时；只发一条短消息并压低回复长度', async () => {
    mockFetch.mockResolvedValueOnce(ok('  连接成功  '));
    const result = await testApiConnection_ACU(config());
    expect(result.ok).toBe(true);
    expect(result.reply).toBe('连接成功');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.max_tokens).toBeLessThanOrEqual(1024);
  });

  it('按填写的发送方式走：数据库直接发送时直连端点', async () => {
    mockFetch.mockResolvedValueOnce(ok('hi'));
    await testApiConnection_ACU(config({ sendChannel: 'direct' }));
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('接通但没有正文：仍算接通，并说明可能原因', async () => {
    mockFetch.mockResolvedValueOnce(ok(''));
    const result = await testApiConnection_ACU(config());
    expect(result.ok).toBe(true);
    expect(result.reply).toBe('');
    expect(result.note).toContain('没有返回正文');
  });

  it('HTTP 失败：带状态码与上游原因返回，不抛错', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":{"message":"invalid key"}}', { status: 401 }));
    const result = await testApiConnection_ACU(config());
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain('invalid key');
  });

  it('网络失败（含直接发送被跨域拦截）：返回可读原因', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await testApiConnection_ACU(config({ sendChannel: 'direct' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('经酒馆转接发送');
  });

  it('没填端点或模型：不发请求，直接提示', async () => {
    const result = await testApiConnection_ACU(config({ model: '' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('模型');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('超时：到点中断并报超时', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      }));
      const pending = testApiConnection_ACU(config(), { timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.error).toContain('超时');
    } finally {
      vi.useRealTimers();
    }
  });
});
