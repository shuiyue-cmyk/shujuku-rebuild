/**
 * tests/service/ai/ai-service.test.ts
 * AI 调用服务 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetHostRequestHeaders,
  mockLogDebug,
} = vi.hoisted(() => ({
  mockGetHostRequestHeaders: vi.fn(() => ({ 'X-Custom': 'header' })),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  isGenerateRawAvailable_ACU: vi.fn(() => true),
  isConnectionManagerAvailable_ACU: vi.fn(() => false),
  isTriggerSlashAvailable_ACU: vi.fn(() => false),
  generateRaw_ACU: vi.fn(),
  sendConnectionManagerRequest_ACU: vi.fn(),
  triggerSlash_ACU: vi.fn(),
  getConnectionManagerProfiles_ACU: vi.fn(),
  getHostRequestHeaders_ACU: mockGetHostRequestHeaders,
}));

// log 打点 mock 防噪；assertSafeHttpEndpoint_ACU 保留真身——
// fetchAvailableModels_ACU 直接用传入 apiUrl 过 SSRF 守卫（V4-b：vi.fn() mock 曾让守卫永不生效）。
vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return {
    ...actual,
    logDebug_ACU: mockLogDebug,
  };
});

import { fetchAvailableModels_ACU } from '../../../src/service/ai/ai-service';

// 模拟 fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchAvailableModels_ACU', () => {
  it('apiUrl 为空时返回错误', async () => {
    const result = await fetchAvailableModels_ACU('', 'key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('请输入API基础URL');
  });

  it('SSRF 守卫真实生效：远程 http:// 端点被拒绝且不发起 fetch', async () => {
    const result = await fetchAvailableModels_ACU('http://api.test', 'key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('仅允许 localhost');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('SSRF 守卫真实生效：https 私网 IPv4 被拒绝且不发起 fetch', async () => {
    const result = await fetchAvailableModels_ACU('https://10.0.0.5/v1', 'key');
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('SSRF 守卫真实生效：协议相对 URL 被拒绝', async () => {
    const result = await fetchAvailableModels_ACU('//api.test/v1', 'key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('协议相对');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('正常返回模型列表（models 数组格式）', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }],
      }),
    });

    const result = await fetchAvailableModels_ACU('https://api.test', 'key123');
    expect(result.success).toBe(true);
    expect(result.models).toEqual(['gpt-4', 'gpt-3.5-turbo']);
  });

  it('探活 Go 端点时 custom_include_headers 带 x-opencode-session，非 Go 端点不带', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ id: 'm' }] }) });
    await fetchAvailableModels_ACU('https://opencode.ai/zen/go/v1/chat/completions', 'sk-go');
    const goBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(String(goBody.custom_include_headers)).toMatch(/^x-opencode-session: [0-9a-f-]{36}$/im);

    mockFetch.mockClear();
    await fetchAvailableModels_ACU('https://api.test', 'key123');
    const otherBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(String(otherBody.custom_include_headers)).not.toMatch(/x-opencode-session/i);
  });

  it('正常返回模型列表（data 数组格式）', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'claude-3' }, { id: 'claude-2' }],
      }),
    });

    const result = await fetchAvailableModels_ACU('https://api.test', '');
    expect(result.success).toBe(true);
    expect(result.models).toEqual(['claude-3', 'claude-2']);
  });

  it('正常返回模型列表（顶层数组格式）', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ['model-a', 'model-b'],
    });

    const result = await fetchAvailableModels_ACU('https://api.test', 'key');
    expect(result.success).toBe(true);
    expect(result.models).toEqual(['model-a', 'model-b']);
  });

  it('模型列表为空时返回错误', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });

    const result = await fetchAvailableModels_ACU('https://api.test', 'key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('列表为空');
  });

  it('无法解析模型数据时返回错误', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'format' }),
    });

    const result = await fetchAvailableModels_ACU('https://api.test', 'key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('未能解析');
  });

  it('HTTP 错误时返回错误信息（JSON 错误体）', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'Invalid API key' }),
    });

    const result = await fetchAvailableModels_ACU('https://api.test', 'bad_key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('Invalid API key');
  });

  it('401 文案指向查 Key、404 文案指向查地址模型', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'unauthorized' });
    const badKey = await fetchAvailableModels_ACU('https://api.test', 'bad_key');
    expect(badKey.error).toContain('401');
    expect(badKey.error).toMatch(/Key|密钥/i);

    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', text: async () => 'not found' });
    const badAddr = await fetchAvailableModels_ACU('https://api.test', 'key');
    expect(badAddr.error).toContain('404');
    expect(badAddr.error).toMatch(/地址|模型/i);
  });

  it('HTTP 错误时返回错误信息（纯文本错误体）', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server crashed',
    });

    const result = await fetchAvailableModels_ACU('https://api.test', 'key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('Server crashed');
  });

  it('请求时携带正确的 headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ id: 'test-model' }] }),
    });

    await fetchAvailableModels_ACU('https://api.test', 'my_key');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/backends/chat-completions/status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Custom': 'header',
          'Content-Type': 'application/json',
        }),
      }),
    );

    // 验证 body 中包含 apiUrl 和 apiKey
    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body);
    expect(body.custom_url).toBe('https://api.test');
    expect(body.custom_include_headers).toContain('my_key');
  });

  it('apiKey 为空时 custom_include_headers 为空字符串', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ id: 'test-model' }] }),
    });

    await fetchAvailableModels_ACU('https://api.test', '');

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body);
    expect(body.custom_include_headers).toBe('');
  });

  // ── custom_api_format 透传（status 探活按接口协议切模型列表来源） ──

  function lastStatusBody(): any {
    return JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
  }

  it('四值白名单逐个透传：body.custom_api_format 等于入参', async () => {
    for (const format of ['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions']) {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ id: 'm' }] }) });

      await fetchAvailableModels_ACU('https://api.test', 'key', format);

      expect(lastStatusBody().custom_api_format).toBe(format);
      // 探活仍走自定义源，且 base/密钥解析不受协议字段影响。
      expect(lastStatusBody().chat_completion_source).toBe('custom');
      expect(lastStatusBody().custom_url).toBe('https://api.test');
      expect(lastStatusBody().custom_include_headers).toContain('key');
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('非法 customApiFormat 降级为 ""（TT 后端对非法值 fail fast，必须客户端兜底）', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ id: 'm' }] }) });

    await fetchAvailableModels_ACU('https://api.test', 'key', 'openai-compa');

    expect(lastStatusBody().custom_api_format).toBe('');
  });

  it('缺省 / 空白 / 非字符串 customApiFormat 一律降级为 ""', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ id: 'm' }] }) });

    await fetchAvailableModels_ACU('https://api.test', 'key');
    expect(lastStatusBody().custom_api_format).toBe('');

    await fetchAvailableModels_ACU('https://api.test', 'key', '   ');
    expect(lastStatusBody().custom_api_format).toBe('');

    await fetchAvailableModels_ACU('https://api.test', 'key', undefined as any);
    expect(lastStatusBody().custom_api_format).toBe('');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('白名单值两侧空白被裁剪后仍按合法值透传', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ id: 'm' }] }) });

    await fetchAvailableModels_ACU('https://api.test', 'key', '  claude_messages  ');

    expect(lastStatusBody().custom_api_format).toBe('claude_messages');
  });

  it('normalizeStatusCustomApiFormat_ACU：白名单原样、其余降级 ""', async () => {
    const { normalizeStatusCustomApiFormat_ACU } = await import('../../../src/service/ai/ai-service');
    expect(normalizeStatusCustomApiFormat_ACU('gemini_interactions')).toBe('gemini_interactions');
    expect(normalizeStatusCustomApiFormat_ACU('CLAUDE_MESSAGES')).toBe('');
    expect(normalizeStatusCustomApiFormat_ACU(null)).toBe('');
    expect(normalizeStatusCustomApiFormat_ACU(undefined)).toBe('');
    expect(normalizeStatusCustomApiFormat_ACU({ toString: () => 'openai_responses' })).toBe('openai_responses');
  });

  it('过滤掉无效的模型 ID', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { id: 'valid-model' },
          { id: '' },
          { id: null },
          { noId: true },
          { id: 'another-valid' },
        ],
      }),
    });

    const result = await fetchAvailableModels_ACU('https://api.test', 'key');
    expect(result.success).toBe(true);
    expect(result.models).toEqual(['valid-model', 'another-valid']);
  });

  // ═══ 探活超时（v9.1.8）：15s AbortController，探活请求必须可退出，UI 不停留在"正在检查" ═══
  it('探活 15s 无响应时按超时收敛为结构化失败', async () => {
    vi.useFakeTimers();
    try {
      // 模拟遵循 signal 的 fetch：abort 触发时以 AbortError 拒绝
      mockFetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          (e as any).name = 'AbortError';
          reject(e);
        });
      }));

      const promise = fetchAvailableModels_ACU('https://api.test', 'key');
      // fetch 在内部 await import(SSRF 守卫) 之后才发起：先清微任务再断言
      await vi.advanceTimersByTimeAsync(0);
      // 请求携带 AbortSignal 且探活定时器已挂起
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('超时');
      expect(result.error).toContain('15');
      // 收敛后清掉探活定时器，不留悬挂句柄
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('探活成功路径清空定时器并透传 AbortSignal', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ id: 'm' }] }) });

      const promise = fetchAvailableModels_ACU('https://api.test', 'key');
      // fetch 在内部 await import(SSRF 守卫) 之后才发起：先清微任务再断言
      await vi.advanceTimersByTimeAsync(0);
      expect((mockFetch.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
      const result = await promise;
      expect(result.success).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
