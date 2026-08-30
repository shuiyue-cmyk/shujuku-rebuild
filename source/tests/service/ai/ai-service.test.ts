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
});
