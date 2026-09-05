/**
 * tests/service/ai/api-call.test.ts
 * AI 调用编排 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse } from 'yaml';
import { setDebugLogEnabled } from '../../../src/shared/log-buffer';

const { mockSettings, mockIsGenerateRawAvailable, mockGenerateRaw, mockSendConnectionManager, mockGetHeaders, mockHandleApiResponse, mockRateLimitSlot } = vi.hoisted(() => ({
  mockSettings: {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 },
    tavernProfile: 'default',
    plotApiPreset: '',
    streamingEnabled: false,
    apiPresets: [] as any[],
  } as any,
  mockIsGenerateRawAvailable: vi.fn(() => true),
  mockGenerateRaw: vi.fn(),
  mockSendConnectionManager: vi.fn(),
  mockGetHeaders: vi.fn(() => ({ 'X-Custom': 'test' })),
  mockHandleApiResponse: vi.fn(),
  mockRateLimitSlot: vi.fn(async () => {}),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  handleApiResponse_ACU: mockHandleApiResponse,
  extractAiUsageMetadata_ACU: vi.fn(() => null),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  isGenerateRawAvailable_ACU: mockIsGenerateRawAvailable,
  generateRaw_ACU: mockGenerateRaw,
  sendConnectionManagerRequest_ACU: mockSendConnectionManager,
  getHostRequestHeaders_ACU: mockGetHeaders,
}));

vi.mock('../../../src/service/ai/preset-rate-limiter', () => ({
  acquirePresetRateLimitSlot_ACU: mockRateLimitSlot,
}));

// log 打点 mock 掉防噪；assertSafeHttpEndpoint_ACU 保留真身——
// 调用编排必须真实通过 SSRF 守卫（V4-b：此前 vi.fn() mock 让守卫在测试里永不生效）。
vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
  };
});

// mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  callApiWithPlotPreset_ACU,
  getApiConfigByPreset_ACU,
  callAIWithPreset_ACU,
  callAIWithResolvedPreset_ACU,
  callCustomOpenAI_ACU_Direct,
  buildCustomApiRequestBody_ACU,
  postChatCompletion_ACU,
  AgentApiHttpError_ACU,
  isRetryableAiRequestError_ACU,
  JSON_OBJECT_RESPONSE_FORMAT_ACU,
} from '../../../src/service/ai/api-call';

import {
  normalizePreset_ACU,
  resolveApiConfigByPreset_ACU,
} from '../../../src/service/settings/api-preset-service';
import { resolveContinuationApiPreset_ACU } from '../../../src/service/continuation/api-preset';
import { callContinuationInternalAi_ACU } from '../../../src/service/continuation/internal-ai-call';
import {
  apiPresetDraftFromPreset,
  apiPresetFromDraft,
  createEmptyApiPresetDraft,
} from '../../../src/presentation-v2/composables/useApiPresetManagement';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.apiMode = 'custom';
  mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 };
  mockSettings.tavernProfile = 'default';
  mockSettings.plotApiPreset = '';
  mockSettings.streamingEnabled = false;
  mockSettings.apiPresets = [];
});

// ═══ getApiConfigByPreset_ACU ═══
describe('getApiConfigByPreset_ACU', () => {
  it('空预设名返回当前配置', () => {
    const config = getApiConfigByPreset_ACU('');
    expect(config.apiMode).toBe('custom');
    expect(config.apiConfig).toBe(mockSettings.apiConfig);
  });

  it('找到预设时返回预设配置', () => {
    mockSettings.apiPresets = [
      { name: '预设A', apiMode: 'custom', apiConfig: { url: 'http://a.com' } },
    ];
    const config = getApiConfigByPreset_ACU('预设A');
    expect(config.apiMode).toBe('custom');
    expect(config.apiConfig.url).toBe('http://a.com');
  });

  it('预设不存在时回退到当前配置', () => {
    mockSettings.apiPresets = [];
    const config = getApiConfigByPreset_ACU('不存在');
    expect(config.apiMode).toBe('custom');
  });
});

// ═══ callApi_ACU ═══
// ═══ callAIWithPreset_ACU ═══
describe('callAIWithPreset_ACU', () => {
  it('空消息数组返回 null', async () => {
    const result = await callAIWithPreset_ACU([]);
    expect(result).toBeNull();
  });

  it('非数组返回 null', async () => {
    const result = await callAIWithPreset_ACU(null as any);
    expect(result).toBeNull();
  });

  it('自定义 API 模式使用 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('custom API non-success response preserves HTTP status for retry owners', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve('rate limited') });

    const error = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]).catch(e => e);

    expect(error).toBeInstanceOf(AgentApiHttpError_ACU);
    expect(error).toMatchObject({ name: 'AgentApiHttpError_ACU', status: 429 });
    expect(error.message).toBe('API请求失败: 429 rate limited');
    expect(isRetryableAiRequestError_ACU(new AgentApiHttpError_ACU(429, 'rate limited'))).toBe(true);
    expect(isRetryableAiRequestError_ACU(new AgentApiHttpError_ACU(401, 'unauthorized'))).toBe(false);
  });

  it('postChatCompletion_ACU 是唯一的 HTTP 状态携带点，5xx 与 4xx 走同一类型', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('upstream down') });

    const error = await postChatCompletion_ACU({ stream: false }).catch(e => e);

    expect(error).toBeInstanceOf(AgentApiHttpError_ACU);
    expect(error.status).toBe(503);
    expect(isRetryableAiRequestError_ACU(error)).toBe(true);
  });

  it('isRetryableAiRequestError_ACU 只放行瞬时失败，AbortError 一律立停', () => {
    const aborted = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    expect(isRetryableAiRequestError_ACU(aborted)).toBe(false);
    // AbortError 即便带 500 status 也不能重试：那是用户主动停止，不是服务端抖动。
    expect(isRetryableAiRequestError_ACU(Object.assign(new Error('aborted'), { name: 'AbortError', status: 500 }))).toBe(false);

    expect(isRetryableAiRequestError_ACU(Object.assign(new Error('gateway'), { status: 502 }))).toBe(true);
    expect(isRetryableAiRequestError_ACU(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isRetryableAiRequestError_ACU(Object.assign(new Error('slow'), { name: 'TimeoutError' }))).toBe(true);
    expect(isRetryableAiRequestError_ACU(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableAiRequestError_ACU(new Error('connection reset by peer'))).toBe(true);
    expect(isRetryableAiRequestError_ACU(new Error('response is not valid JSON'))).toBe(false);
    expect(isRetryableAiRequestError_ACU('network error')).toBe(false);
    expect(isRetryableAiRequestError_ACU(null)).toBe(false);
  });

  it('408 Request Timeout 可重试，401/403/404 保持终态', () => {
    expect(isRetryableAiRequestError_ACU(Object.assign(new Error('timeout'), { status: 408 }))).toBe(true);
    expect(isRetryableAiRequestError_ACU(new AgentApiHttpError_ACU(408, 'request timeout'))).toBe(true);
    expect(isRetryableAiRequestError_ACU(new AgentApiHttpError_ACU(401, 'unauthorized'))).toBe(false);
    expect(isRetryableAiRequestError_ACU(new AgentApiHttpError_ACU(403, 'forbidden'))).toBe(false);
    expect(isRetryableAiRequestError_ACU(new AgentApiHttpError_ACU(404, 'not found'))).toBe(false);
  });

  it('内部超时中文错误挂 TimeoutError 名后可重试（不依赖文案正则）', () => {
    const timeout = Object.assign(new Error('内部AI请求超时，已中断'), { name: 'TimeoutError' });
    expect(isRetryableAiRequestError_ACU(timeout)).toBe(true);
    const plain = new Error('内部AI请求超时，已中断');
    expect(isRetryableAiRequestError_ACU(plain)).toBe(false);
  });

  it('指定预设名使用对应预设', async () => {
    mockSettings.apiPresets = [
      { name: '预设B', apiMode: 'custom', apiConfig: { url: 'https://b.com', model: 'gpt-4', apiKey: 'sk-test' } },
    ];
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('预设B回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '预设B');
    expect(result).toBe('预设B回复');
  });

  it('自定义 API 模式把 signal 传给 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const controller = new AbortController();
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', undefined, controller.signal);
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
  });

  it('custom 分支 signal 已 abort 时仍先发请求，handleApiResponse 拒绝中断', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    const controller = new AbortController();
    controller.abort();
    mockFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(
      callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', undefined, controller.signal),
    ).rejects.toThrow();
  });

});

// ═══ callCustomOpenAI_ACU_Direct ═══
// ═══ buildCustomApiRequestBody_ACU ═══
describe('buildCustomApiRequestBody_ACU', () => {
  it('max_tokens=0 不被回退为 20000', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 0 },
    );
    expect(body.max_tokens).toBe(0);
  });

  it('custom_api_format 缺省回退 openai_compat，预设值白名单透传', () => {
    const defaultBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(defaultBody.chat_completion_source).toBe('custom');
    expect(defaultBody.custom_api_format).toBe('openai_compat');

    const claudeBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', customApiFormat: 'claude_messages' as any },
    );
    expect(claudeBody.custom_api_format).toBe('claude_messages');

    const invalidBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', customApiFormat: 'unknown_format' as any },
    );
    expect(invalidBody.custom_api_format).toBe('openai_compat');
  });

  it('promptPostProcessing 缺省时默认 strict（向后兼容旧版写死 strict 的行为）', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'system', content: '中部 system' }, { role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(body.custom_prompt_post_processing).toBe('strict');
  });

  it('promptPostProcessing 显式空串（未选择）时省略该字段（后端原样透传消息）', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'system', content: '中部 system' }, { role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', promptPostProcessing: '' },
    );
    expect(body).not.toHaveProperty('custom_prompt_post_processing');
  });

  it('promptPostProcessing 合法值原样透传', () => {
    for (const value of ['merge', 'semi', 'strict', 'single', 'merge_tools', 'semi_tools', 'strict_tools']) {
      const body = buildCustomApiRequestBody_ACU(
        [{ role: 'user', content: 'test' }],
        { url: 'https://api.example.com', model: 'gpt-4', promptPostProcessing: value },
      );
      expect(body.custom_prompt_post_processing).toBe(value);
    }
  });

  it('promptPostProcessing 非法值降级 strict（不让 TT 后端 fail-fast）', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', promptPostProcessing: 'fake-mode' },
    );
    expect(body.custom_prompt_post_processing).toBe('strict');
  });

  it('reasoning_effort 五档原样透传（xhigh 位于 high 与 max 之间）', () => {
    for (const value of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const body = buildCustomApiRequestBody_ACU(
        [{ role: 'user', content: 'test' }],
        { url: 'https://api.example.com', model: 'gpt-4', reasoningEffort: value },
      );
      expect(body.reasoning_effort).toBe(value);
    }
  });

  it('reasoningEffort=false 传布尔 false 关闭思考', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', reasoningEffort: 'false' },
    );
    expect(body.reasoning_effort).toBe(false);
  });

  it('reasoningEffort=auto 时省略 reasoning_effort 参数', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', reasoningEffort: 'auto' },
    );
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('reasoningEffort 非法值回退 medium', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', reasoningEffort: 'ultra' },
    );
    expect(body.reasoning_effort).toBe('medium');
  });

  it('OpenCode Go 端点自动补 x-opencode-session 头，同端点会话 id 稳定', () => {
    const cfg = { url: 'https://opencode.ai/zen/go/v1/chat/completions', model: 'mimo-v2.5', apiKey: 'sk-go' };
    const first = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'test' }], cfg);
    const second = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'test' }], { ...cfg });
    const pick = (b: any) => String(b.custom_include_headers).split('\n').find((l: string) => /^x-opencode-session\s*:/i.test(l));
    expect(pick(first)).toMatch(/^x-opencode-session: [0-9a-f-]{36}$/i);
    expect(pick(second)).toBe(pick(first));
  });

  it('非 Go 端点不补 x-opencode-session 头', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-x' },
    );
    expect(String(body.custom_include_headers)).not.toMatch(/x-opencode-session/i);
  });

  it('同主机非 Go 路径不补 x-opencode-session 头', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://opencode.ai/zen/v1/chat/completions', model: 'm', apiKey: 'sk-x' },
    );
    expect(String(body.custom_include_headers)).not.toMatch(/x-opencode-session/i);
  });

  it('用户已显式写 x-opencode-session 时不覆盖', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://opencode.ai/zen/go/v1/chat/completions', model: 'm', requestHeaders: 'x-opencode-session: my-own-id' },
    );
    const hits = String(body.custom_include_headers).split('\n').filter((l: string) => /^x-opencode-session\s*:/i.test(l));
    expect(hits).toEqual(['x-opencode-session: my-own-id']);
  });

  it('maxTokens 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', maxTokens: 1234 },
    );
    expect(body.max_tokens).toBe(1234);
  });

  it('temperature=0 不被回退为 1.0', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 0 },
    );
    expect(body.temperature).toBe(0);
  });

  it('top_p=0 进入 body.top_p', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', top_p: 0 },
    );
    expect(body.top_p).toBe(0);
  });

  it('topP 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', topP: 0.5 },
    );
    expect(body.top_p).toBe(0.5);
  });

  it('topP=0 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', topP: 0 },
    );
    expect(body.top_p).toBe(0);
  });

  it('bodyParams 作为 SillyTavern custom_include_body 透传给最终 provider', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, top_p: 0.95, max_tokens: 20000, bodyParams: 'temperature:0.3\ntop_p:0.5\nmax_tokens:100' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    expect(body.max_tokens).toBe(20000);
    expect(body.custom_include_body).toBe('temperature:0.3\ntop_p:0.5\nmax_tokens:100');
  });

  it('bodyParams 保留 YAML 对象值给 SillyTavern 解析', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'response_format:\n  type: json_object\nmetadata:\n  source: acu' },
    );
    expect(body.custom_include_body).toBe('response_format:\n  type: json_object\nmetadata:\n  source: acu');
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('metadata');
  });

  it('bodyParams 保留数组和布尔 YAML 给 SillyTavern 解析', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'stop:\n  - </json>\nparallel_tool_calls: false' },
    );
    expect(body.custom_include_body).toBe('stop:\n  - </json>\nparallel_tool_calls: false');
    expect(body).not.toHaveProperty('parallel_tool_calls');
  });

  it('overrides.responseFormat 作为结构化对象注入 custom_include_body', () => {
    const responseFormat = {
      type: 'json_schema',
      json_schema: { name: 'table_edit_ops_response', strict: true, schema: { type: 'object' } },
    };
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
      { responseFormat },
    );
    expect(parse(body.custom_include_body)).toEqual({ response_format: responseFormat });
    // response_format 只走 custom_include_body 合并，不直接挂在请求体顶层。
    expect(body).not.toHaveProperty('response_format');
  });

  it('overrides.responseFormat 与 YAML mapping 共存时按对象语义合并', () => {
    const responseFormat = { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: {} } };
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'temperature: 0.3' },
      { responseFormat },
    );
    expect(parse(body.custom_include_body)).toEqual({ temperature: 0.3, response_format: responseFormat });
  });

  it('bodyParams 为 JSON 对象时仍注入插件字段，并保留用户 stream_options 子字段', () => {
    mockSettings.streamingEnabled = true;
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: '{"stop":["</json>"],"stream_options":{"trace":true}}' },
      { promptCacheKey: 'cache-key', includeStreamUsage: true },
    );
    expect(parse(body.custom_include_body)).toEqual({
      stop: ['</json>'],
      stream_options: { trace: true, include_usage: true },
      prompt_cache_key: 'cache-key',
    });
  });

  it('YAML sequence 按 SillyTavern 顺序浅合并对象项，忽略非对象项', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: '- {temperature: 0.2, metadata: {source: first}}\n- ignored\n- {temperature: 0.4, top_p: 0.6}' },
      { promptCacheKey: 'cache-key' },
    );
    expect(parse(body.custom_include_body)).toEqual({
      temperature: 0.4,
      metadata: { source: 'first' },
      top_p: 0.6,
      prompt_cache_key: 'cache-key',
    });
  });

  it('非法 YAML 或标量根节点保留用户原文并跳过插件字段', () => {
    const invalid = 'metadata: [';
    const invalidBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: invalid },
      { promptCacheKey: 'cache-key' },
    );
    const scalar = 'plain scalar';
    const scalarBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: scalar },
      { promptCacheKey: 'cache-key' },
    );
    expect(invalidBody.custom_include_body).toBe(invalid);
    expect(scalarBody.custom_include_body).toBe(scalar);
  });

  it('excludeBodyParams 与预设显式配置冲突时按排除优先（不再自动剔除，A2 连带项）', async () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, excludeBodyParams: 'temperature,top_p' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    // 用户显式排除清单原样透传（temperature 冲突仅 warn，不删键）；排除由后端在发往上游前执行。
    expect(body.custom_exclude_body).toBe('- temperature\n- top_p');
    expect(body).toHaveProperty('max_tokens');
  });

  it('bodyParams 与 excludeBodyParams 同名时两者均原样透传，由后端定序', async () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, bodyParams: 'temperature:0.3', excludeBodyParams: 'temperature' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.custom_include_body).toBe('temperature:0.3');
    // 旧行为会因冲突把排除键删成空串；新行为尊重用户排除意图。
    expect(body.custom_exclude_body).toBe('- temperature');
  });



  it('overrides.maxTokens 优先于 effectiveApiConfig', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 9999 },
      { maxTokens: 100 },
    );
    expect(body.max_tokens).toBe(100);
  });

  it('无配置时使用默认值', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(body.max_tokens).toBe(20000);
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
  });

  it('messages 的 role 以大写 SYSTEM/USER 传入时归一为小写', () => {
    // 回归点：改表助手伪 role 提示词组（buildPseudoRoleTemplateAssistantPromptSegments_ACU）
    // 产出 role 为大写 SYSTEM / USER，自定义 chat-completions 后端只接受小写 role。
    // 此前 messages 被原样透传导致 `unknown variant SYSTEM`。
    const before = [
      { role: 'SYSTEM', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'USER', content: '请改表。' },
    ];
    const body = buildCustomApiRequestBody_ACU(
      before,
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(body.messages).toEqual([
      { role: 'system', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'user', content: '请改表。' },
    ]);
    // 不原地修改调用方原始数组与对象
    expect(before).toEqual([
      { role: 'SYSTEM', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'USER', content: '请改表。' },
    ]);
    expect(body.messages).not.toBe(before);
    expect(body.messages[0]).not.toBe(before[0]);
  });

  it('messages 的 role 已为小写时不改变内容，也不改动调用方数组', () => {
    const original = [{ role: 'user', content: '你好' }];
    const body = buildCustomApiRequestBody_ACU(original, { url: 'https://api.example.com', model: 'gpt-4' });
    expect(body.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(original).toEqual([{ role: 'user', content: '你好' }]);
    expect(body.messages).not.toBe(original);
    expect(body.messages[0]).not.toBe(original[0]);
  });

  it('缺失或非字符串 role、数组/原始值等异常消息原样保留，不静默改造成 undefined', () => {
    const input = [
      { content: '缺 role' },
      { role: null, content: 'role 为 null' },
      { role: 123, content: 'role 为数字' },
      ['x'],
      'raw string',
      null,
    ] as any[];
    const body = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' });
    // 边界契约：仅字符串 role 归一化；缺失/非字符串/数组/原始值原样保留，交由后端校验
    expect(body.messages).toEqual([
      { content: '缺 role' },
      { role: null, content: 'role 为 null' },
      { role: 123, content: 'role 为数字' },
      ['x'],
      'raw string',
      null,
    ]);
  });

  it('非预填充支持开启时 assistant 消息改写为 user 并加「助手：」前缀', () => {
    mockSettings.nonPrefillSupport = true;
    const input = [
      { role: 'system', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'user', content: '请改表。' },
    ];
    const body = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' });
    expect(body.messages).toEqual([
      { role: 'system', content: '你是改表助手。' },
      { role: 'user', content: '助手：\n收到。' },
      { role: 'user', content: '请改表。' },
    ]);
    // 不原地修改调用方
    expect(input[1]).toEqual({ role: 'assistant', content: '收到。' });
    delete mockSettings.nonPrefillSupport;
  });

  it('非预填充支持关闭时 assistant 消息保持原样', () => {
    delete mockSettings.nonPrefillSupport;
    delete mockSettings.nonPrefillGlobal;
    const input = [
      { role: 'assistant', content: '收到。' },
    ];
    const body = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' });
    expect(body.messages).toEqual([{ role: 'assistant', content: '收到。' }]);
  });

  it('overrides 传入 nonPrefillSupport 时优先于全局设置（预设级）', () => {
    mockSettings.nonPrefillSupport = false;
    const input = [{ role: 'assistant', content: '收到。' }];
    // 全局关闭但预设开启 → 应用转换
    const onBody = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' }, { nonPrefillSupport: true });
    expect(onBody.messages).toEqual([{ role: 'user', content: '助手：\n收到。' }]);
    // 全局开启但预设关闭 → 不转换
    mockSettings.nonPrefillSupport = true;
    const offBody = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' }, { nonPrefillSupport: false });
    expect(offBody.messages).toEqual([{ role: 'assistant', content: '收到。' }]);
    delete mockSettings.nonPrefillSupport;
  });
});

// ═══ callAIWithPreset_ACU 自定义模式最终发送 body 层面：role 小写化回归 ═══
describe('callAIWithPreset_ACU 自定义模式 role 归一化', () => {
  it('改表助手大写的 SYSTEM/USER 消息在最终 fetch body 中归一为小写', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const messages = [
      { role: 'SYSTEM', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'USER', content: '以下是全局表格结构：$3' },
    ];
    const result = await callAIWithPreset_ACU(messages, '');
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.messages).toEqual([
      { role: 'system', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'user', content: '以下是全局表格结构：$3' },
    ]);
    // 调用方原始数组未被原地修改
    expect(messages).toEqual([
      { role: 'SYSTEM', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'USER', content: '以下是全局表格结构：$3' },
    ]);
  });
});

// ═══ callApi_ACU 温度透传 ═══
// ═══ callApiWithPlotPreset_ACU 温度透传 ═══
describe('callApiWithPlotPreset_ACU 温度透传', () => {
  it('custom 模式 fetch body 使用配置温度', async () => {
    mockSettings.plotApiPreset = '';
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0.5, top_p: 0.7 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApiWithPlotPreset_ACU([{ role: 'user', content: '你好' }], '');
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.5);
    expect(fetchBody.top_p).toBe(0.7);
  });

  it('custom 模式指定预设温度进入 fetch body', async () => {
    mockSettings.plotApiPreset = '预设C';
    mockSettings.apiPresets = [
      { name: '预设C', apiMode: 'custom', apiConfig: { url: 'https://api.example.com', model: 'gpt-4', temperature: 0.2, top_p: 0.6 }, tavernProfile: '' },
    ];
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApiWithPlotPreset_ACU([{ role: 'user', content: '你好' }], '预设C');
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.2);
    expect(fetchBody.top_p).toBe(0.6);
  });
});

// ═══ callAIWithPreset_ACU 参数透传 ═══
describe('callAIWithPreset_ACU 参数透传', () => {
  it('custom 分支 fetch body temperature=0 不被回退', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0);
  });

  it('custom 分支 fetch body topP 驼峰别名生效', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', topP: 0.3 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.top_p).toBe(0.3);
  });

  it('custom 分支 fetch body max_tokens=0 不被回退', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 0 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.max_tokens).toBe(0);
  });
});

// ═══ callAIWithResolvedPreset_ACU 传输超时（V3-c：租约不能被挂死的 transport 无限占用）═══
describe('callAIWithResolvedPreset_ACU 传输超时', () => {
  const resolved = {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 4096 },
    tavernProfile: 'default',
  };

  it('外部 signal 在场时将取消并入超时控制器（fetch 收到的是合并后的 signal）', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('正文');
    const result = await callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved, controller.signal);
    expect(result).toBe('正文');
    const passed = mockFetch.mock.calls[0][1].signal;
    expect(passed).toBeTruthy();
    expect(passed).not.toBe(controller.signal);
    expect(passed.aborted).toBe(false);
  });

  it('外部 abort 立即中断挂起的 fetch 并按取消上报', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const pending = callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow('请求已取消');
  });

  it('transport 挂死时按 120s 超时兜底中断，错误文案区分超时', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation((_url: string, init: any) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }));
      const pending = callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved);
      const guarded = pending.catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(120_000);
      const failure = await guarded;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('内部 AI 请求超时');
      expect((failure as Error).message).toContain('120');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══ callAIWithResolvedPreset_ACU 基础路径（V4-a：限流/配置校验/错误路径此前零覆盖）═══
describe('callAIWithResolvedPreset_ACU 基础路径', () => {
  const resolved = {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 4096 },
    tavernProfile: 'default',
  };

  it('空消息数组直接拒绝，不触达限流与 fetch', async () => {
    await expect(callAIWithResolvedPreset_ACU([], resolved)).rejects.toThrow('内部 AI 消息必须是非空数组');
    expect(mockRateLimitSlot).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('URL 或模型未配置时按自定义路径拒绝', async () => {
    const broken = { ...resolved, apiConfig: { model: 'gpt-4' } };
    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], broken)).rejects.toThrow('自定义 API 的 URL 或模型未配置');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('publicServiceMode 预设先过限流闸再发请求（以预设名计数）', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('正文');
    const publicService = { ...resolved, presetName: '公益站A', publicServiceMode: true };
    const result = await callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], publicService);
    expect(result).toBe('正文');
    expect(mockRateLimitSlot).toHaveBeenCalledWith('公益站A', expect.anything());
    // 无 publicServiceMode 的调用不占限流闸
    expect(mockRateLimitSlot).toHaveBeenCalledTimes(1);
  });

  it('非 2xx 响应抛出带状态码的受控错误', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'backend down' });
    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved)).rejects.toThrow('API 请求失败: 500 backend down');
  });

  it('响应解析出空白内容时返回 null 而非空串', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('   ');
    const result = await callAIWithResolvedPreset_ACU([{ role: 'user', content: '你好' }], resolved);
    expect(result).toBeNull();
  });

  it('将合成缓存键、usage 订阅与用户 stream_options 合并后发送给宿主', async () => {
    mockSettings.streamingEnabled = true;
    mockHandleApiResponse.mockResolvedValue('宿主边界回复');
    mockFetch.mockResolvedValue({ ok: true });
    const onUsage = vi.fn();

    await expect(callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: '合成宿主边界验证' }],
      {
        apiMode: 'custom',
        apiConfig: {
          url: 'https://resolved.example', apiKey: '', model: 'resolved-model', useMainApi: false,
          max_tokens: 222, temperature: 0,
          bodyParams: '{"metadata":{"source":"synthetic"},"stream_options":{"trace":true}}',
          excludeBodyParams: '', requestHeaders: '',
        },
        tavernProfile: '',
      },
      undefined,
      { onUsage },
      { promptCacheKey: 'acu-cont-v2-12345678-abcdef01-deadbeef' },
    )).resolves.toBe('宿主边界回复');

    expect(mockFetch).toHaveBeenCalledWith('/api/backends/chat-completions/generate', expect.objectContaining({
      method: 'POST', body: expect.any(String),
    }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parse(body.custom_include_body)).toEqual({
      metadata: { source: 'synthetic' },
      stream_options: { trace: true, include_usage: true },
      prompt_cache_key: 'acu-cont-v2-12345678-abcdef01-deadbeef',
    });
  });
});

describe('__ACU_DEBUG_LAST_API_BODY__ 调试快照脱敏（fix1 扩面）', () => {
  const readDebugSnapshot = (): any => (globalThis as any).__ACU_DEBUG_LAST_API_BODY__;
  const clearDebugSnapshot = () => {
    delete (globalThis as any).__ACU_DEBUG_LAST_API_BODY__;
    delete (globalThis as any).__ACU_DEBUG_LAST_API_BODY_AT__;
  };

  beforeEach(() => {
    clearDebugSnapshot();
  });

  afterEach(() => {
    setDebugLogEnabled(false);
    clearDebugSnapshot();
  });

  it('头名保留、值打码：Basic / x-api-key / api-key / 自动补的 x-opencode-session；Bearer 行为不变', () => {
    setDebugLogEnabled(true);
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      {
        url: 'https://opencode.ai/zen/go/v1/chat/completions',
        model: 'm',
        apiKey: 'sk-bearer-real',
        requestHeaders: ['Authorization: Basic dXNlcjpwYXNz', 'x-api-key: sk-x-real', 'api-key: sk-plain-real', 'X-Keep-Visible: yes'].join('\n'),
      },
    );

    // 真实请求体不脱敏（调试快照之外零影响）。
    const realHeaders = String(body.custom_include_headers);
    expect(realHeaders).toContain('Authorization: Bearer sk-bearer-real');
    expect(realHeaders).toContain('Authorization: Basic dXNlcjpwYXNz');
    expect(realHeaders).toContain('x-api-key: sk-x-real');

    const snapshot = readDebugSnapshot();
    expect(snapshot).toBeTruthy();
    const headers = String(snapshot.custom_include_headers);
    expect(headers).toContain('Authorization: Bearer ***');
    expect(headers).toContain('Authorization: Basic ***');
    expect(headers).toContain('x-api-key: ***');
    expect(headers).toContain('api-key: ***');
    expect(headers).not.toContain('sk-bearer-real');
    expect(headers).not.toContain('dXNlcjpwYXNz');
    expect(headers).not.toContain('sk-x-real');
    expect(headers).not.toContain('sk-plain-real');
    // 自动补的会话头同样打码，头名保留。
    const sessionLines = headers.split('\n').filter((line: string) => /x-opencode-session/i.test(line));
    expect(sessionLines).toHaveLength(1);
    expect(sessionLines[0]).toMatch(/^x-opencode-session: \*\*\*$/i);
    // 非敏感头原样保留。
    expect(headers).toContain('X-Keep-Visible: yes');
  });

  it('custom_include_body 黑名单键（api[_-]?key/token/secret）递归打码，白名单键不动', () => {
    setDebugLogEnabled(true);
    buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      {
        url: 'https://api.example.com',
        model: 'gpt-4',
        bodyParams: JSON.stringify({
          api_key: 'k1', 'api-key': 'k2', apiKey: 'k3', access_token: 't1', client_secret: 's1',
          keep_me: 'visible',
          nested: { token: 't2', deep: { apiKey: 'k4' }, list: [{ secret: 's2' }, { plain: 'ok' }] },
        }),
      },
    );

    const includeBody = JSON.parse(readDebugSnapshot().custom_include_body);
    expect(includeBody.api_key).toBe('***');
    expect(includeBody['api-key']).toBe('***');
    expect(includeBody.apiKey).toBe('***');
    expect(includeBody.access_token).toBe('***');
    expect(includeBody.client_secret).toBe('***');
    expect(includeBody.keep_me).toBe('visible');
    expect(includeBody.nested.token).toBe('***');
    expect(includeBody.nested.deep.apiKey).toBe('***');
    expect(includeBody.nested.list[0].secret).toBe('***');
    expect(includeBody.nested.list[1].plain).toBe('ok');
  });

  it('非 JSON 原文走 "key":"value" 正则兜底，无法定位时保持原样', () => {
    setDebugLogEnabled(true);
    const raw = 'broken json {"api_token":"leak-me","plain":"keep-me"} trailing';
    buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: raw },
    );

    const stored = String(readDebugSnapshot().custom_include_body);
    expect(stored).toContain('"api_token":"***"');
    expect(stored).not.toContain('leak-me');
    expect(stored).toContain('"plain":"keep-me"');

    // 完全无法定位敏感键形态的原文保持原样（仅影响调试快照，不影响真实请求）。
    const plain = 'plain text not json';
    buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: plain },
    );
    expect(String(readDebugSnapshot().custom_include_body)).toBe(plain);
  });
});

describe('x-opencode-session 头检测一致性（fix2）', () => {
  const goConfig = (requestHeaders: string) => ({
    url: 'https://opencode.ai/zen/go/v1/chat/completions',
    model: 'mimo-v2.5',
    apiKey: 'sk-go',
    requestHeaders,
  });
  const sessionLinesOf = (headersText: string) => headersText.split('\n').filter(line => /^[ \t]*x-opencode-session\s*:/i.test(line));

  it('X-Opencode-Session 大小写变体不重复补头，用户值原样保留', () => {
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'test' }], goConfig('X-Opencode-Session: user-case-id'));
    expect(sessionLinesOf(String(body.custom_include_headers))).toEqual(['X-Opencode-Session: user-case-id']);
  });

  it('行首空白缩进的 x-opencode-session 也不重复补头', () => {
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'test' }], goConfig('X-Custom: on\n  X-Opencode-Session: indented-id'));
    const lines = sessionLinesOf(String(body.custom_include_headers));
    expect(lines).toEqual(['  X-Opencode-Session: indented-id']);
    // 没有自动补出的第二条 UUID 会话头。
    expect(lines.some(line => /x-opencode-session:\s+[0-9a-f-]{36}/i.test(line))).toBe(false);
  });

  it('既有语义保持：未写会话头时自动补一条；非 Go 端点不补', () => {
    const auto = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'test' }], { url: 'https://opencode.ai/zen/go/v1/chat/completions', model: 'm', apiKey: 'sk-go' });
    const autoLines = sessionLinesOf(String(auto.custom_include_headers));
    expect(autoLines).toHaveLength(1);
    expect(autoLines[0]).toMatch(/^x-opencode-session: [0-9a-f-]{36}$/i);

    const plain = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'test' }], { url: 'https://api.example.com', model: 'm', apiKey: 'sk-x' });
    expect(sessionLinesOf(String(plain.custom_include_headers))).toHaveLength(0);
  });
});

describe('callAIWithPreset_ACU maxTokensOverride 校验（fix3）', () => {
  it('非法覆盖值（NaN/0/负数/Infinity）按未传处理回退预设配置链，不产垃圾 max_tokens', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 777 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('ok');
    for (const invalid of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      mockFetch.mockClear();
      await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', invalid as any);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(777);
    }
  });

  it('合法覆盖值逐字透传；config max_tokens=0 透传契约不破', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('ok');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', 555);
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstBody.max_tokens).toBe(555);

    // config max_tokens=0 透传契约（与 buildCustomApiRequestBody 既有 :216 用例同语义）。
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 0 };
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '');
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.max_tokens).toBe(0);
  });
});

// ═══ jsonFormatOutput 开关门控（与 MVU 格式化输出同参） ═══
// 铁律：开关关闭时行为与现状逐字一致；只有「需要明确返回 JSON」的调用点才传 needsJsonFormat。
describe('jsonFormatOutput 开关门控（与 MVU 格式化输出同参）', () => {
  const JSON_PRESET_CONFIG = { url: 'https://json.test', model: 'm-json', apiKey: 'sk-json', max_tokens: 4096 };

  function lastSentBody(): any {
    const call = mockFetch.mock.calls.at(-1);
    expect(call).toBeDefined();
    return JSON.parse(String(call[1].body));
  }

  function expectNoJsonFormat(sent: any): void {
    expect(String(sent.custom_include_body || '')).not.toContain('response_format');
    expect(sent).not.toHaveProperty('response_format');
  }

  function primeFetchOk(value = 'AI 回复'): void {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue(value);
  }

  it('常量与 MVU 同参且冻结', () => {
    expect(JSON_OBJECT_RESPONSE_FORMAT_ACU).toEqual({ type: 'json_object' });
    expect(Object.isFrozen(JSON_OBJECT_RESPONSE_FORMAT_ACU)).toBe(true);
  });

  it('callAIWithPreset：开关开 + needsJson → custom_include_body 含 response_format json_object', async () => {
    mockSettings.apiPresets = [
      { name: 'json开', apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, jsonFormatOutput: true },
    ];
    primeFetchOk();
    const result = await callAIWithPreset_ACU([{ role: 'user', content: 'hi' }], 'json开', undefined, undefined, { needsJsonFormat: true });
    expect(result).toBe('AI 回复');
    const sent = lastSentBody();
    expect(parse(sent.custom_include_body)).toEqual(expect.objectContaining({ response_format: { type: 'json_object' } }));
    expect(sent).not.toHaveProperty('response_format');
  });

  it('callAIWithPreset：开关开 + 不传 needsJson → 不附加 response_format', async () => {
    mockSettings.apiPresets = [
      { name: 'json开', apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, jsonFormatOutput: true },
    ];
    primeFetchOk();
    await callAIWithPreset_ACU([{ role: 'user', content: 'hi' }], 'json开');
    expectNoJsonFormat(lastSentBody());
  });

  it('callAIWithPreset：开关关 + needsJson → 不附加 response_format', async () => {
    mockSettings.apiPresets = [
      { name: 'json关', apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, jsonFormatOutput: false },
    ];
    primeFetchOk();
    await callAIWithPreset_ACU([{ role: 'user', content: 'hi' }], 'json关', undefined, undefined, { needsJsonFormat: true });
    expectNoJsonFormat(lastSentBody());
  });

  it('resolved：开关开 + needsJson → 附加 response_format json_object', async () => {
    primeFetchOk('resolved 回复');
    const result = await callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: 'hi' }],
      { apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, tavernProfile: '', presetName: 'r-json', jsonFormatOutput: true },
      null,
      undefined,
      { needsJsonFormat: true },
    );
    expect(result).toBe('resolved 回复');
    const sent = lastSentBody();
    expect(parse(sent.custom_include_body)).toEqual(expect.objectContaining({ response_format: { type: 'json_object' } }));
    expect(sent).not.toHaveProperty('response_format');
  });

  it('resolved：开关开 + 不传 extras → 不附加', async () => {
    primeFetchOk();
    await callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: 'hi' }],
      { apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, tavernProfile: '', presetName: 'r-json', jsonFormatOutput: true },
    );
    expectNoJsonFormat(lastSentBody());
  });

  it('resolved：开关关 + needsJson → 不附加', async () => {
    primeFetchOk();
    await callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: 'hi' }],
      { apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, tavernProfile: '', presetName: 'r-plain', jsonFormatOutput: false },
      null,
      undefined,
      { needsJsonFormat: true },
    );
    expectNoJsonFormat(lastSentBody());
  });

  it('internal-ai-call：needsJsonFormat 透传进 extras（与 minOutputTokens 同式）', async () => {
    primeFetchOk('内部 AI 回复');
    const preset: any = {
      presetName: 'route-json', source: 'fixed', reason: 'fixed_preset',
      apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, tavernProfile: '', jsonFormatOutput: true,
    };
    const identity: any = { source: 'agent_main', requestId: 'jsonfmt-a', chatIdentity: 'chat-a', taskId: 't', stageId: 's', revision: 1 };
    const result = await callContinuationInternalAi_ACU(
      [{ role: 'user', content: 'hi' }], preset, identity, null, { needsJsonFormat: true },
    );
    expect(result).toBe('内部 AI 回复');
    expect(parse(lastSentBody().custom_include_body)).toEqual(expect.objectContaining({ response_format: { type: 'json_object' } }));
  });

  it('internal-ai-call：缺省 options 不附加 response_format', async () => {
    primeFetchOk();
    const preset: any = {
      presetName: 'route-json', source: 'fixed', reason: 'fixed_preset',
      apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, tavernProfile: '', jsonFormatOutput: true,
    };
    const identity: any = { source: 'agent_main', requestId: 'jsonfmt-b', chatIdentity: 'chat-a', taskId: 't', stageId: 's', revision: 1 };
    await callContinuationInternalAi_ACU([{ role: 'user', content: 'hi' }], preset, identity);
    expectNoJsonFormat(lastSentBody());
  });

  it('draft 往返：开保持开，空草稿默认关', () => {
    expect(createEmptyApiPresetDraft().jsonFormatOutput).toBe(false);
    const draft = apiPresetDraftFromPreset({
      name: 'j', apiMode: 'custom',
      apiConfig: { url: 'https://j.test', apiKey: '', model: 'm', max_tokens: 1, temperature: 1 },
      jsonFormatOutput: true,
    } as any);
    expect(draft.jsonFormatOutput).toBe(true);
    expect(apiPresetFromDraft(draft).jsonFormatOutput).toBe(true);
  });

  it('draft 往返：关与缺省保持关', () => {
    for (const flag of [false, undefined]) {
      const draft = apiPresetDraftFromPreset({
        name: 'j', apiMode: 'custom',
        apiConfig: {
          url: 'https://j.test', apiKey: '', model: 'm', max_tokens: 1, temperature: 1,
          ...(flag === undefined ? {} : { jsonFormatOutput: flag }),
        },
      } as any);
      expect(draft.jsonFormatOutput).toBe(false);
      expect(apiPresetFromDraft(draft).jsonFormatOutput).toBe(false);
    }
  });

  it('归一白名单：缺省 false、真值保持、非 true 真值归一 false', () => {
    expect(normalizePreset_ACU({ name: 'a', apiMode: 'custom', apiConfig: {} })!.jsonFormatOutput).toBe(false);
    expect(normalizePreset_ACU({ name: 'a', apiMode: 'custom', apiConfig: {}, jsonFormatOutput: true })!.jsonFormatOutput).toBe(true);
    for (const v of [1, 'yes', {}, []]) {
      expect(normalizePreset_ACU({ name: 'a', apiMode: 'custom', apiConfig: {}, jsonFormatOutput: v })!.jsonFormatOutput).toBe(false);
    }
  });

  it('resolve：预设取预设值，空名与悬挂引用回退恒 false', () => {
    mockSettings.apiPresets = [
      { name: 'json开', apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, jsonFormatOutput: true },
      { name: 'json关', apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG } },
    ];
    expect(resolveApiConfigByPreset_ACU('json开').jsonFormatOutput).toBe(true);
    expect(resolveApiConfigByPreset_ACU('json关').jsonFormatOutput).toBe(false);
    expect(resolveApiConfigByPreset_ACU('').jsonFormatOutput).toBe(false);
    expect(resolveApiConfigByPreset_ACU('不存在的预设').jsonFormatOutput).toBe(false);
  });

  it('continuation：fixed 渠道把 jsonFormatOutput 透传给消费端', () => {
    mockSettings.apiPresets = [
      { name: 'cont-json', apiMode: 'custom', apiConfig: { ...JSON_PRESET_CONFIG }, jsonFormatOutput: true },
    ];
    const deps: any = { resolvePreset: (name: string) => resolveApiConfigByPreset_ACU(name) };
    const on = resolveContinuationApiPreset_ACU(
      { apiPresetMode: 'fixed', fixedApiPresetName: 'cont-json' } as any, 'agent_loop', deps,
    );
    expect(on.jsonFormatOutput).toBe(true);
    const off = resolveContinuationApiPreset_ACU(
      { apiPresetMode: 'current', fixedApiPresetName: '' } as any, 'agent_loop', deps,
    );
    expect(off.jsonFormatOutput).toBe(false);
  });
});
